// SPDX-License-Identifier: Elastic-2.0

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
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
  mergeWorkspaceCatalogServers,
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
import type {
  ReviewActionReconciliation,
  ReviewActionSubmission,
  ReadOnlyWorkspaceV2Gateway,
  WorkspaceV2Gateway,
} from '@/core/workspace-v2-gateway';
import type { ReviewV2ReceiptHandle } from '@/core/review-v2-receipts';
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
  readonly serverStatuses: Readonly<Record<string, WorkspaceCatalogStatus>>;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly reviewBusy: boolean;
  readonly reviewReceipts: readonly ReviewReceiptProjection[];
  readonly pendingReviewReceipts: readonly ReviewV2ReceiptHandle[];
  readonly notificationPermission: NotificationPermission;
  readonly requestReviewNotificationPermission: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly selectServer: (identity: ServerIdentity) => Promise<void>;
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
  }) => Promise<ReviewActionSubmission>;
  readonly reconcileReviewAction: (
    idempotencyKey: string,
  ) => Promise<ReviewActionReconciliation>;
}

export interface ReviewReceiptProjection {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly actionKind: 'add_comment' | 'approve_review';
  readonly receipt: ReviewActionReceipt;
}

export interface WorkspaceReadServer {
  readonly slotId: string;
  readonly profile: ConnectionProfile;
  readonly gateway: ReadOnlyWorkspaceV2Gateway;
}

