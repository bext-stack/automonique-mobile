// SPDX-License-Identifier: Elastic-2.0

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';

import type { ConnectionProfile } from '@/core/credential-store';
import type {
  ReviewAction,
  ReviewActionReceipt,
  ReviewAuthority,
} from '@automonique/sdk';
import { UserWorkspaceId } from '@automonique/sdk';
import {
  cacheWorkspaceCatalog,
  emptyWorkspaceCatalog,
  mergeWorkspaceCatalogServer,
} from '@/core/workspace-catalog-reducer';
import type { WorkspaceCompanionCache } from '@/core/workspace-companion-cache';
import type {
  CompanionWorkspace,
  ScopedServerProfile,
  ServerIdentity,
  WorkspaceCompanionCatalog,
} from '@/core/workspace-companion';
import {
  buildWorkspaceServerCatalog,
  type WorkspaceCatalogDetail,
} from '@/core/workspace-v2-catalog';
import type { WorkspaceV2Gateway } from '@/core/workspace-v2-gateway';
import {
  admitReviewDeepLink,
  reviewAttentionAnchor,
  workspaceForDetail,
} from '@/core/review-attention';
import {
  admitReviewNotification,
  decodeReviewNotificationData,
  encodeReviewNotificationData,
  type NotificationPermission,
} from '@/core/review-notifications';
import { reviewNotificationRuntime } from '@/core/review-notification-runtime';
import {
  loadWorkspaceCatalogCache,
  persistWorkspaceCatalogCache,
  registerWorkspaceOperation,
  revokeWorkspaceServerStorage,
} from '@/core/workspace-storage';

export interface WorkspaceCatalogStatus {
  readonly phase: 'loading' | 'live' | 'stale' | 'unavailable';
  readonly coverage: 'complete' | 'partial' | 'unknown';
  readonly message: string;
  readonly omittedDetailCount: number;
  readonly omittedProjectCount: number;
  readonly omittedHostCount: number;
  readonly omittedWorkspaceCount: number;
  readonly omittedSessionCount: number;
  readonly failedProjectCount: number;
  readonly failedDetailCount: number;
}

interface WorkspaceContextValue {
  readonly catalog: WorkspaceCompanionCatalog;
  readonly status: WorkspaceCatalogStatus;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly reviewBusy: boolean;
  readonly reviewReceipts: readonly ReviewActionReceipt[];
  readonly notificationPermission: NotificationPermission;
  readonly requestReviewNotificationPermission: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly selectServer: (identity: ServerIdentity) => void;
  readonly findServer: (identity: string) => ScopedServerProfile | null;
  readonly findWorkspace: (
    serverIdentity: string,
    workspaceId: string,
  ) => CompanionWorkspace | null;
  readonly findDetail: (
    serverIdentity: string,
    workspaceId: string,
  ) => WorkspaceCatalogDetail | null;
  readonly executeReviewAction: (options: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly workspaceRevision: string;
    readonly reviewRevision: string;
    readonly authority: ReviewAuthority;
    readonly action: Extract<
      ReviewAction,
      { readonly kind: 'add_comment' | 'approve_review' }
    >;
    readonly idempotencyKey: string;
  }) => Promise<ReviewActionReceipt | null>;
}

