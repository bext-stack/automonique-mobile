// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import { workspaceCompanionFixture } from './workspace-fixtures';
import type { WorkspaceCompanionCache } from './workspace-companion-cache';
import type { ServerIdentity } from './workspace-companion';
import { decimalRevision } from './types';
import {
  loadWorkspaceCatalogCache,
  loadReviewDrafts,
  loadWorkspaceDraft,
  MAX_WORKSPACE_DRAFTS,
  persistWorkspaceCatalogCache,
  persistWorkspaceCatalogCacheForServers,
  persistReviewDraft,
  persistWorkspaceDraft,
  registerWorkspaceOperation,
  revokeWorkspaceServerStorage,
} from './workspace-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const values = new Map<string, string>();

function identity(character: string): ServerIdentity {
  return `sha256:${character.repeat(64)}` as ServerIdentity;
}

function cacheFor(
  serverIdentity: ServerIdentity,
  authorizationRevision = '8',
): WorkspaceCompanionCache {
  return {
    schema: 'automonique.mobile-workspace-cache/v2',
    catalog: {
      ...workspaceCompanionFixture,
      selectedServerIdentity: serverIdentity,
      servers: workspaceCompanionFixture.servers.map((server) => ({
        ...server,
        serverIdentity,
        authorizationRevision: decimalRevision(authorizationRevision),
      })),
    },
    intentDrafts: [],
  };
}

beforeEach(() => {
  values.clear();
  jest.clearAllMocks();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    values.delete(key);
  });
});

test('legacy workspace cache key is discarded without admission', async () => {
  values.set(
    'automonique.mobile.workspace-catalog.v1',
    JSON.stringify({
      schema: 'automonique.mobile-workspace-cache/v1',
      catalog: { schema: 'automonique.mobile-workspace-companion/v1' },
      intentDrafts: [],
    }),
  );

  await expect(loadWorkspaceCatalogCache()).resolves.toBeNull();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    'automonique.mobile.workspace-catalog.v1',
  );
});

test('workspace drafts are bounded and keyed by exact server, authorization, and workspace revision', async () => {
  const serverIdentity = identity('c');
  for (let index = 0; index <= MAX_WORKSPACE_DRAFTS; index += 1) {
    await persistWorkspaceDraft(
      {
        serverIdentity,
        authorizationRevision: decimalRevision('9'),
        workspaceId: `workspace-${index}`,
        workspaceRevision: decimalRevision('1'),
      },
      `draft-${index}`,
      index + 1,
    );
  }

  await expect(
    loadWorkspaceDraft({
      serverIdentity,
      authorizationRevision: decimalRevision('9'),
      workspaceId: 'workspace-0',
      workspaceRevision: decimalRevision('1'),
    }),
  ).resolves.toBe('');
  await expect(
    loadWorkspaceDraft({
      serverIdentity,
      authorizationRevision: decimalRevision('9'),
      workspaceId: `workspace-${MAX_WORKSPACE_DRAFTS}`,
      workspaceRevision: decimalRevision('1'),
    }),
  ).resolves.toBe(`draft-${MAX_WORKSPACE_DRAFTS}`);
});

test('review drafts are line-anchored and isolated by principal, workspace, and review revisions', async () => {
  const serverIdentity = identity('9');
  const base = {
    serverIdentity,
    authorizationRevision: decimalRevision('14'),
    principalGeneration: decimalRevision('2'),
    projectId: 'project-mobile',
    workspaceId: 'workspace-review',
    workspaceRevision: decimalRevision('5'),
    reviewRevision: decimalRevision('7'),
    fileId: 'file-a',
    hunkId: 'hunk-a',
    side: 'new' as const,
    line: decimalRevision('12'),
  };
  await persistReviewDraft(base, 'line twelve', 100);
  await persistReviewDraft(
    { ...base, line: decimalRevision('13') },
    'line thirteen',
    101,
  );

  await expect(
    loadReviewDrafts({
      serverIdentity,
      authorizationRevision: decimalRevision('14'),
      principalGeneration: decimalRevision('2'),
      projectId: 'project-mobile',
      workspaceId: 'workspace-review',
      workspaceRevision: decimalRevision('5'),
      reviewRevision: decimalRevision('7'),
    }),
  ).resolves.toMatchObject([
    { text: 'line thirteen', line: '13' },
    { text: 'line twelve', line: '12' },
  ]);
  await expect(
    loadReviewDrafts({
      serverIdentity,
      authorizationRevision: decimalRevision('14'),
      principalGeneration: decimalRevision('3'),
      projectId: 'project-mobile',
      workspaceId: 'workspace-review',
      workspaceRevision: decimalRevision('5'),
      reviewRevision: decimalRevision('7'),
    }),
  ).resolves.toEqual([]);
});

