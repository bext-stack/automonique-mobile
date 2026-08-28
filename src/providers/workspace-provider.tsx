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

import type { ConnectionProfile } from '@/core/credential-store';
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
  const [catalog, setCatalog] = useState<WorkspaceCompanionCatalog>(() =>
    emptyWorkspaceCatalog(),
  );
  const [details, setDetails] = useState<readonly WorkspaceCatalogDetail[]>([]);
  const [status, setStatus] = useState<WorkspaceCatalogStatus>(INITIAL_STATUS);
  const catalogRef = useRef(catalog);
  const draftsRef = useRef<WorkspaceCompanionCache['intentDrafts']>([]);
  const operation = useRef<AbortController | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

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
