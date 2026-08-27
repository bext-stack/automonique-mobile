// SPDX-License-Identifier: Elastic-2.0

import {
  WORKSPACE_COMPANION_SCHEMA,
  admitWorkspaceCompanionCatalog,
  reduceWorkspaceCompanionCatalog,
  type ScopedServerProfile,
  type ServerIdentity,
  type WorkspaceCompanionCatalog,
  type WorkspaceRevisionTombstone,
} from './workspace-companion';

export function emptyWorkspaceCatalog(
  now = Date.now(),
): WorkspaceCompanionCatalog {
  return {
    schema: WORKSPACE_COMPANION_SCHEMA,
    phase: 'stale',
    generatedAt: new Date(now).toISOString(),
    selectedServerIdentity: null,
    servers: [],
    serverTombstones: [],
    revisionTombstones: [],
  };
}

function key(value: WorkspaceRevisionTombstone): string {
  return `${value.serverIdentity}:${value.workspaceId}:${value.objectType}:${value.objectId}`;
}

function visibleKeys(server: ScopedServerProfile): Set<string> {
  const keys = new Set<string>();
  for (const workspace of server.workspaces) {
    keys.add(
      `${server.serverIdentity}:${workspace.id}:workspace:${workspace.id}`,
    );
    if (workspace.attempt !== null) {
      keys.add(
        `${server.serverIdentity}:${workspace.id}:attempt:${workspace.attempt.id}`,
      );
    }
    for (const session of workspace.sessions) {
      keys.add(
        `${server.serverIdentity}:${workspace.id}:session:${session.id}`,
      );
    }
  }
  return keys;
}

function removedTombstones(
  previous: ScopedServerProfile | undefined,
  next: ScopedServerProfile,
): WorkspaceRevisionTombstone[] {
  if (previous === undefined) return [];
  const nextKeys = visibleKeys(next);
  const removed: WorkspaceRevisionTombstone[] = [];
  for (const workspace of previous.workspaces) {
    const workspaceValue: WorkspaceRevisionTombstone = {
      objectType: 'workspace',
      serverIdentity: previous.serverIdentity,
      workspaceId: workspace.id,
      objectId: workspace.id,
      revision: workspace.revision,
    };
    if (!nextKeys.has(key(workspaceValue))) removed.push(workspaceValue);
    if (workspace.attempt !== null) {
      const value: WorkspaceRevisionTombstone = {
        objectType: 'attempt',
        serverIdentity: previous.serverIdentity,
        workspaceId: workspace.id,
        objectId: workspace.attempt.id,
        revision: workspace.attempt.revision,
      };
      if (!nextKeys.has(key(value))) removed.push(value);
    }
    for (const session of workspace.sessions) {
      const value: WorkspaceRevisionTombstone = {
        objectType: 'session',
        serverIdentity: previous.serverIdentity,
        workspaceId: workspace.id,
        objectId: session.id,
        revision: session.revision,
      };
      if (!nextKeys.has(key(value))) removed.push(value);
    }
  }
  return removed;
}

export function cacheWorkspaceCatalog(
  catalog: WorkspaceCompanionCatalog,
  now = Date.now(),
): WorkspaceCompanionCatalog {
  return admitWorkspaceCompanionCatalog({
    ...catalog,
    phase: 'stale',
    generatedAt: new Date(now).toISOString(),
    servers: catalog.servers.map((server) => ({
      ...server,
      authorization: 'cached',
      actions: server.actions.includes('workspace_read')
        ? ['workspace_read']
        : [],
    })),
  });
}

