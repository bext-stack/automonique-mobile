// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  IdempotencyKey,
  ReviewReceiptCorrelationDigest,
  WorkContextRevision,
  type ReviewActionReceipt,
} from '@automonique/sdk';

import {
  isConfirmedReviewEffectKind,
  isPullRequestReviewEffectKind,
} from './mobile-review-effects';

export const REVIEW_V2_RECEIPT_HANDLE_SCHEMA =
  'automonique.mobile-review-v2-receipt-handle/v3' as const;
const LEGACY_REVIEW_V2_RECEIPT_HANDLE_SCHEMA =
  'automonique.mobile-review-v2-receipt-handle/v2' as const;
const LEGACY_REVIEW_V1_RECEIPT_HANDLE_SCHEMA =
  'automonique.mobile-review-v2-receipt-handle/v1' as const;
const REVIEW_RECEIPT_INDEX_SCHEMA =
  'automonique.mobile-review-v2-receipt-index/v3' as const;
const LEGACY_REVIEW_V2_RECEIPT_INDEX_SCHEMA =
  'automonique.mobile-review-v2-receipt-index/v2' as const;
const LEGACY_REVIEW_V1_RECEIPT_INDEX_SCHEMA =
  'automonique.mobile-review-v2-receipt-index/v1' as const;
const REVIEW_RECEIPT_STORAGE_PREFIX =
  'automonique.mobile.review-v2-receipts.v3';
const LEGACY_REVIEW_V2_RECEIPT_STORAGE_PREFIX =
  'automonique.mobile.review-v2-receipts.v2';
const LEGACY_REVIEW_V1_RECEIPT_STORAGE_PREFIX =
  'automonique.mobile.review-v2-receipts.v1';
export const MAX_REVIEW_RECEIPT_HANDLES = 32;
const MAX_REVIEW_RECEIPT_STORAGE_BYTES = 32 * 1024;
const storageTails = new Map<string, Promise<void>>();

export interface ReviewV2ReceiptHandle {
  readonly schema: typeof REVIEW_V2_RECEIPT_HANDLE_SCHEMA;
  readonly authorization_digest: string;
  readonly project: string;
  readonly workspace_kind: 'user_workspace' | 'attempt_workspace';
  readonly workspace_id: string;
  readonly expected_revision: string;
  readonly authority_kind: 'review' | 'ci' | 'pull_request';
  readonly authority_id: string;
  readonly actor_id: string;
  readonly action_kind:
    | 'add_comment'
    | 'approve_review'
    | 'send_comment_to_agent'
    | 'batch_send_comments_to_agent'
    | 'rerun_check'
    | 'open_pull_request'
    | 'update_pull_request'
    | 'merge_pull_request';
  readonly action_digest: string;
  readonly idempotency_key: string;
  readonly created_at_ms: string;
  /** Present only for a complete, correlated check-rerun recovery handle. */
  readonly expected_workspace_revision: string | null;
  /** Non-authorizing correlation proof; never a notification or deep-link field. */
  readonly receipt_correlation_digest: string | null;
}

type LegacyReviewV2ReceiptHandle = Omit<
  ReviewV2ReceiptHandle,
  'schema' | 'expected_workspace_revision' | 'receipt_correlation_digest'
> & {
  readonly schema: typeof LEGACY_REVIEW_V2_RECEIPT_HANDLE_SCHEMA;
};

type LegacyReviewV1ReceiptHandle = Omit<
  LegacyReviewV2ReceiptHandle,
  'schema' | 'action_kind'
> & {
  readonly schema: typeof LEGACY_REVIEW_V1_RECEIPT_HANDLE_SCHEMA;
  readonly action_kind: 'add_comment' | 'approve_review';
};

export interface ReviewV2ReceiptStore {
  list(): Promise<readonly ReviewV2ReceiptHandle[]>;
  put(handle: ReviewV2ReceiptHandle): Promise<boolean>;
  remove(idempotencyKey: string): Promise<void>;
}