test('same workspace revision remains isolated across authorization revisions', async () => {
  const serverIdentity = identity('a');
  const base = {
    serverIdentity,
    workspaceId: 'workspace-same',
    workspaceRevision: decimalRevision('4'),
  };
  await persistWorkspaceDraft(
    { ...base, authorizationRevision: decimalRevision('20') },
    'generation twenty',
    20,
  );
  await persistWorkspaceDraft(
    { ...base, authorizationRevision: decimalRevision('21') },
    'generation twenty-one',
    21,
  );

  await expect(
    loadWorkspaceDraft({
      ...base,
      authorizationRevision: decimalRevision('20'),
    }),
  ).resolves.toBe('generation twenty');
  await expect(
    loadWorkspaceDraft({
      ...base,
      authorizationRevision: decimalRevision('21'),
    }),
  ).resolves.toBe('generation twenty-one');
});

test('legacy draft envelopes fail closed instead of migrating authority scope', async () => {
  const serverIdentity = identity('b');
  values.set(
    'automonique.mobile.workspace-drafts.v1',
    JSON.stringify({
      schema: 'automonique.mobile-workspace-drafts/v1',
      drafts: [
        {
          serverIdentity,
          authorizationRevision: '30',
          workspaceId: 'workspace-legacy',
          workspaceRevision: '5',
          text: 'must not cross the schema boundary',
          updatedAtMs: '30',
        },
      ],
    }),
  );

  await expect(
    loadWorkspaceDraft({
      serverIdentity,
      authorizationRevision: decimalRevision('30'),
      workspaceId: 'workspace-legacy',
      workspaceRevision: decimalRevision('5'),
    }),
  ).resolves.toBe('');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    'automonique.mobile.workspace-drafts.v1',
  );
});

test('revoke and regrant cannot restore an old-generation draft', async () => {
  const serverIdentity = identity('1');
  const base = {
    serverIdentity,
    workspaceId: 'workspace-regrant',
    workspaceRevision: decimalRevision('6'),
  };
  await persistWorkspaceDraft(
    { ...base, authorizationRevision: decimalRevision('40') },
    'old grant',
  );
  await revokeWorkspaceServerStorage(serverIdentity, '40');
  await persistWorkspaceDraft(
    { ...base, authorizationRevision: decimalRevision('41') },
    'new grant',
  );

  await expect(
    loadWorkspaceDraft({
      ...base,
      authorizationRevision: decimalRevision('40'),
    }),
  ).resolves.toBe('');
  await expect(
    loadWorkspaceDraft({
      ...base,
      authorizationRevision: decimalRevision('41'),
    }),
  ).resolves.toBe('new grant');
});

test('revocation aborts active work and purges catalog plus indexed drafts', async () => {
  const serverIdentity = identity('d');
  await persistWorkspaceCatalogCache(
    cacheFor(serverIdentity, '10'),
    serverIdentity,
    decimalRevision('10'),
  );
  await persistWorkspaceDraft(
    {
      serverIdentity,
      authorizationRevision: decimalRevision('10'),
      workspaceId: 'workspace-sensitive',
      workspaceRevision: decimalRevision('2'),
    },
    'private task context',
  );
  await persistReviewDraft(
    {
      serverIdentity,
      authorizationRevision: decimalRevision('10'),
      principalGeneration: decimalRevision('1'),
      projectId: 'project-mobile',
      workspaceId: 'workspace-sensitive',
      workspaceRevision: decimalRevision('2'),
      reviewRevision: decimalRevision('3'),
      fileId: 'file-sensitive',
      hunkId: 'hunk-sensitive',
      side: 'new',
      line: decimalRevision('1'),
    },
    'private review comment',
  );
  const controller = new AbortController();
  registerWorkspaceOperation(serverIdentity, controller);

  await revokeWorkspaceServerStorage(serverIdentity, '10');

  expect(controller.signal.aborted).toBe(true);
  await expect(loadWorkspaceCatalogCache()).resolves.toMatchObject({
    catalog: { servers: [] },
  });
  await expect(
    loadWorkspaceDraft({
      serverIdentity,
      authorizationRevision: decimalRevision('10'),
      workspaceId: 'workspace-sensitive',
      workspaceRevision: decimalRevision('2'),
    }),
  ).resolves.toBe('');
  await expect(
    loadReviewDrafts({
      serverIdentity,
      authorizationRevision: decimalRevision('10'),
      principalGeneration: decimalRevision('1'),
      projectId: 'project-mobile',
      workspaceId: 'workspace-sensitive',
      workspaceRevision: decimalRevision('2'),
      reviewRevision: decimalRevision('3'),
    }),
  ).resolves.toEqual([]);
});