export function mergeWorkspaceCatalogServer(
  catalog: WorkspaceCompanionCatalog,
  profile: ScopedServerProfile,
  projectCoverage: {
    readonly successfulProjectIds: readonly string[];
    readonly failedProjectIds: readonly string[];
  } = {
    successfulProjectIds: profile.projects.map((project) => project.id),
    failedProjectIds: [],
  },
  now = Date.now(),
): WorkspaceCompanionCatalog {
  const previous = catalog.servers.find(
    (server) => server.serverIdentity === profile.serverIdentity,
  );
  const successful = new Set(projectCoverage.successfulProjectIds);
  const failed = new Set(projectCoverage.failedProjectIds);
  if ([...successful].some((projectId) => failed.has(projectId))) {
    throw new Error('workspace_catalog_project_coverage_invalid');
  }
  if (
    profile.projects.some(
      (project) => failed.has(project.id) || !successful.has(project.id),
    )
  ) {
    throw new Error('workspace_catalog_project_coverage_invalid');
  }
  const retainedProjects =
    previous?.projects.filter((project) => failed.has(project.id)) ?? [];
  const retainedProjectIds = new Set(
    retainedProjects.map((project) => project.id),
  );
  const retainedHostIds = new Set(
    retainedProjects.flatMap((project) => project.hostIds),
  );
  const combinedProfile: ScopedServerProfile = {
    ...profile,
    hosts: [
      ...profile.hosts,
      ...(previous?.hosts
        .filter(
          (host) =>
            retainedHostIds.has(host.id) &&
            !profile.hosts.some((candidate) => candidate.id === host.id),
        )
        .map((host) => ({
          ...host,
          freshness: { ...host.freshness, state: 'delayed' as const },
        })) ?? []),
    ],
    projects: [
      ...profile.projects,
      ...retainedProjects.filter(
        (project) =>
          !profile.projects.some((candidate) => candidate.id === project.id),
      ),
    ],
    workspaces: [
      ...profile.workspaces,
      ...(previous?.workspaces
        .filter(
          (workspace) =>
            retainedProjectIds.has(workspace.projectId) &&
            !profile.workspaces.some(
              (candidate) => candidate.id === workspace.id,
            ),
        )
        .map((workspace) => ({
          ...workspace,
          freshness: { ...workspace.freshness, state: 'delayed' as const },
        })) ?? []),
    ],
    staleProjectIds: [...retainedProjectIds].sort(),
  };
  const servers = [
    ...catalog.servers
      .filter((server) => server.serverIdentity !== profile.serverIdentity)
      .map((server) => ({
        ...server,
        authorization: 'cached' as const,
        actions: ['workspace_read'] as const,
      })),
    combinedProfile,
  ];
  const visible = visibleKeys(combinedProfile);
  const tombstones = new Map(
    catalog.revisionTombstones
      .filter((value) => !visible.has(key(value)))
      .map((value) => [key(value), value]),
  );
  for (const value of removedTombstones(previous, combinedProfile)) {
    const current = tombstones.get(key(value));
    if (
      current === undefined ||
      BigInt(value.revision) > BigInt(current.revision)
    ) {
      tombstones.set(key(value), value);
    }
  }
  const next: WorkspaceCompanionCatalog = {
    schema: WORKSPACE_COMPANION_SCHEMA,
    phase: 'live',
    generatedAt: new Date(now).toISOString(),
    selectedServerIdentity: combinedProfile.serverIdentity,
    servers,
    serverTombstones: catalog.serverTombstones.filter(
      (value) => value.serverIdentity !== combinedProfile.serverIdentity,
    ),
    revisionTombstones: [...tombstones.values()],
  };
  const reduced = reduceWorkspaceCompanionCatalog(catalog, next);
  if (reduced.resyncRequired)
    throw new Error('workspace_catalog_resync_required');
  return reduced.catalog;
}

export function revokeWorkspaceCatalogServer(
  catalog: WorkspaceCompanionCatalog,
  serverIdentity: ServerIdentity,
  now = Date.now(),
): WorkspaceCompanionCatalog {
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === serverIdentity,
  );
  if (server === undefined) return cacheWorkspaceCatalog(catalog, now);
  const objectTombstones = removedTombstones(server, {
    ...server,
    workspaces: [],
  });
  const revisionTombstones = new Map(
    [...catalog.revisionTombstones, ...objectTombstones].map((value) => [
      key(value),
      value,
    ]),
  );
  const next: WorkspaceCompanionCatalog = {
    ...cacheWorkspaceCatalog(catalog, now),
    phase: 'live',
    selectedServerIdentity:
      catalog.selectedServerIdentity === serverIdentity
        ? null
        : catalog.selectedServerIdentity,
    servers: catalog.servers
      .filter((candidate) => candidate.serverIdentity !== serverIdentity)
      .map((candidate) => ({
        ...candidate,
        authorization: 'cached' as const,
        actions: candidate.actions.includes('workspace_read')
          ? (['workspace_read'] as const)
          : [],
      })),
    serverTombstones: [
      ...catalog.serverTombstones.filter(
        (candidate) => candidate.serverIdentity !== serverIdentity,
      ),
      {
        serverIdentity,
        origin: server.origin,
        tenantId: server.tenantId,
        authorizationRevision: server.authorizationRevision,
      },
    ],
    revisionTombstones: [...revisionTombstones.values()],
  };
  const reduced = reduceWorkspaceCompanionCatalog(catalog, next);
  if (reduced.resyncRequired)
    throw new Error('workspace_catalog_revoke_resync_required');
  return reduced.catalog;
}
