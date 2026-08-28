// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReviewActionReceipt } from '@automonique/sdk';

import {
  REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
  admitReviewReceiptForHandle,
  createReviewV2ReceiptStore,
  type ReviewV2ReceiptHandle,
} from './review-v2-receipts';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const values = new Map<string, string>();
const authorizationDigest = `sha256:${'a'.repeat(64)}`;
const familyDigest = `sha256:${'b'.repeat(64)}`;

function handle(
  overrides: Partial<ReviewV2ReceiptHandle> = {},
): ReviewV2ReceiptHandle {
  return {
    schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_digest: authorizationDigest,
    project: 'project-mobile',
    workspace_kind: 'user_workspace',
    workspace_id: 'workspace-mobile',
    expected_revision: '7',
    authority_kind: 'review',
    authority_id: 'review-local',
    actor_id: 'operator-mobile',
    action_kind: 'approve_review',
    action_digest: `sha256:${'c'.repeat(64)}`,
    idempotency_key: 'review-action-1',
    created_at_ms: '1000',
    ...overrides,
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
});

test('durably stores only exact delegation-scoped reconciliation handles', async () => {
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  await expect(store.put(handle())).resolves.toBe(true);
  await expect(store.put(handle())).resolves.toBe(false);
  await expect(store.list()).resolves.toEqual([handle()]);

  const encoded = [...values.values()][0]!;
  expect(encoded).not.toContain('comment body');
  expect(encoded).not.toContain('bearer');
  await expect(
    store.put(handle({ action_digest: `sha256:${'d'.repeat(64)}` })),
  ).rejects.toThrow('review_receipt_handle_collision');
});

test('rejects handles from another authorization generation', async () => {
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  await expect(
    store.put(handle({ authorization_digest: `sha256:${'e'.repeat(64)}` })),
  ).rejects.toThrow('review_receipt_handle_scope_mismatch');
});

test('receipts reconcile the exact idempotency key, actor, and forward revision', () => {
  const receipt: ReviewActionReceipt = {
    schema: 'automonique.platform/review/v1',
    platform_version: 2n,
    receipt_id: 'receipt-1',
    action_id: 'action-1',
    actor: 'operator-mobile',
    idempotency_key: 'review-action-1',
    outcome: 'completed',
    reconciliation: 'final',
    revision: 8n,
    current_revision: null,
  };
  expect(admitReviewReceiptForHandle(receipt, handle())).toBe(receipt);
  expect(() =>
    admitReviewReceiptForHandle(
      { ...receipt, actor: 'another-operator' },
      handle(),
    ),
  ).toThrow('review_receipt_mismatch');
  expect(() =>
    admitReviewReceiptForHandle({ ...receipt, revision: 7n }, handle()),
  ).toThrow('review_receipt_mismatch');
});
