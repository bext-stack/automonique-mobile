// SPDX-License-Identifier: Elastic-2.0

import {
  IdempotencyKey,
  MutationApprovalId,
  MutationPreviewDigest,
  MutationPreviewId,
  PLATFORM_SCHEMA_V2,
  ProjectId,
  ReceiptId,
  WorkContextRequestDigest,
  WorkContextRevision,
  parseCanonical,
  type JsonValue,
  type MutationReceipt,
} from '@automonique/sdk';

export const WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA =
  'automonique.mobile-workspace-v2-receipt-handle/v1' as const;

export interface WorkspaceV2ReceiptHandle {
  readonly schema: typeof WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA;
  readonly authorization_fingerprint: string;
  readonly project: string;
  readonly idempotency_key: string;
  readonly preview_id: string;
  readonly preview_revision: string;
  readonly preview_digest: string;
  readonly request_digest: string;
  readonly approval_id: string | null;
  readonly expected_resulting_revision: string;
  readonly created_at_ms: string;
}

export interface WorkspaceV2ReceiptStore {
  list(): Promise<readonly WorkspaceV2ReceiptHandle[]>;
  put(handle: WorkspaceV2ReceiptHandle): Promise<void>;
  remove(idempotencyKey: string): Promise<void>;
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workspace_v2_receipt_handle_invalid');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(candidate, field))
  ) {
    throw new Error('workspace_v2_receipt_handle_invalid');
  }
  return candidate;
}

function string(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('workspace_v2_receipt_handle_invalid');
  }
  return value;
}

function decimal(value: unknown): string {
  const admitted = string(value, 40);
  if (!/^(0|[1-9][0-9]*)$/.test(admitted)) {
    throw new Error('workspace_v2_receipt_handle_invalid');
  }
  return admitted;
}

export function admitWorkspaceV2ReceiptHandle(
  value: unknown,
): WorkspaceV2ReceiptHandle {
  const candidate = exactObject(value, [
    'schema',
    'authorization_fingerprint',
    'project',
    'idempotency_key',
    'preview_id',
    'preview_revision',
    'preview_digest',
    'request_digest',
    'approval_id',
    'expected_resulting_revision',
    'created_at_ms',
  ]);
  if (candidate.schema !== WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA) {
    throw new Error('workspace_v2_receipt_handle_invalid');
  }
  const approvalId =
    candidate.approval_id === null
      ? null
      : MutationApprovalId(string(candidate.approval_id));
  return {
    schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_fingerprint: string(
      candidate.authorization_fingerprint,
      12 * 1_024,
    ),
    project: ProjectId(string(candidate.project)),
    idempotency_key: IdempotencyKey(string(candidate.idempotency_key)),
    preview_id: MutationPreviewId(string(candidate.preview_id)),
    preview_revision: WorkContextRevision(
      BigInt(decimal(candidate.preview_revision)),
    ).toString(),
    preview_digest: MutationPreviewDigest(string(candidate.preview_digest)),
    request_digest: WorkContextRequestDigest(string(candidate.request_digest)),
    approval_id: approvalId,
    expected_resulting_revision: WorkContextRevision(
      BigInt(decimal(candidate.expected_resulting_revision)),
    ).toString(),
    created_at_ms: decimal(candidate.created_at_ms),
  };
}

function canonicalObject(
  value: JsonValue,
  fields: readonly string[],
): ReadonlyMap<string, JsonValue> {
  if (value.kind !== 'object') throw new Error('workspace_receipt_mismatch');
  const entries = new Map(value.entries);
  if (
    entries.size !== fields.length ||
    fields.some((field) => !entries.has(field))
  ) {
    throw new Error('workspace_receipt_mismatch');
  }
  return entries;
}

function canonicalString(value: JsonValue | undefined): string {
  if (value?.kind !== 'string') throw new Error('workspace_receipt_mismatch');
  return value.value;
}

function canonicalInteger(value: JsonValue | undefined): bigint {
  if (value?.kind !== 'integer') throw new Error('workspace_receipt_mismatch');
  return value.value;
}

function canonicalNullableString(value: JsonValue | undefined): string | null {
  if (value?.kind === 'null') return null;
  return canonicalString(value);
}

export function decodeWorkspaceV2Receipt(
  payload: Uint8Array,
  handle: WorkspaceV2ReceiptHandle,
): MutationReceipt {
  const admittedHandle = admitWorkspaceV2ReceiptHandle(handle);
  const object = canonicalObject(parseCanonical(payload), [
    'approval_id',
    'id',
    'idempotency_key',
    'outcome',
    'preview',
    'preview_digest',
    'recorded_at_ms',
    'request_digest',
    'resulting_revision',
    'schema',
  ]);
  const preview = canonicalObject(object.get('preview')!, ['id', 'revision']);
  const outcome = canonicalString(object.get('outcome'));
  if (!['accepted', 'completed', 'conflict', 'rejected'].includes(outcome)) {
    throw new Error('workspace_receipt_mismatch');
  }
  const resultingValue = object.get('resulting_revision');
  const resultingRevision =
    resultingValue?.kind === 'null'
      ? null
      : WorkContextRevision(canonicalInteger(resultingValue));
  const approvalIdValue = canonicalNullableString(object.get('approval_id'));
  const receipt: MutationReceipt = {
    approval_id:
      approvalIdValue === null ? null : MutationApprovalId(approvalIdValue),
    id: ReceiptId(canonicalString(object.get('id'))),
    idempotency_key: IdempotencyKey(
      canonicalString(object.get('idempotency_key')),
    ),
    outcome: outcome as MutationReceipt['outcome'],
    preview: {
      id: MutationPreviewId(canonicalString(preview.get('id'))),
      revision: WorkContextRevision(canonicalInteger(preview.get('revision'))),
    },
    preview_digest: MutationPreviewDigest(
      canonicalString(object.get('preview_digest')),
    ),
    recorded_at_ms: canonicalInteger(object.get('recorded_at_ms')),
    request_digest: WorkContextRequestDigest(
      canonicalString(object.get('request_digest')),
    ),
    resulting_revision: resultingRevision,
    schema: canonicalString(object.get('schema')) as typeof PLATFORM_SCHEMA_V2,
  };
  if (
    receipt.schema !== PLATFORM_SCHEMA_V2 ||
    receipt.idempotency_key !== admittedHandle.idempotency_key ||
    receipt.preview.id !== admittedHandle.preview_id ||
    receipt.preview.revision.toString() !== admittedHandle.preview_revision ||
    receipt.preview_digest !== admittedHandle.preview_digest ||
    receipt.request_digest !== admittedHandle.request_digest ||
    receipt.approval_id !== admittedHandle.approval_id ||
    receipt.recorded_at_ms < 0n ||
    (receipt.outcome === 'completed'
      ? receipt.resulting_revision?.toString() !==
        admittedHandle.expected_resulting_revision
      : receipt.resulting_revision !== null)
  ) {
    throw new Error('workspace_receipt_mismatch');
  }
  return receipt;
}

export function workspaceV2ReceiptSettled(receipt: MutationReceipt): boolean {
  return receipt.outcome !== 'accepted';
}
