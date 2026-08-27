// SPDX-License-Identifier: Elastic-2.0

import {
  cacheWorkspaceCatalog,
  mergeWorkspaceCatalogServer,
  revokeWorkspaceCatalogServer,
} from './workspace-catalog-reducer';
import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from './workspace-fixtures';

test('cached catalogs lose live destination admission and all mutation actions', () => {
  const cached = cacheWorkspaceCatalog(workspaceCompanionFixture);
  expect(cached.phase).toBe('stale');
  expect(cached.servers[0]).toMatchObject({
    authorization: 'cached',
    actions: ['workspace_read'],
  });
});

test('one exact server revocation removes its projection and retains a monotone tombstone', () => {
  const revoked = revokeWorkspaceCatalogServer(
    workspaceCompanionFixture,
    WORKSPACE_FIXTURE_IDENTITY,
  );
  expect(revoked.servers).toEqual([]);
  expect(revoked.selectedServerIdentity).toBeNull();
  expect(revoked.serverTombstones).toEqual([
    expect.objectContaining({
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      authorizationRevision: '8',
    }),
  ]);
});

test('live replacement rejects a workspace revision rollback', () => {
  const profile = {
    ...workspaceCompanionFixture.servers[0]!,
    workspaces: workspaceCompanionFixture.servers[0]!.workspaces.map(
      (workspace) => ({ ...workspace, revision: '11' as never }),
    ),
  };
  expect(() =>
    mergeWorkspaceCatalogServer(workspaceCompanionFixture, profile),
  ).toThrow('workspace_catalog_resync_required');
});

test('a failed project retains its stale slice without poisoning unchanged recovery', () => {
  const server = workspaceCompanionFixture.servers[0]!;
  const otherHost = { ...server.hosts[0]!, id: 'host-other' };
  const otherProject = {
    id: 'project-other',
    hostIds: ['host-other'],
    label: 'Other',
  };
  const otherWorkspace = {
    ...server.workspaces[0]!,
    id: 'workspace-other',
    hostId: 'host-other',
    projectId: 'project-other',
    sessions: server.workspaces[0]!.sessions.map((session) => ({
      ...session,
      id: 'session-other',
      target: { ...session.target, id: 'session-other' },
    })),
  };
  const initial = {
    ...workspaceCompanionFixture,
    servers: [
      {
        ...server,
        hosts: [...server.hosts, otherHost],
        projects: [...server.projects, otherProject],
        workspaces: [...server.workspaces, otherWorkspace],
      },
    ],
  };
  const partialProfile = {
    ...server,
    authorizationRevision: '9' as never,
    principalGeneration: '4' as never,
  };
  const partial = mergeWorkspaceCatalogServer(
    initial,
    partialProfile,
    {
      successfulProjectIds: ['project-mobile'],
      failedProjectIds: ['project-other'],
    },
    Date.parse('2026-08-27T10:01:00Z'),
  );

  expect(partial.servers[0]).toMatchObject({
    staleProjectIds: ['project-other'],
    workspaces: expect.arrayContaining([
      expect.objectContaining({ id: 'workspace-other' }),
    ]),
  });
  expect(
    partial.revisionTombstones.some(
      (value) => value.workspaceId === 'workspace-other',
    ),
  ).toBe(false);

  expect(() =>
    mergeWorkspaceCatalogServer(
      partial,
      {
        ...initial.servers[0]!,
        authorizationRevision: '9' as never,
        principalGeneration: '4' as never,
        staleProjectIds: [],
      },
      {
        successfulProjectIds: ['project-mobile', 'project-other'],
        failedProjectIds: [],
      },
      Date.parse('2026-08-27T10:02:00Z'),
    ),
  ).not.toThrow();
});

test('a successful omission is tombstoned and equal-revision replay stays refused', () => {
  const server = workspaceCompanionFixture.servers[0]!;
  const omitted = mergeWorkspaceCatalogServer(
    workspaceCompanionFixture,
    { ...server, workspaces: [] },
    { successfulProjectIds: ['project-mobile'], failedProjectIds: [] },
    Date.parse('2026-08-27T10:01:00Z'),
  );
  expect(omitted.revisionTombstones).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ workspaceId: 'workspace-34' }),
    ]),
  );
  expect(() =>
    mergeWorkspaceCatalogServer(
      omitted,
      server,
      { successfulProjectIds: ['project-mobile'], failedProjectIds: [] },
      Date.parse('2026-08-27T10:02:00Z'),
    ),
  ).toThrow('workspace_catalog_resync_required');
});

test('a failed cold project is counted but cannot manufacture a tombstone', () => {
  const server = workspaceCompanionFixture.servers[0]!;
  const partial = mergeWorkspaceCatalogServer(
    {
      ...workspaceCompanionFixture,
      selectedServerIdentity: null,
      servers: [],
    },
    server,
    {
      successfulProjectIds: ['project-mobile'],
      failedProjectIds: ['project-never-loaded'],
    },
    Date.parse('2026-08-27T10:01:00Z'),
  );
  expect(partial.servers[0]!.staleProjectIds).toEqual([]);
  expect(partial.revisionTombstones).toEqual([]);
});