interface ReviewReceiptIndex {
  readonly schema: typeof REVIEW_RECEIPT_INDEX_SCHEMA;
  readonly handles: readonly ReviewV2ReceiptHandle[];
}

function bounded(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('review_receipt_handle_invalid');
  }
  return value;
}

function decimal(value: unknown): string {
  const result = bounded(value, 40);
  if (!/^(0|[1-9][0-9]*)$/u.test(result)) {
    throw new Error('review_receipt_handle_invalid');
  }
  return result;
}

function workContextRevision(value: unknown): string {
  try {
    return WorkContextRevision(BigInt(decimal(value))).toString();
  } catch {
    throw new Error('review_receipt_handle_invalid');
  }
}

/**
 * The one authority a given action family may ever be recorded under. A
 * pull-request write is never filed under the review authority, so a handle
 * cannot be replayed into a lane whose grant the actor does not hold.
 */
export function receiptAuthorityKind(
  actionKind: ReviewV2ReceiptHandle['action_kind'],
): ReviewV2ReceiptHandle['authority_kind'] {
  if (actionKind === 'rerun_check') return 'ci';
  return isPullRequestReviewEffectKind(actionKind) ? 'pull_request' : 'review';
}

function admitReceiptCorrelationDigest(value: unknown): string {
  try {
    return ReviewReceiptCorrelationDigest(bounded(value, 64));
  } catch {
    throw new Error('review_receipt_handle_invalid');
  }
}

function admitReceiptHandle(
  value: unknown,
  schema:
    | typeof REVIEW_V2_RECEIPT_HANDLE_SCHEMA
    | typeof LEGACY_REVIEW_V2_RECEIPT_HANDLE_SCHEMA
    | typeof LEGACY_REVIEW_V1_RECEIPT_HANDLE_SCHEMA,
  actionKinds: readonly ReviewV2ReceiptHandle['action_kind'][],
  authorityKinds: readonly ReviewV2ReceiptHandle['authority_kind'][],
):
  | ReviewV2ReceiptHandle
  | LegacyReviewV2ReceiptHandle
  | LegacyReviewV1ReceiptHandle {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review_receipt_handle_invalid');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const fields = [
    'schema',
    'authorization_digest',
    'project',
    'workspace_kind',
    'workspace_id',
    'expected_revision',
    'authority_kind',
    'authority_id',
    'actor_id',
    'action_kind',
    'action_digest',
    'idempotency_key',
    'created_at_ms',
    ...(schema === REVIEW_V2_RECEIPT_HANDLE_SCHEMA
      ? ['expected_workspace_revision', 'receipt_correlation_digest']
      : []),
  ];
  if (
    Object.keys(candidate).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(candidate, field)) ||
    candidate.schema !== schema ||
    !['user_workspace', 'attempt_workspace'].includes(
      String(candidate.workspace_kind),
    ) ||
    !authorityKinds.includes(
      candidate.authority_kind as ReviewV2ReceiptHandle['authority_kind'],
    ) ||
    !actionKinds.includes(
      candidate.action_kind as ReviewV2ReceiptHandle['action_kind'],
    )
  ) {
    throw new Error('review_receipt_handle_invalid');
  }
  const authorizationDigest = bounded(candidate.authorization_digest, 71);
  const actionDigest = bounded(candidate.action_digest, 71);
  const actionKind =
    candidate.action_kind as ReviewV2ReceiptHandle['action_kind'];
  const authorityKind =
    candidate.authority_kind as ReviewV2ReceiptHandle['authority_kind'];
  if (
    !/^sha256:[0-9a-f]{64}$/u.test(authorizationDigest) ||
    !/^sha256:[0-9a-f]{64}$/u.test(actionDigest) ||
    authorityKind !== receiptAuthorityKind(actionKind)
  ) {
    throw new Error('review_receipt_handle_invalid');
  }
  const base = {
    schema,
    authorization_digest: authorizationDigest,
    project: bounded(candidate.project),
    workspace_kind:
      candidate.workspace_kind as ReviewV2ReceiptHandle['workspace_kind'],
    workspace_id: bounded(candidate.workspace_id),
    expected_revision: decimal(candidate.expected_revision),
    authority_kind: authorityKind,
    authority_id: bounded(candidate.authority_id),
    actor_id: bounded(candidate.actor_id),
    action_kind: actionKind,
    action_digest: actionDigest,
    idempotency_key: IdempotencyKey(bounded(candidate.idempotency_key)),
    created_at_ms: decimal(candidate.created_at_ms),
  };
  if (schema !== REVIEW_V2_RECEIPT_HANDLE_SCHEMA) {
    return base as LegacyReviewV2ReceiptHandle | LegacyReviewV1ReceiptHandle;
  }
  const confirmed = isConfirmedReviewEffectKind(actionKind);
  const expectedWorkspaceRevision =
    candidate.expected_workspace_revision === null
      ? null
      : workContextRevision(candidate.expected_workspace_revision);
  const receiptCorrelationDigest =
    candidate.receipt_correlation_digest === null
      ? null
      : admitReceiptCorrelationDigest(candidate.receipt_correlation_digest);
  if (
    (expectedWorkspaceRevision === null) !==
      (receiptCorrelationDigest === null) ||
    confirmed !== (receiptCorrelationDigest !== null)
  ) {
    throw new Error('review_receipt_handle_invalid');
  }
  return {
    ...base,
    expected_workspace_revision: expectedWorkspaceRevision,
    receipt_correlation_digest: receiptCorrelationDigest,
  } as ReviewV2ReceiptHandle;
}

