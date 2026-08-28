// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  loadAttentionNotificationKeys,
  recordAttentionNotification,
  revokeAttentionNotificationRecords,
} from './attention-notification-store';
import {
  attentionNotificationKey,
  type DecodedAttentionNotification,
} from './review-notifications';
import type { ServerIdentity } from './workspace-companion';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const server = `sha256:${'a'.repeat(64)}` as ServerIdentity;
const review: DecodedAttentionNotification = {
  target: 'review',
  request: {
    serverIdentity: server,
    authorizationRevision: '8',
    principalGeneration: '3',
    workspaceId: 'workspace-35',
    workspaceRevision: '4',
    reviewRevision: '9',
    fileId: 'file-1',
    hunkId: 'hunk-1',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
});

test('a delivered coordinate survives killed-app hydration without content', async () => {
  await recordAttentionNotification(review, 100);
  const encoded = jest.mocked(AsyncStorage.setItem).mock.calls[0]?.[1];
  expect(encoded).toEqual(expect.any(String));
  expect(encoded).not.toMatch(/token|title|body|comment body/iu);

  jest.mocked(AsyncStorage.getItem).mockResolvedValue(encoded!);
  await expect(loadAttentionNotificationKeys()).resolves.toEqual([
    attentionNotificationKey(review),
  ]);
});

test('dedupe is generation-bound and revocation removes only the exact server', async () => {
  const rotated: DecodedAttentionNotification = {
    ...review,
    request: { ...review.request, authorizationRevision: '9' },
  };
  await recordAttentionNotification(review, 100);
  let encoded = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1];
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(encoded!);
  await recordAttentionNotification(rotated, 101);
  encoded = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1];
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(encoded!);
  await expect(loadAttentionNotificationKeys()).resolves.toEqual([
    attentionNotificationKey(rotated),
    attentionNotificationKey(review),
  ]);

  await revokeAttentionNotificationRecords(server);
  const revoked = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1];
  expect(JSON.parse(revoked!).records).toEqual([]);
});

test('malformed persisted state is discarded rather than widening dedupe', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('{"schema":"future"}');
  await expect(loadAttentionNotificationKeys()).resolves.toEqual([]);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
});