interface WorkspaceProviderProps extends PropsWithChildren {
  readonly gateway: WorkspaceV2Gateway | null;
  readonly profile: ConnectionProfile | null;
  readonly generationKey: string;
  readonly readOnlyServers?: readonly WorkspaceReadServer[];
  readonly selectMutationServer?: (slotId: string) => Promise<void>;
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

const MAX_PARALLEL_WORKSPACE_SERVERS = 2;

function liveServerStatus(
  built: Awaited<ReturnType<typeof buildWorkspaceServerCatalog>>,
): WorkspaceCatalogStatus {
  return {
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
  };
}

function aggregateServerStatuses(
  statuses: Readonly<Record<string, WorkspaceCatalogStatus>>,
): WorkspaceCatalogStatus {
  const values = Object.values(statuses);
  const live = values.filter((entry) => entry.phase === 'live');
  if (live.length === 0) {
    return {
      ...INITIAL_STATUS,
      phase: values.length === 0 ? 'unavailable' : 'stale',
      message:
        values.length === 0
          ? 'No current delegated Platform v2 project reads. Cached workspaces remain read only.'
          : 'Workspace refresh unavailable; showing admitted cache read only',
    };
  }
  const partial =
    live.length !== values.length ||
    live.some((entry) => entry.coverage !== 'complete');
  return {
    phase: 'live',
    coverage: partial ? 'partial' : 'complete',
    message: partial
      ? 'Current multi-server inventory with bounded or unavailable reads'
      : 'Current delegated multi-server workspace inventory',
    omittedDetailCount: live.reduce(
      (total, entry) => total + entry.omittedDetailCount,
      0,
    ),
    omittedProjectCount: live.reduce(
      (total, entry) => total + entry.omittedProjectCount,
      0,
    ),
    omittedHostCount: live.reduce(
      (total, entry) => total + entry.omittedHostCount,
      0,
    ),
    omittedWorkspaceCount: live.reduce(
      (total, entry) => total + entry.omittedWorkspaceCount,
      0,
    ),
    omittedSessionCount: live.reduce(
      (total, entry) => total + entry.omittedSessionCount,
      0,
    ),
    failedProjectCount:
      values.length -
      live.length +
      live.reduce((total, entry) => total + entry.failedProjectCount, 0),
    failedDetailCount: live.reduce(
      (total, entry) => total + entry.failedDetailCount,
      0,
    ),
  };
}

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
  readOnlyServers,
  selectMutationServer,
}: WorkspaceProviderProps) {
  const router = useRouter();
  const readableServers = useMemo<readonly WorkspaceReadServer[]>(
    () =>
      readOnlyServers ??
      (gateway === null || profile === null
        ? []
        : [{ slotId: 'selected', profile, gateway }]),
    [gateway, profile, readOnlyServers],
  );
  const routerRef = useRef(router);
  const [catalog, setCatalog] = useState<WorkspaceCompanionCatalog>(() =>
    emptyWorkspaceCatalog(),
  );
  const [details, setDetails] = useState<readonly WorkspaceCatalogDetail[]>([]);
  const [status, setStatus] = useState<WorkspaceCatalogStatus>(INITIAL_STATUS);
  const [serverStatuses, setServerStatuses] = useState<
    Readonly<Record<string, WorkspaceCatalogStatus>>
  >({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReceipts, setReviewReceipts] = useState<
    readonly ReviewReceiptProjection[]
  >([]);
  const [pendingReviewReceipts, setPendingReviewReceipts] = useState<
    readonly ReviewV2ReceiptHandle[]
  >([]);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() =>
      reviewNotificationRuntime.supported ? 'undetermined' : 'denied',
    );
  const catalogRef = useRef(catalog);
  const detailsRef = useRef(details);
  const statusRef = useRef(status);
  const serverStatusesRef = useRef(serverStatuses);
  const draftsRef = useRef<WorkspaceCompanionCache['intentDrafts']>([]);
  const operation = useRef<AbortController | null>(null);
  const reviewOperation = useRef(false);
  const hydrated = useRef(false);
  const notificationPermissionRef =
    useRef<NotificationPermission>('undetermined');
  const notifiedReviews = useRef(new Set<string>());
  const appStateRef = useRef(AppState.currentState);
  const pendingNotificationResponse = useRef<unknown | null>(null);

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
    serverStatusesRef.current = serverStatuses;
  }, [serverStatuses]);

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission;
  }, [notificationPermission]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const admitNotificationResponse = useCallback((data: unknown): boolean => {
    if (statusRef.current.phase !== 'live') return false;
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
      return true;
    } catch {
      // Notification data is inert until current live state re-admits it.
      return false;
    }
  }, []);

  const scheduleLiveReviewNotifications = useCallback(
    async (
      liveCatalog: WorkspaceCompanionCatalog,
      liveDetails: readonly WorkspaceCatalogDetail[],
    ): Promise<void> => {
      if (
        appStateRef.current !== 'background' ||
        notificationPermissionRef.current !== 'granted'
      ) {
        return;
      }
      for (const detail of liveDetails) {
        if (
          detail.review === null ||
          detail.review.snapshot.attention.state !== 'needs_you' ||
          detail.review.unread <= 0
        ) {
          continue;
        }
        const workspace = workspaceForDetail(liveCatalog, detail);
        const server = liveCatalog.servers.find(
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
        let notificationKey: string | null = null;
        try {
          const route = admitReviewDeepLink(liveCatalog, liveDetails, request);
          const candidate = admitReviewNotification({
            permission: 'granted',
            appState: 'background',
            authorizationActive: true,
            projectionLive: true,
            attentionState: 'needs_you',
            unread: detail.review.unread,
            route,
          });
          notificationKey = `${detail.serverIdentity}:${workspace.id}:${detail.review.revision}`;
          if (
            candidate === null ||
            notifiedReviews.current.has(notificationKey)
          )
            continue;
          notifiedReviews.current.add(notificationKey);
          await reviewNotificationRuntime.schedule({
            title: candidate.title,
            body: candidate.body,
            data: encodeReviewNotificationData(request),
          });
        } catch {
          // Stale/incomplete coordinates and scheduling failures stay retriable.
          if (notificationKey !== null)
            notifiedReviews.current.delete(notificationKey);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void reviewNotificationRuntime.configure().catch(() => undefined);
    void reviewNotificationRuntime
      .permission()
      .then(setNotificationPermission)
      .catch(() => setNotificationPermission('denied'));
    void reviewNotificationRuntime
      .lastResponse()
      .then((data) => {
        if (data === null) return;
        if (admitNotificationResponse(data)) {
          void reviewNotificationRuntime
            .clearLastResponse()
            .catch(() => undefined);
        } else {
          pendingNotificationResponse.current = data;
        }
      })
      .catch(() => undefined);

    const removeResponse = reviewNotificationRuntime.onResponse((data) => {
      if (admitNotificationResponse(data)) {
        void reviewNotificationRuntime
          .clearLastResponse()
          .catch(() => undefined);
      } else {
        pendingNotificationResponse.current = data;
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next === 'background' && statusRef.current.phase === 'live') {
        void scheduleLiveReviewNotifications(
          catalogRef.current,
          detailsRef.current,
        );
      } else if (
        next === 'active' &&
        pendingNotificationResponse.current !== null
      ) {
        const data = pendingNotificationResponse.current;
        if (admitNotificationResponse(data)) {
          pendingNotificationResponse.current = null;
          void reviewNotificationRuntime
            .clearLastResponse()
            .catch(() => undefined);
        }
      }
    });
    return () => {
      removeResponse();
      appStateSubscription.remove();
    };
  }, [admitNotificationResponse, scheduleLiveReviewNotifications]);

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
    const uniqueReadableServers = [
      ...new Map(
        readableServers.map((server) => [
          server.gateway.authorizationScope.serverIdentity,
          server,
        ]),
      ).values(),
    ];
    if (uniqueReadableServers.length === 0) {
      const cached = cacheWorkspaceCatalog(catalogRef.current);
      catalogRef.current = cached;
      setCatalog(cached);
      setDetails([]);
      const unavailable = aggregateServerStatuses({});
      statusRef.current = unavailable;
      setStatus(unavailable);
      setServerStatuses({});
      return;
    }
    const unregister = uniqueReadableServers.map((server) =>
      registerWorkspaceOperation(
        server.gateway.authorizationScope.serverIdentity,
        controller,
      ),
    );
    const cached = cacheWorkspaceCatalog(catalogRef.current);
    catalogRef.current = cached;
    setCatalog(cached);
    const refreshingStatuses = Object.fromEntries(
      uniqueReadableServers.map((server) => [
        server.gateway.authorizationScope.serverIdentity,
        {
          ...INITIAL_STATUS,
          phase: 'loading' as const,
          message: 'Refreshing typed workspace relations',
        },
      ]),
    );
    serverStatusesRef.current = refreshingStatuses;
    setServerStatuses(refreshingStatuses);
    setStatus((current) => ({
      ...current,
      phase: current.phase === 'loading' ? 'loading' : 'stale',
      message: 'Refreshing bounded multi-server workspace relations',
    }));
    try {
      const recovered: ReviewReceiptProjection[] = [];
      let pending: readonly ReviewV2ReceiptHandle[] = [];
      let selectedReadFailed = false;
      if (
        gateway !== null &&
        gateway.reviewEffectKinds.length > 0 &&
        gateway.authorizationScope.actions.includes('get_review_receipt')
      ) {
        try {
          pending = await gateway.pendingReviewReceipts();
          for (const handle of pending) {
            if (controller.signal.aborted) return;
            const result = await gateway.reconcileReviewAction(
              handle.idempotency_key,
              controller.signal,
            );
            recovered.push({
              projectId: handle.project,
              workspaceId: handle.workspace_id,
              actionKind: handle.action_kind,
              receipt: result.receipt,
            });
          }
          pending = await gateway.pendingReviewReceipts();
        } catch {
          selectedReadFailed = true;
        }
      }
      if (controller.signal.aborted) return;
      const outcomes: {
        readonly server: WorkspaceReadServer;
        readonly built?: Awaited<
          ReturnType<typeof buildWorkspaceServerCatalog>
        >;
        readonly error?: unknown;
      }[] = [];
      for (
        let offset = 0;
        offset < uniqueReadableServers.length;
        offset += MAX_PARALLEL_WORKSPACE_SERVERS
      ) {
        const batch = uniqueReadableServers.slice(
          offset,
          offset + MAX_PARALLEL_WORKSPACE_SERVERS,
        );
        outcomes.push(
          ...(await Promise.all(
            batch.map(async (server) => {
              if (
                selectedReadFailed &&
                gateway?.authorizationScope.serverIdentity ===
                  server.gateway.authorizationScope.serverIdentity
              ) {
                return {
                  server,
                  error: new Error('review_reconciliation_unavailable'),
                };
              }
              try {
                return {
                  server,
                  built: await buildWorkspaceServerCatalog({
                    gateway: server.gateway,
                    origin: server.profile.origin,
                    serverLabel: serverLabel(server.profile),
                    signal: controller.signal,
                  }),
                };
              } catch (error) {
                return { server, error };
              }
            }),
          )),
        );
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      const successful = outcomes.flatMap((outcome) =>
        outcome.built === undefined ? [] : [outcome.built],
      );
      const merged = mergeWorkspaceCatalogServers(
        cached,
        successful.map((built) => ({
          profile: built.profile,
          successfulProjectIds: built.successfulProjectIds,
          failedProjectIds: built.failedProjectIds,
        })),
      );
      const selectedMutationIdentity =
        gateway?.authorizationScope.serverIdentity ?? null;
      const next =
        selectedMutationIdentity !== null &&
        merged.servers.some(
          (server) => server.serverIdentity === selectedMutationIdentity,
        )
          ? { ...merged, selectedServerIdentity: selectedMutationIdentity }
          : merged;
      if (successful[0] !== undefined) {
        await persistWorkspaceCatalogCache(
          {
            schema: 'automonique.mobile-workspace-cache/v1',
            catalog: next,
            intentDrafts: draftsRef.current,
          },
          successful[0].profile.serverIdentity,
          successful[0].profile.authorizationRevision,
        );
      }
      if (controller.signal.aborted) return;
      catalogRef.current = next;
      setCatalog(next);
      const successfulIdentities = new Set(
        successful.map((built) => built.profile.serverIdentity),
      );
      const nextDetails = [
        ...successful.flatMap((built) => built.details),
        ...detailsRef.current.filter(
          (detail) => !successfulIdentities.has(detail.serverIdentity),
        ),
      ];
      setDetails(nextDetails);
      detailsRef.current = nextDetails;
      setPendingReviewReceipts(pending);
      setReviewReceipts((current) => [
        ...recovered,
        ...current.filter(
          (projection) =>
            !recovered.some(
              (candidate) =>
                candidate.receipt.idempotency_key ===
                projection.receipt.idempotency_key,
            ),
        ),
      ]);
      const nextServerStatuses = Object.fromEntries(
        outcomes.map((outcome) => {
          const identity =
            outcome.server.gateway.authorizationScope.serverIdentity;
          if (outcome.built !== undefined) {
            return [identity, liveServerStatus(outcome.built)];
          }
          return [
            identity,
            {
              ...INITIAL_STATUS,
              phase: 'stale' as const,
              message:
                outcome.error instanceof Error &&
                outcome.error.message === 'workspace_catalog_resync_required'
                  ? 'Workspace revisions changed unexpectedly; a clean refresh is required'
                  : 'Server refresh unavailable; admitted cache remains read only',
            },
          ];
        }),
      );
      serverStatusesRef.current = nextServerStatuses;
      setServerStatuses(nextServerStatuses);
      const nextStatus = aggregateServerStatuses(nextServerStatuses);
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      const response = pendingNotificationResponse.current;
      if (response !== null && admitNotificationResponse(response)) {
        pendingNotificationResponse.current = null;
        void reviewNotificationRuntime
          .clearLastResponse()
          .catch(() => undefined);
      }
      await scheduleLiveReviewNotifications(next, nextDetails);
    } catch (error) {
      if (controller.signal.aborted) return;
      const cached = cacheWorkspaceCatalog(catalogRef.current);
      catalogRef.current = cached;
      setCatalog(cached);
      setDetails([]);
      const failedStatuses = Object.fromEntries(
        uniqueReadableServers.map((server) => [
          server.gateway.authorizationScope.serverIdentity,
          {
            ...INITIAL_STATUS,
            phase: 'stale' as const,
            message:
              'Server refresh unavailable; admitted cache remains read only',
          },
        ]),
      );
      serverStatusesRef.current = failedStatuses;
      setServerStatuses(failedStatuses);
      const failedStatus = {
        ...INITIAL_STATUS,
        phase: 'stale',
        message:
          error instanceof Error &&
          error.message === 'workspace_catalog_resync_required'
            ? 'Workspace revisions changed unexpectedly; a clean refresh is required'
            : 'Workspace refresh unavailable; showing admitted cache read only',
      } as const;
      statusRef.current = failedStatus;
      setStatus(failedStatus);
    } finally {
      for (const remove of unregister) remove();
    }
  }, [
    admitNotificationResponse,
    gateway,
    readableServers,
    scheduleLiveReviewNotifications,
  ]);

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
    }): Promise<ReviewActionSubmission> => {
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
          const receipt = result.receipt;
          setReviewReceipts((current) => [
            {
              projectId: options.projectId,
              workspaceId: options.workspaceId,
              actionKind: options.action.kind,
              receipt,
            },
            ...current.filter(
              (projection) =>
                projection.receipt.idempotency_key !== receipt.idempotency_key,
            ),
          ]);
        }
        await refresh();
        return result;
      } finally {
        reviewOperation.current = false;
        setReviewBusy(false);
      }
    },
    [gateway, profile, refresh],
  );

  const reconcileReviewAction = useCallback(
    async (idempotencyKey: string): Promise<ReviewActionReconciliation> => {
      if (gateway === null || profile === null || reviewOperation.current) {
        throw new Error('review_reconciliation_unavailable');
      }
      const handle = pendingReviewReceipts.find(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (handle === undefined) {
        throw new Error('review_receipt_handle_missing');
      }
      reviewOperation.current = true;
      setReviewBusy(true);
      try {
        const result = await gateway.reconcileReviewAction(idempotencyKey);
        setReviewReceipts((current) => [
          {
            projectId: result.handle.project,
            workspaceId: result.handle.workspace_id,
            actionKind: result.handle.action_kind,
            receipt: result.receipt,
          },
          ...current.filter(
            (projection) =>
              projection.receipt.idempotency_key !== idempotencyKey,
          ),
        ]);
        await refresh();
        return result;
      } finally {
        reviewOperation.current = false;
        setReviewBusy(false);
      }
    },
    [gateway, pendingReviewReceipts, profile, refresh],
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
          const cachedStatuses = Object.fromEntries(
            cache.catalog.servers.map((server) => [
              server.serverIdentity,
              {
                ...INITIAL_STATUS,
                phase: 'stale' as const,
                message: 'Admitted cached workspace inventory · read only',
              },
            ]),
          );
          serverStatusesRef.current = cachedStatuses;
          setServerStatuses(cachedStatuses);
          const cachedStatus = {
            ...INITIAL_STATUS,
            phase: 'stale',
            message: 'Admitted cached workspace inventory · read only',
          } as const;
          statusRef.current = cachedStatus;
          setStatus(cachedStatus);
        }
      }
      if (active) await refresh();
    })();
    return () => {
      active = false;
      operation.current?.abort('workspace_provider_unmounted');
    };
  }, [generationKey, refresh]);

  const selectServer = useCallback(
    async (identity: ServerIdentity) => {
      if (
        !catalogRef.current.servers.some(
          (server) => server.serverIdentity === identity,
        )
      )
        return;
      const next = { ...catalogRef.current, selectedServerIdentity: identity };
      catalogRef.current = next;
      setCatalog(next);
      if (selectMutationServer === undefined) return;
      const readable = readableServers.find(
        (server) =>
          server.gateway.authorizationScope.serverIdentity === identity,
      );
      if (readable !== undefined) await selectMutationServer(readable.slotId);
    },
    [readableServers, selectMutationServer],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        catalog,
        status,
        serverStatuses,
        details,
        reviewBusy,
        reviewReceipts,
        pendingReviewReceipts,
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
        reconcileReviewAction,
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