interface WorkspaceProviderProps extends PropsWithChildren {
  readonly gateway: WorkspaceV2Gateway | null;
  readonly profile: ConnectionProfile | null;
  readonly generationKey: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const INITIAL_STATUS: WorkspaceCatalogStatus = {
  phase: 'loading',
  coverage: 'unknown',
  message: 'Loading the bounded workspace cache',
  omittedDetailCount: 0,
  omittedProjectCount: 0,
  omittedHostCount: 0,
  omittedWorkspaceCount: 0,
  omittedSessionCount: 0,
  failedProjectCount: 0,
  failedDetailCount: 0,
};

/** Remove one exact server scope before its credential is revoked. */
export async function revokeWorkspaceCatalogCache(
  serverIdentityValue: string,
  authorizationRevision: string,
): Promise<void> {
  await revokeWorkspaceServerStorage(
    serverIdentityValue,
    authorizationRevision,
  );
}

function serverLabel(profile: ConnectionProfile): string {
  try {
    return new URL(profile.origin).hostname;
  } catch {
    return 'Authorized server';
  }
}

export function WorkspaceProvider({
  children,
  gateway,
  profile,
  generationKey,
}: WorkspaceProviderProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  const [catalog, setCatalog] = useState<WorkspaceCompanionCatalog>(() =>
    emptyWorkspaceCatalog(),
  );
  const [details, setDetails] = useState<readonly WorkspaceCatalogDetail[]>([]);
  const [status, setStatus] = useState<WorkspaceCatalogStatus>(INITIAL_STATUS);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReceipts, setReviewReceipts] = useState<
    readonly ReviewActionReceipt[]
  >([]);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() =>
      reviewNotificationRuntime.supported ? 'undetermined' : 'denied',
    );
  const catalogRef = useRef(catalog);
  const detailsRef = useRef(details);
  const statusRef = useRef(status);
  const draftsRef = useRef<WorkspaceCompanionCache['intentDrafts']>([]);
  const operation = useRef<AbortController | null>(null);
  const reviewOperation = useRef(false);
  const hydrated = useRef(false);
  const notificationPermissionRef =
    useRef<NotificationPermission>('undetermined');
  const notifiedReviews = useRef(new Set<string>());

  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission;
  }, [notificationPermission]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    void reviewNotificationRuntime.configure().catch(() => undefined);
    void reviewNotificationRuntime
      .permission()
      .then(setNotificationPermission)
      .catch(() => setNotificationPermission('denied'));

    const removeResponse = reviewNotificationRuntime.onResponse((data) => {
      try {
        const request = decodeReviewNotificationData(data);
        const route = admitReviewDeepLink(
          catalogRef.current,
          detailsRef.current,
          request,
        );
        routerRef.current.push({
          pathname: route.pathname,
          params: route.params,
        });
      } catch {
        // Notification data is never navigation authority on its own.
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      if (
        next !== 'background' ||
        notificationPermissionRef.current !== 'granted' ||
        statusRef.current.phase !== 'live'
      ) {
        return;
      }
      for (const detail of detailsRef.current) {
        if (
          detail.review === null ||
          detail.review.snapshot.attention.state !== 'needs_you' ||
          detail.review.unread <= 0
        ) {
          continue;
        }
        const workspace = workspaceForDetail(catalogRef.current, detail);
        const server = catalogRef.current.servers.find(
          (candidate) => candidate.serverIdentity === detail.serverIdentity,
        );
        if (
          workspace === null ||
          server?.authorization !== 'active' ||
          server.staleProjectIds.includes(workspace.projectId)
        ) {
          continue;
        }
        const request = {
          serverIdentity: detail.serverIdentity,
          workspaceId: workspace.id,
          workspaceRevision: workspace.revision,
          reviewRevision: detail.review.revision,
          ...reviewAttentionAnchor(detail.review.snapshot),
        };
        try {
          const route = admitReviewDeepLink(
            catalogRef.current,
            detailsRef.current,
            request,
          );
          const candidate = admitReviewNotification({
            permission: 'granted',
            appState: 'background',
            authorizationActive: true,
            projectionLive: true,
            attentionState: 'needs_you',
            unread: detail.review.unread,
            route,
          });
          const key = `${detail.serverIdentity}:${workspace.id}:${detail.review.revision}`;
          if (candidate === null || notifiedReviews.current.has(key)) {
            continue;
          }
          notifiedReviews.current.add(key);
          void reviewNotificationRuntime
            .schedule({
              title: candidate.title,
              body: candidate.body,
              data: encodeReviewNotificationData(request),
            })
            .catch(() => notifiedReviews.current.delete(key));
        } catch {
          // Stale or incomplete coordinates are never scheduled.
        }
      }
    });
    return () => {
      removeResponse();
      appStateSubscription.remove();
    };
  }, []);

  const requestReviewNotificationPermission = useCallback(async () => {
    if (!reviewNotificationRuntime.supported) {
      setNotificationPermission('denied');
      return;
    }
    try {
      setNotificationPermission(
        await reviewNotificationRuntime.requestPermission(),
      );
    } catch {
      setNotificationPermission('denied');
    }
  }, []);

  const refresh = useCallback(async () => {
    operation.current?.abort('workspace_generation_replaced');
    const controller = new AbortController();
    operation.current = controller;
    if (gateway === null || profile === null) {
      const cached = cacheWorkspaceCatalog(catalogRef.current);
      catalogRef.current = cached;
      setCatalog(cached);
      setDetails([]);
      setStatus({
        ...INITIAL_STATUS,
        phase: 'unavailable',
        message:
          'This credential has no current delegated Platform v2 project reads. Cached workspaces remain read only.',
      });
      return;
    }
    const unregister = registerWorkspaceOperation(
      gateway.authorizationScope.serverIdentity,
      controller,
    );
    setStatus((current) => ({
      ...current,
      phase: current.phase === 'loading' ? 'loading' : 'stale',
      message: 'Refreshing typed workspace relations',
    }));
    try {
      const built = await buildWorkspaceServerCatalog({
        gateway,
        origin: profile.origin,
        serverLabel: serverLabel(profile),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const recovered: ReviewActionReceipt[] = [];
      if (
        gateway.reviewEffectKinds.length > 0 &&
        gateway.authorizationScope.actions.includes('get_review_receipt')
      ) {
        const pending = await gateway.pendingReviewReceipts();
        for (const handle of pending) {
          if (controller.signal.aborted) return;
          const result = await gateway.reconcileReviewAction(
            handle.idempotency_key,
            controller.signal,
          );
          recovered.push(result.receipt);
        }
      }
      const next = mergeWorkspaceCatalogServer(
        catalogRef.current,
        built.profile,
        {
          successfulProjectIds: built.successfulProjectIds,
          failedProjectIds: built.failedProjectIds,
        },
      );
      await persistWorkspaceCatalogCache(
        {
          schema: 'automonique.mobile-workspace-cache/v1',
          catalog: next,
          intentDrafts: draftsRef.current,
        },
        built.profile.serverIdentity,
        built.profile.authorizationRevision,
      );
      if (controller.signal.aborted) return;
      catalogRef.current = next;
      setCatalog(next);
      setDetails(built.details);
      detailsRef.current = built.details;
      setReviewReceipts((current) => [
        ...recovered,
        ...current.filter(
          (receipt) =>
            !recovered.some(
              (candidate) =>
                candidate.idempotency_key === receipt.idempotency_key,
            ),
        ),
      ]);
      setStatus({
        phase: 'live',
        coverage: built.coverage,
        message:
          built.coverage === 'complete'
            ? 'Current delegated workspace inventory'
            : 'Current inventory with bounded or unavailable detail reads',
        omittedDetailCount: built.omittedDetailCount,
        omittedProjectCount: built.omittedProjectCount,
        omittedHostCount: built.omittedHostCount,
        omittedWorkspaceCount: built.omittedWorkspaceCount,
        omittedSessionCount: built.omittedSessionCount,
        failedProjectCount: built.failedProjectCount,
        failedDetailCount: built.failedDetailCount,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const cached = cacheWorkspaceCatalog(catalogRef.current);
      catalogRef.current = cached;
      setCatalog(cached);
      setDetails([]);
      setStatus({
        ...INITIAL_STATUS,
        phase: 'stale',
        message:
          error instanceof Error &&
          error.message === 'workspace_catalog_resync_required'
            ? 'Workspace revisions changed unexpectedly; a clean refresh is required'
            : 'Workspace refresh unavailable; showing admitted cache read only',
      });
    } finally {
      unregister();
    }
  }, [gateway, profile]);

  const executeReviewAction = useCallback(
    async (options: {
      readonly projectId: string;
      readonly workspaceId: string;
      readonly workspaceRevision: string;
      readonly reviewRevision: string;
      readonly authority: ReviewAuthority;
      readonly action: Extract<
        ReviewAction,
        { readonly kind: 'add_comment' | 'approve_review' }
      >;
      readonly idempotencyKey: string;
    }): Promise<ReviewActionReceipt | null> => {
      if (gateway === null || profile === null || reviewOperation.current) {
        throw new Error('review_mutation_unavailable');
      }
      const detail = detailsRef.current.find(
        (candidate) =>
          candidate.serverIdentity ===
            gateway.authorizationScope.serverIdentity &&
          candidate.workspaceId === options.workspaceId &&
          candidate.workspaceRevision === options.workspaceRevision &&
          candidate.review?.revision === options.reviewRevision,
      );
      const server = catalogRef.current.servers.find(
        (candidate) =>
          candidate.serverIdentity ===
          gateway.authorizationScope.serverIdentity,
      );
      if (
        statusRef.current.phase !== 'live' ||
        server?.authorization !== 'active' ||
        server.staleProjectIds.includes(options.projectId) ||
        detail === undefined ||
        !gateway.reviewEffectKinds.includes(options.action.kind)
      ) {
        throw new Error('review_mutation_unavailable');
      }
      reviewOperation.current = true;
      setReviewBusy(true);
      try {
        const result = await gateway.executeReviewAction(
          options.projectId,
          { kind: 'user_workspace', id: UserWorkspaceId(options.workspaceId) },
          BigInt(options.reviewRevision),
          options.authority,
          options.action,
          options.idempotencyKey,
        );
        if (result.receipt !== null) {
          setReviewReceipts((current) => [
            result.receipt!,
            ...current.filter(
              (receipt) =>
                receipt.idempotency_key !== result.receipt!.idempotency_key,
            ),
          ]);
        }
        await refresh();
        return result.receipt;
      } finally {
        reviewOperation.current = false;
        setReviewBusy(false);
      }
    },
    [gateway, profile, refresh],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!hydrated.current) {
        const cache = await loadWorkspaceCatalogCache().catch(() => null);
        if (!active) return;
        hydrated.current = true;
        if (cache !== null) {
          draftsRef.current = cache.intentDrafts;
          catalogRef.current = cache.catalog;
          setCatalog(cache.catalog);
          setStatus({
            ...INITIAL_STATUS,
            phase: 'stale',
            message: 'Admitted cached workspace inventory · read only',
          });
        }
      }
      if (active) await refresh();
    })();
    return () => {
      active = false;
      operation.current?.abort('workspace_provider_unmounted');
    };
  }, [generationKey, refresh]);

  const selectServer = useCallback((identity: ServerIdentity) => {
    setCatalog((current) => {
      if (
        !current.servers.some((server) => server.serverIdentity === identity)
      ) {
        return current;
      }
      const next = { ...current, selectedServerIdentity: identity };
      catalogRef.current = next;
      return next;
    });
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        catalog,
        status,
        details,
        reviewBusy,
        reviewReceipts,
        notificationPermission,
        refresh,
        selectServer,
        findServer: (identity) =>
          catalog.servers.find(
            (server) => server.serverIdentity === identity,
          ) ?? null,
        findWorkspace: (identity, workspaceId) =>
          catalog.servers
            .find((server) => server.serverIdentity === identity)
            ?.workspaces.find((workspace) => workspace.id === workspaceId) ??
          null,
        findDetail: (identity, workspaceId) =>
          details.find(
            (detail) =>
              detail.serverIdentity === identity &&
              detail.workspaceId === workspaceId,
          ) ?? null,
        executeReviewAction,
        requestReviewNotificationPermission,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const context = use(WorkspaceContext);
  if (context === null) throw new Error('WorkspaceProvider is missing');
  return context;
}