export function admitReviewV2ReceiptHandle(
  value: unknown,
): ReviewV2ReceiptHandle {
  return admitReceiptHandle(
    value,
    REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
    [
      'add_comment',
      'approve_review',
      'send_comment_to_agent',
      'batch_send_comments_to_agent',
      'rerun_check',
      'open_pull_request',
      'update_pull_request',
      'merge_pull_request',
    ],
    ['review', 'ci', 'pull_request'],
  ) as ReviewV2ReceiptHandle;
}

function admitLegacyReviewV2ReceiptHandle(
  value: unknown,
): LegacyReviewV2ReceiptHandle {
  return admitReceiptHandle(
    value,
    LEGACY_REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
    [
      'add_comment',
      'approve_review',
      'send_comment_to_agent',
      'batch_send_comments_to_agent',
      'rerun_check',
    ],
    ['review', 'ci'],
  ) as LegacyReviewV2ReceiptHandle;
}

function admitLegacyReviewV1ReceiptHandle(
  value: unknown,
): LegacyReviewV1ReceiptHandle {
  return admitReceiptHandle(
    value,
    LEGACY_REVIEW_V1_RECEIPT_HANDLE_SCHEMA,
    ['add_comment', 'approve_review'],
    ['review'],
  ) as LegacyReviewV1ReceiptHandle;
}

export function reviewReceiptSettled(receipt: ReviewActionReceipt): boolean {
  return receipt.reconciliation === 'final';
}

export function admitReviewReceiptForHandle(
  receipt: ReviewActionReceipt,
  handle: ReviewV2ReceiptHandle,
): ReviewActionReceipt {
  const admitted = admitReviewV2ReceiptHandle(handle);
  if (
    receipt.idempotency_key !== admitted.idempotency_key ||
    receipt.actor !== admitted.actor_id ||
    (receipt.outcome === 'completed' &&
      (receipt.revision === null ||
        (admitted.action_kind === 'rerun_check'
          ? receipt.revision !== BigInt(admitted.expected_revision) + 1n
          : receipt.revision <= BigInt(admitted.expected_revision)))) ||
    (receipt.outcome === 'conflict' &&
      (receipt.current_revision === null ||
        receipt.current_revision < BigInt(admitted.expected_revision)))
  ) {
    throw new Error('review_receipt_mismatch');
  }
  return receipt;
}