test('a revocation queued behind an in-flight write wins and fences later old writes', async () => {
  const serverIdentity = identity('e');
  let releaseFirstWrite!: () => void;
  let announceFirstWrite!: () => void;
  const firstWriteStarted = new Promise<void>((resolve) => {
    announceFirstWrite = resolve;
  });
  let first = true;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (first) {
      first = false;
      announceFirstWrite();
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
    }
    values.set(key, value);
  });
  const cache = cacheFor(serverIdentity, '11');
  const write = persistWorkspaceCatalogCache(
    cache,
    serverIdentity,
    decimalRevision('11'),
  );
  await firstWriteStarted;
  const revoke = revokeWorkspaceServerStorage(serverIdentity, '11');
  releaseFirstWrite();
  await write;
  await revoke;

  await expect(loadWorkspaceCatalogCache()).resolves.toMatchObject({
    catalog: { servers: [] },
  });
  await expect(
    persistWorkspaceCatalogCache(cache, serverIdentity, decimalRevision('11')),
  ).rejects.toThrow('workspace_generation_revoked');
});

test('a sibling cache write cannot resurrect a revoked server generation', async () => {
  const firstIdentity = identity('4');
  const secondIdentity = identity('5');
  const first = cacheFor(firstIdentity, '21');
  const secondServer = cacheFor(secondIdentity, '22').catalog.servers[0]!;
  const multiServer: WorkspaceCompanionCache = {
    ...first,
    catalog: {
      ...first.catalog,
      servers: [...first.catalog.servers, secondServer],
    },
  };
  const generations = multiServer.catalog.servers.map((server) => ({
    serverIdentity: server.serverIdentity,
    authorizationRevision: server.authorizationRevision,
  }));
  await persistWorkspaceCatalogCacheForServers(multiServer, generations);

  await revokeWorkspaceServerStorage(secondIdentity, '22');
  await expect(loadWorkspaceCatalogCache()).resolves.toMatchObject({
    catalog: { servers: [{ serverIdentity: firstIdentity }] },
  });

  await expect(
    persistWorkspaceCatalogCacheForServers(multiServer, generations),
  ).rejects.toThrow('workspace_generation_revoked');
  await expect(loadWorkspaceCatalogCache()).resolves.toMatchObject({
    catalog: { servers: [{ serverIdentity: firstIdentity }] },
  });
});

test('an absent revoked sibling intent draft cannot cross an A-only cache fence', async () => {
  const firstIdentity = identity('8');
  const revokedIdentity = identity('9');
  await revokeWorkspaceServerStorage(revokedIdentity, '30');
  jest.clearAllMocks();
  const cache: WorkspaceCompanionCache = {
    ...cacheFor(firstIdentity, '31'),
    intentDrafts: [
      {
        kind: 'create',
        serverIdentity: revokedIdentity,
        hostId: 'host-revoked',
        projectId: 'project-revoked',
        task: {
          provider: 'GitHub',
          key: '#34',
          title: 'Must not survive sibling revocation',
        },
        idempotencyKey: 'revoked-sibling-draft',
      },
    ],
  };

  await expect(
    persistWorkspaceCatalogCacheForServers(cache, [
      {
        serverIdentity: firstIdentity,
        authorizationRevision: decimalRevision('31'),
      },
    ]),
  ).rejects.toThrow('workspace_cache_generation_scope_invalid');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a queued multi-server cache write re-checks its abort signal', async () => {
  const blockerIdentity = identity('6');
  const serverIdentity = identity('7');
  let releaseBlocker!: () => void;
  let announceBlocker!: () => void;
  const blockerStarted = new Promise<void>((resolve) => {
    announceBlocker = resolve;
  });
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementationOnce(async (key, value) => {
      announceBlocker();
      await new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      values.set(key, value);
    });
  const blocker = persistWorkspaceCatalogCache(
    cacheFor(blockerIdentity, '23'),
    blockerIdentity,
    decimalRevision('23'),
  );
  await blockerStarted;
  const cache = cacheFor(serverIdentity, '24');
  const controller = new AbortController();
  const queued = persistWorkspaceCatalogCacheForServers(
    cache,
    [
      {
        serverIdentity,
        authorizationRevision: decimalRevision('24'),
      },
    ],
    controller.signal,
  );
  controller.abort('slot_generation_replaced');
  releaseBlocker();
  await blocker;

  await expect(queued).rejects.toThrow('workspace_generation_replaced');
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});

test('revocation cleanup failure is surfaced while the old generation remains fenced', async () => {
  const serverIdentity = identity('f');
  const cache = cacheFor(serverIdentity, '12');
  await persistWorkspaceCatalogCache(
    cache,
    serverIdentity,
    decimalRevision('12'),
  );
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('storage_unavailable'));

  await expect(
    revokeWorkspaceServerStorage(serverIdentity, '12'),
  ).rejects.toThrow('storage_unavailable');
  await expect(
    persistWorkspaceCatalogCache(cache, serverIdentity, decimalRevision('12')),
  ).rejects.toThrow('workspace_generation_revoked');
});
