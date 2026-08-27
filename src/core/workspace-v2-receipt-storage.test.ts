// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import { createWorkspaceV2ReceiptStore } from './workspace-v2-receipt-storage';
import {
  WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
  type WorkspaceV2ReceiptHandle,
} from './workspace-v2-receipts';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const digest = `sha256:${'c'.repeat(64)}`;
const digestProvider = async () => digest;
const familyDigest = `sha256:${'f'.repeat(64)}`;
const familyDigestProvider = async () => familyDigest;
const handle: WorkspaceV2ReceiptHandle = {
  schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
  authorization_digest: digest,
  project: 'project-mobile',
  idempotency_key: 'workspace-create-1',
  preview_id: 'preview-workspace-1',
  preview_revision: '1',
  preview_digest: `sha256:${'a'.repeat(64)}`,
  request_digest: `sha256:${'b'.repeat(64)}`,
  approval_id: null,
  expected_resulting_revision: '1',
  created_at_ms: '1777000000000',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('persists only a bounded lookup handle across store recreation', async () => {
  await createWorkspaceV2ReceiptStore(familyDigestProvider, digestProvider).put(
    handle,
  );
  const encoded = JSON.stringify(
    await createWorkspaceV2ReceiptStore(
      familyDigestProvider,
      digestProvider,
    ).list(),
  );
  expect(JSON.parse(encoded)).toEqual([handle]);
  expect(encoded).not.toContain('resolved_parents');
  expect(encoded).not.toContain('effective_authority');
  expect(encoded).not.toContain('intent');
  expect(encoded).not.toContain('get_mutation_receipt');
  const keys = await AsyncStorage.getAllKeys();
  expect(keys).toEqual([
    `automonique.mobile.workspace-v2-receipts.v3.${familyDigest}`,
  ]);
});

test('refuses collisions, foreign authorization scope, and malformed storage', async () => {
  const store = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    digestProvider,
  );
  await store.put(handle);
  await expect(
    store.put({ ...handle, project: 'project-other' }),
  ).rejects.toThrow('workspace_v2_receipt_handle_collision');
  await expect(
    store.put({
      ...handle,
      authorization_digest: `sha256:${'d'.repeat(64)}`,
    }),
  ).rejects.toThrow('workspace_v2_receipt_handle_scope_mismatch');

  const key = (await AsyncStorage.getAllKeys())[0]!;
  await AsyncStorage.setItem(
    key,
    JSON.stringify([{ ...handle, future: true }]),
  );
  await expect(store.list()).rejects.toThrow(
    'workspace_v2_receipt_store_invalid',
  );
  await AsyncStorage.setItem(key, 'x'.repeat(16 * 1024 + 1));
  await expect(store.list()).rejects.toThrow(
    'workspace_v2_receipt_store_too_large',
  );
});

test('keeps the bounded store intact when capacity is exhausted', async () => {
  const store = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    digestProvider,
  );
  for (let index = 0; index < 20; index += 1) {
    await store.put({
      ...handle,
      idempotency_key: `workspace-create-${index}`,
      preview_id: `preview-workspace-${index}`,
    });
  }
  await expect(
    store.put({
      ...handle,
      idempotency_key: 'workspace-create-overflow',
      preview_id: 'preview-workspace-overflow',
    }),
  ).rejects.toThrow('workspace_v2_receipt_store_full');
  await expect(store.list()).resolves.toHaveLength(20);
});

test('serializes concurrent mutations across store instances for one durable key', async () => {
  const first = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    digestProvider,
  );
  const second = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    digestProvider,
  );
  const other = {
    ...handle,
    idempotency_key: 'workspace-create-2',
    preview_id: 'preview-workspace-2',
  };

  await Promise.all([first.put(handle), second.put(other)]);
  await expect(first.list()).resolves.toEqual([handle, other]);

  await Promise.all([
    first.remove(handle.idempotency_key),
    second.put({
      ...handle,
      idempotency_key: 'workspace-create-3',
      preview_id: 'preview-workspace-3',
    }),
  ]);
  await expect(second.list()).resolves.toEqual([
    other,
    {
      ...handle,
      idempotency_key: 'workspace-create-3',
      preview_id: 'preview-workspace-3',
    },
  ]);
});

test('migrates the legacy digest key and preserves handles across rotation', async () => {
  const legacyKey = `automonique.mobile.workspace-v2-receipts.v2.${digest}`;
  await AsyncStorage.setItem(legacyKey, JSON.stringify([handle]));
  const current = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    digestProvider,
  );
  await expect(current.list()).resolves.toEqual([handle]);
  await expect(AsyncStorage.getItem(legacyKey)).resolves.toBeNull();

  const rotatedDigest = `sha256:${'d'.repeat(64)}`;
  const rotated = createWorkspaceV2ReceiptStore(
    familyDigestProvider,
    async () => rotatedDigest,
  );
  await expect(rotated.list()).resolves.toEqual([handle]);
  const rotatedHandle = {
    ...handle,
    authorization_digest: rotatedDigest,
    idempotency_key: 'workspace-create-rotated',
    preview_id: 'preview-workspace-rotated',
  };
  await rotated.put(rotatedHandle);
  await expect(rotated.list()).resolves.toEqual([handle, rotatedHandle]);
});
