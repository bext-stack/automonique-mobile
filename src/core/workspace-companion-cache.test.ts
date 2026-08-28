// SPDX-License-Identifier: Elastic-2.0

import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from './workspace-fixtures';
import {
  MAX_WORKSPACE_COMPANION_CACHE_BYTES,
  decodeWorkspaceCompanionCache,
  encodeWorkspaceCompanionCache,
} from './workspace-companion-cache';
import {
  MAX_WORKSPACE_REVISION_TOMBSTONES,
  reduceWorkspaceCompanionCatalog,
} from './workspace-companion';
import { decimalRevision } from './types';

test('cached workspace reads restore stale with mutation and terminal authority removed', () => {
  const encoded = encodeWorkspaceCompanionCache({
    schema: 'automonique.mobile-workspace-cache/v2',
    catalog: {
      ...workspaceCompanionFixture,
      servers: workspaceCompanionFixture.servers.map((server) => ({
        ...server,
        actions: [...server.actions, 'terminal_relay'],
      })),
    },
    intentDrafts: [
      {
        kind: 'create',
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        hostId: 'host-fr-1',
        projectId: 'project-mobile',
        task: { provider: 'GitHub', key: '#34', title: 'Workspace companion' },
        idempotencyKey: 'draft-34',
      },
    ],
  });
  const restored = decodeWorkspaceCompanionCache(encoded);

  expect(restored.catalog.phase).toBe('stale');
  expect(restored.catalog.servers[0]).toMatchObject({
    authorization: 'cached',
    actions: ['workspace_read'],
  });
  expect(restored.intentDrafts).toHaveLength(1);
});

test('cache rejects authority previews, unknown fields, and oversized input', () => {
  const hiddenAuthority = {
    schema: 'automonique.mobile-workspace-cache/v2',
    catalog: workspaceCompanionFixture,
    intentDrafts: [],
    authorityPreview: { summary: ['must not persist'] },
  };
  expect(() =>
    decodeWorkspaceCompanionCache(JSON.stringify(hiddenAuthority)),
  ).toThrow('workspace_companion_cache_invalid');
  expect(() =>
    decodeWorkspaceCompanionCache(
      'x'.repeat(MAX_WORKSPACE_COMPANION_CACHE_BYTES + 1),
    ),
  ).toThrow('workspace_companion_cache_too_large');
});

test('legacy cache is rejected instead of reinterpreting retained IDs as work-session IDs', () => {
  const legacy = JSON.parse(
    encodeWorkspaceCompanionCache({
      schema: 'automonique.mobile-workspace-cache/v2',
      catalog: workspaceCompanionFixture,
      intentDrafts: [],
    }),
  );
  legacy.schema = 'automonique.mobile-workspace-cache/v1';
  legacy.catalog.schema = 'automonique.mobile-workspace-companion/v1';

  expect(() => decodeWorkspaceCompanionCache(JSON.stringify(legacy))).toThrow(
    'workspace_companion_cache_invalid',
  );
});

test('cache preserves server authorization tombstones across restart', () => {
  const encoded = encodeWorkspaceCompanionCache({
    schema: 'automonique.mobile-workspace-cache/v2',
    catalog: {
      ...workspaceCompanionFixture,
      selectedServerIdentity: null,
      servers: [],
      serverTombstones: [
        {
          serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
          origin: 'https://ops.example.test',
          tenantId: 'tenant-delivery',
          authorizationRevision:
            workspaceCompanionFixture.servers[0]!.authorizationRevision,
        },
      ],
    },
    intentDrafts: [],
  });

  expect(
    decodeWorkspaceCompanionCache(encoded).catalog.serverTombstones,
  ).toHaveLength(1);
});

test('cache rejects rather than truncates oversized revision fences', () => {
  expect(() =>
    encodeWorkspaceCompanionCache({
      schema: 'automonique.mobile-workspace-cache/v2',
      catalog: {
        ...workspaceCompanionFixture,
        revisionTombstones: Array.from(
          { length: MAX_WORKSPACE_REVISION_TOMBSTONES + 1 },
          (_, index) => ({
            objectType: 'workspace' as const,
            serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
            workspaceId: `w${index}`,
            objectId: `w${index}`,
            revision: decimalRevision('1'),
          }),
        ),
      },
      intentDrafts: [],
    }),
  ).toThrow('workspace_companion_cache_invalid');
});

test('cache restart preserves nested high-water marks from revocation', () => {
  const revoked = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  revoked.generatedAt = '2026-08-27T10:01:00Z';
  revoked.selectedServerIdentity = null;
  revoked.servers[0].authorization = 'revoked';
  revoked.servers[0].authorizationRevision = '9';
  revoked.servers[0].workspaces[0].revision = '13';
  revoked.servers[0].workspaces[0].attempt.revision = '5';
  revoked.servers[0].workspaces[0].sessions[0].revision = '10';
  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    revoked,
  );
  const restored = decodeWorkspaceCompanionCache(
    encodeWorkspaceCompanionCache({
      schema: 'automonique.mobile-workspace-cache/v2',
      catalog: removal.catalog,
      intentDrafts: [],
    }),
  );

  const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  replay.generatedAt = '2026-08-27T10:02:00Z';
  replay.servers[0].authorizationRevision = '10';
  replay.servers[0].workspaces[0].revision = '13';
  replay.servers[0].workspaces[0].attempt.revision = '5';
  replay.servers[0].workspaces[0].sessions[0].revision = '10';
  expect(
    reduceWorkspaceCompanionCatalog(restored.catalog, replay).resyncRequired,
  ).toBe(true);
});
