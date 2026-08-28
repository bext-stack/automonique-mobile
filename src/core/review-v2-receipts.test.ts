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
    removeItem: jest.fn(),
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
    expected_workspace_revision: null,
    receipt_correlation_digest: null,
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
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    values.delete(key);
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

test('admits retained-agent delivery handles without persisting comment content', async () => {
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  const delivery = handle({
    action_kind: 'batch_send_comments_to_agent',
    action_digest: `sha256:${'d'.repeat(64)}`,
    idempotency_key: 'review-agent-delivery-1',
  });
  await expect(store.put(delivery)).resolves.toBe(true);
  await expect(store.list()).resolves.toEqual([delivery]);
  const encoded = [...values.values()][0]!;
  expect(encoded).toContain('batch_send_comments_to_agent');
  expect(encoded).not.toContain('comment-1');
  expect(encoded).not.toContain('comment body');
});

test('admits only complete correlated CI rerun custody without persisting the confirmation capability', async () => {
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  const rerun = handle({
    authority_kind: 'ci',
    authority_id: 'ci-github-actions',
    action_kind: 'rerun_check',
    action_digest: `sha256:${'e'.repeat(64)}`,
    idempotency_key: 'review-check-rerun-1',
    expected_workspace_revision: '9',
    receipt_correlation_digest: 'cd'.repeat(32),
  });
  await expect(store.put(rerun)).resolves.toBe(true);
  await expect(store.list()).resolves.toEqual([rerun]);
  const encoded = [...values.values()][0]!;
  expect(encoded).toContain('rerun_check');
  expect(encoded).toContain('ci-github-actions');
  expect(encoded).not.toContain('confirmation_digest');
  expect(encoded).toContain('receipt_correlation_digest');
  for (const partial of [
    { expected_workspace_revision: null },
    { receipt_correlation_digest: null },
    { expected_workspace_revision: '0' },
    { receipt_correlation_digest: 'CD'.repeat(32) },
  ]) {
    await expect(store.put({ ...rerun, ...partial })).rejects.toThrow(
      'review_receipt_handle_invalid',
    );
  }
  await expect(
    store.put({ ...rerun, authority_kind: 'review' }),
  ).rejects.toThrow('review_receipt_handle_invalid');
});

test('copy-before-remove migrates exact legacy local handles into the expanded schema', async () => {
  const legacyKey = `automonique.mobile.review-v2-receipts.v1.${familyDigest}`;
  const { expected_workspace_revision, receipt_correlation_digest, ...legacy } =
    handle();
  void expected_workspace_revision;
  void receipt_correlation_digest;
  values.set(
    legacyKey,
    JSON.stringify({
      schema: 'automonique.mobile-review-v2-receipt-index/v1',
      handles: [
        {
          ...legacy,
          schema: 'automonique.mobile-review-v2-receipt-handle/v1',
          action_kind: 'approve_review',
        },
      ],
    }),
  );
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  await expect(store.list()).resolves.toEqual([handle()]);
  expect(values.has(legacyKey)).toBe(false);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(legacyKey);
  expect(
    [...values.values()].some((encoded) =>
      encoded.includes('mobile-review-v2-receipt-index/v3'),
    ),
  ).toBe(true);
});

test('terminalizes uncorrelated v2 rerun handles while migrating safe generic receipts', async () => {
  const legacyKey = `automonique.mobile.review-v2-receipts.v2.${familyDigest}`;
  const { expected_workspace_revision, receipt_correlation_digest, ...base } =
    handle();
  void expected_workspace_revision;
  void receipt_correlation_digest;
  values.set(
    legacyKey,
    JSON.stringify({
      schema: 'automonique.mobile-review-v2-receipt-index/v2',
      handles: [
        { ...base, schema: 'automonique.mobile-review-v2-receipt-handle/v2' },
        {
          ...base,
          schema: 'automonique.mobile-review-v2-receipt-handle/v2',
          authority_kind: 'ci',
          authority_id: 'ci-github-actions',
          action_kind: 'rerun_check',
          idempotency_key: 'legacy-uncorrelated-rerun',
        },
      ],
    }),
  );
  const store = createReviewV2ReceiptStore(
    async () => familyDigest,
    async () => authorizationDigest,
  );
  await expect(store.list()).resolves.toEqual([handle()]);
  expect(values.has(legacyKey)).toBe(false);
  expect(JSON.stringify([...values.values()])).not.toContain(
    'legacy-uncorrelated-rerun',
  );
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

  const rerun = handle({
    authority_kind: 'ci',
    authority_id: 'ci-github-actions',
    action_kind: 'rerun_check',
    expected_workspace_revision: '9',
    receipt_correlation_digest: 'cd'.repeat(32),
  });
  expect(admitReviewReceiptForHandle(receipt, rerun)).toBe(receipt);
  expect(() =>
    admitReviewReceiptForHandle({ ...receipt, revision: 9n }, rerun),
  ).toThrow('review_receipt_mismatch');
});