function parseIndex(encoded: string): Readonly<Record<string, unknown>> {
  if (
    new TextEncoder().encode(encoded).byteLength >
    MAX_REVIEW_RECEIPT_STORAGE_BYTES
  ) {
    throw new Error('review_receipt_store_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('review_receipt_store_invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('review_receipt_store_invalid');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function admitIndex(encoded: string | null): ReviewReceiptIndex {
  if (encoded === null) {
    return { schema: REVIEW_RECEIPT_INDEX_SCHEMA, handles: [] };
  }
  const value = parseIndex(encoded);
  if (
    Object.keys(value).length !== 2 ||
    value.schema !== REVIEW_RECEIPT_INDEX_SCHEMA ||
    !Array.isArray(value.handles) ||
    value.handles.length > MAX_REVIEW_RECEIPT_HANDLES
  ) {
    throw new Error('review_receipt_store_invalid');
  }
  const handles = value.handles.map(admitReviewV2ReceiptHandle);
  if (
    new Set(handles.map((handle) => handle.idempotency_key)).size !==
    handles.length
  ) {
    throw new Error('review_receipt_store_invalid');
  }
  return { schema: REVIEW_RECEIPT_INDEX_SCHEMA, handles };
}

function migrateLegacyHandle(
  legacy: LegacyReviewV2ReceiptHandle | LegacyReviewV1ReceiptHandle,
): ReviewV2ReceiptHandle | null {
  // V2 rerun handles predate the server-issued correlation identity. They are
  // intentionally terminalized locally instead of falling back to the
  // generic lookup, which cannot prove which provider attempt belongs to us.
  if (legacy.action_kind === 'rerun_check') return null;
  return {
    ...legacy,
    schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
    expected_workspace_revision: null,
    receipt_correlation_digest: null,
  };
}

function admitLegacyIndex(
  encoded: string,
  indexSchema:
    | typeof LEGACY_REVIEW_V2_RECEIPT_INDEX_SCHEMA
    | typeof LEGACY_REVIEW_V1_RECEIPT_INDEX_SCHEMA,
): readonly ReviewV2ReceiptHandle[] {
  const value = parseIndex(encoded);
  if (
    Object.keys(value).length !== 2 ||
    value.schema !== indexSchema ||
    !Array.isArray(value.handles) ||
    value.handles.length > MAX_REVIEW_RECEIPT_HANDLES
  ) {
    throw new Error('review_receipt_store_invalid');
  }
  const handles = value.handles
    .map((candidate) =>
      migrateLegacyHandle(
        indexSchema === LEGACY_REVIEW_V2_RECEIPT_INDEX_SCHEMA
          ? admitLegacyReviewV2ReceiptHandle(candidate)
          : admitLegacyReviewV1ReceiptHandle(candidate),
      ),
    )
    .filter((handle): handle is ReviewV2ReceiptHandle => handle !== null);
  if (
    new Set(handles.map((handle) => handle.idempotency_key)).size !==
    handles.length
  ) {
    throw new Error('review_receipt_store_invalid');
  }
  return handles;
}

async function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => turn);
  storageTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (storageTails.get(key) === tail) storageTails.delete(key);
  }
}

function storageKey(familyDigest: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(familyDigest)) {
    throw new Error('review_receipt_store_scope_invalid');
  }
  return `${REVIEW_RECEIPT_STORAGE_PREFIX}.${familyDigest}`;
}

function legacyStorageKeys(familyDigest: string): readonly string[] {
  if (!/^sha256:[0-9a-f]{64}$/u.test(familyDigest)) {
    throw new Error('review_receipt_store_scope_invalid');
  }
  return [
    `${LEGACY_REVIEW_V2_RECEIPT_STORAGE_PREFIX}.${familyDigest}`,
    `${LEGACY_REVIEW_V1_RECEIPT_STORAGE_PREFIX}.${familyDigest}`,
  ];
}

