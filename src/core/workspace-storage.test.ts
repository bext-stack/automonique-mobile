// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import { workspaceCompanionFixture } from './workspace-fixtures';
import type { WorkspaceCompanionCache } from './workspace-companion-cache';
import type { ServerIdentity } from './workspace-companion';
import { decimalRevision } from './types';
import {
  loadWorkspaceCatalogCache,
  loadWorkspaceDraft,
  MAX_WORKSPACE_DRAFTS,
  persistWorkspaceCatalogCache,
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
    schema: 'automonique.mobile-workspace-cache/v1',
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

test('workspace drafts are bounded and keyed by exact server/workspace revision', async () => {
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
