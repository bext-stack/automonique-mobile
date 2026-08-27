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