async function write(
  key: string,
  handles: readonly ReviewV2ReceiptHandle[],
): Promise<void> {
  if (handles.length > MAX_REVIEW_RECEIPT_HANDLES) {
    throw new Error('review_receipt_store_full');
  }
  const encoded = JSON.stringify({
    schema: REVIEW_RECEIPT_INDEX_SCHEMA,
    handles,
  });
  if (
    new TextEncoder().encode(encoded).byteLength >
    MAX_REVIEW_RECEIPT_STORAGE_BYTES
  ) {
    throw new Error('review_receipt_store_full');
  }
  await AsyncStorage.setItem(key, encoded);
}

async function loadWithMigration(
  key: string,
  legacyKeys: readonly string[],
): Promise<ReviewReceiptIndex> {
  const current = admitIndex(await AsyncStorage.getItem(key));
  const merged = [...current.handles];
  const migratedKeys: string[] = [];
  for (const [index, legacyKey] of legacyKeys.entries()) {
    const legacyEncoded = await AsyncStorage.getItem(legacyKey);
    if (legacyEncoded === null) continue;
    migratedKeys.push(legacyKey);
    const indexSchema =
      index === 0
        ? LEGACY_REVIEW_V2_RECEIPT_INDEX_SCHEMA
        : LEGACY_REVIEW_V1_RECEIPT_INDEX_SCHEMA;
    for (const handle of admitLegacyIndex(legacyEncoded, indexSchema)) {
      const existing = merged.find(
        (candidate) => candidate.idempotency_key === handle.idempotency_key,
      );
      if (existing === undefined) merged.push(handle);
      else if (JSON.stringify(existing) !== JSON.stringify(handle)) {
        throw new Error('review_receipt_handle_collision');
      }
    }
  }
  if (migratedKeys.length === 0) return current;
  // Copy-before-remove makes an interrupted migration safe to retry.
  await write(key, merged);
  for (const legacyKey of migratedKeys) {
    await AsyncStorage.removeItem(legacyKey);
  }
  return { schema: REVIEW_RECEIPT_INDEX_SCHEMA, handles: merged };
}

export function createReviewV2ReceiptStore(
  delegationFamilyDigest: () => Promise<string>,
  authorizationDigest: () => Promise<string>,
): ReviewV2ReceiptStore {
  let familyPromise: Promise<string> | null = null;
  let authorizationPromise: Promise<string> | null = null;
  const coordinates = async () => {
    familyPromise ??= delegationFamilyDigest();
    authorizationPromise ??= authorizationDigest();
    const [family, authorization] = await Promise.all([
      familyPromise,
      authorizationPromise,
    ]);
    return {
      key: storageKey(family),
      legacyKeys: legacyStorageKeys(family),
      authorization,
    };
  };
  return {
    async list() {
      const { key, legacyKeys } = await coordinates();
      return locked(
        key,
        async () => (await loadWithMigration(key, legacyKeys)).handles,
      );
    },
    async put(value) {
      const handle = admitReviewV2ReceiptHandle(value);
      const { key, legacyKeys, authorization } = await coordinates();
      if (handle.authorization_digest !== authorization) {
        throw new Error('review_receipt_handle_scope_mismatch');
      }
      return locked(key, async () => {
        const current = await loadWithMigration(key, legacyKeys);
        const existing = current.handles.find(
          (candidate) => candidate.idempotency_key === handle.idempotency_key,
        );
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(handle)) {
            throw new Error('review_receipt_handle_collision');
          }
          return false;
        }
        await write(key, [...current.handles, handle]);
        return true;
      });
    },
    async remove(idempotencyKey) {
      IdempotencyKey(idempotencyKey);
      const { key, legacyKeys } = await coordinates();
      await locked(key, async () => {
        const current = await loadWithMigration(key, legacyKeys);
        await write(
          key,
          current.handles.filter(
            (handle) => handle.idempotency_key !== idempotencyKey,
          ),
        );
      });
    },
  };
}
