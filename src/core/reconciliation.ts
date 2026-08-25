// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  IdempotencyKey,
  ResourceId,
  ResourceAuthority_VALUES,
  ResourceKind_VALUES,
} from '@automonique/sdk';

import type {
  MobileAutomoniqueGateway,
  Receipt,
  VersionedTarget,
} from './types';
import { decimalRevision } from './types';

const PENDING_KEY = 'automonique.mobile.pending-reconciliation.v2';
const MAX_PENDING_HANDLES = 20;
const MAX_PENDING_BYTES = 16 * 1024;

export interface PendingMutationHandle {
  readonly action: Receipt['action'];
  readonly idempotencyKey: string;
  readonly session: VersionedTarget;
  readonly target: VersionedTarget;
}

export interface PendingMutationStore {
  list(): Promise<readonly PendingMutationHandle[]>;
  put(handle: PendingMutationHandle): Promise<void>;
  remove(idempotencyKey: string): Promise<void>;
}

export interface RecoveredReceipt {
  readonly handle: PendingMutationHandle;
  readonly receipt: Receipt;
}

function admitHandles(value: unknown): readonly PendingMutationHandle[] {
  if (!Array.isArray(value) || value.length > MAX_PENDING_HANDLES) return [];
  return value.filter((entry): entry is PendingMutationHandle => {
    if (entry === null || typeof entry !== 'object') return false;
    const candidate = entry as Partial<PendingMutationHandle>;
    if (!(
      Object.keys(entry).length === 4 &&
      ['action', 'idempotencyKey', 'session', 'target'].every((key) =>
        Object.hasOwn(entry, key),
      ) &&
      ['follow_up', 'decide_approval', 'stop_run'].includes(
        String(candidate.action),
      ) &&
      typeof candidate.idempotencyKey === 'string' &&
      candidate.idempotencyKey.length > 0 &&
      candidate.idempotencyKey.length <= 256 &&
      candidate.session !== undefined &&
      candidate.target !== undefined
    )) {
      return false;
    }
    try {
      const validTarget = (
        value: Partial<VersionedTarget>,
        requiredKind?: VersionedTarget['coordinate']['kind'],
      ): boolean => {
        const coordinate = value.coordinate as
          Partial<VersionedTarget['coordinate']> | undefined;
        return (
          Object.keys(value).length === 2 &&
          ['coordinate', 'revision'].every((key) =>
            Object.hasOwn(value, key),
          ) &&
          typeof value.revision === 'string' &&
          decimalRevision(value.revision) === value.revision &&
          coordinate !== undefined &&
          Object.keys(coordinate).length === 3 &&
          ['authority', 'kind', 'id'].every((key) =>
            Object.hasOwn(coordinate, key),
          ) &&
          ResourceAuthority_VALUES.includes(
            coordinate.authority as (typeof ResourceAuthority_VALUES)[number],
          ) &&
          ResourceKind_VALUES.includes(
            coordinate.kind as (typeof ResourceKind_VALUES)[number],
          ) &&
          (requiredKind === undefined || coordinate.kind === requiredKind) &&
          typeof coordinate.id === 'string' &&
          ResourceId(coordinate.id) === coordinate.id
        );
      };
      const session = candidate.session as VersionedTarget;
      const target = candidate.target as VersionedTarget;
      const expectedTargetKind =
        candidate.action === 'follow_up'
          ? 'session'
          : candidate.action === 'stop_run'
            ? 'run'
            : 'approval';
      return (
        IdempotencyKey(candidate.idempotencyKey) === candidate.idempotencyKey &&
        validTarget(session, 'session') &&
        validTarget(target, expectedTargetKind) &&
        session.coordinate.authority === 'automonique' &&
        target.coordinate.authority === 'automonique' &&
        (candidate.action !== 'follow_up' ||
          (session.revision === target.revision &&
            session.coordinate.id === target.coordinate.id))
      );
    } catch {
      return false;
    }
  });
}

export function createPendingMutationStore(
  scope?: string,
): PendingMutationStore {
  const storageKey =
    scope === undefined ? PENDING_KEY : `${PENDING_KEY}.${scope}`;
  async function list(): Promise<readonly PendingMutationHandle[]> {
    const encoded = await AsyncStorage.getItem(storageKey);
    if (
      encoded === null ||
      new TextEncoder().encode(encoded).byteLength > MAX_PENDING_BYTES
    )
      return [];
    try {
      return admitHandles(JSON.parse(encoded));
    } catch {
      return [];
    }
  }

  async function write(
    handles: readonly PendingMutationHandle[],
  ): Promise<void> {
    const encoded = JSON.stringify(handles.slice(-MAX_PENDING_HANDLES));
    if (new TextEncoder().encode(encoded).byteLength > MAX_PENDING_BYTES) {
      throw new Error('pending_reconciliation_store_too_large');
    }
    await AsyncStorage.setItem(storageKey, encoded);
  }

  return {
    list,
    async put(handle) {
      if (admitHandles([handle]).length !== 1) {
        throw new Error('pending_reconciliation_handle_invalid');
      }
      const handles = (await list()).filter(
        (candidate) => candidate.idempotencyKey !== handle.idempotencyKey,
      );
      await write([...handles, handle]);
    },
    async remove(idempotencyKey) {
      await write(
        (await list()).filter(
          (candidate) => candidate.idempotencyKey !== idempotencyKey,
        ),
      );
    },
  };
}

function settled(receipt: Receipt): boolean {
  return !['accepted', 'unknown'].includes(receipt.outcome);
}

function admitReceiptForHandle(
  handle: PendingMutationHandle,
  receipt: Receipt,
): Receipt {
  const expected = handle.target.coordinate;
  if (
    receipt.idempotencyKey !== handle.idempotencyKey ||
    receipt.action !== handle.action ||
    receipt.target.authority !== expected.authority ||
    receipt.target.kind !== expected.kind ||
    receipt.target.id !== expected.id
  ) {
    throw new Error('receipt_reconciliation_mismatch');
  }
  return receipt;
}

function reconcile(
  gateway: MobileAutomoniqueGateway,
  handle: PendingMutationHandle,
  signal?: AbortSignal,
): Promise<Receipt> {
  return signal === undefined
    ? gateway.reconcile(handle)
    : gateway.reconcile(handle, signal);
}

export async function executeWithReconciliation(
  gateway: MobileAutomoniqueGateway,
  store: PendingMutationStore,
  handle: PendingMutationHandle,
  operation: () => Promise<Receipt>,
  signal?: AbortSignal,
): Promise<Receipt> {
  await store.put(handle);
  let receipt: Receipt;
  let reconciledAfterError = false;
  try {
    receipt = admitReceiptForHandle(handle, await operation());
  } catch (operationError) {
    try {
      receipt = admitReceiptForHandle(
        handle,
        await reconcile(gateway, handle, signal),
      );
      reconciledAfterError = true;
    } catch {
      throw operationError;
    }
  }

  if (
    !reconciledAfterError &&
    ['accepted', 'unknown'].includes(receipt.outcome)
  ) {
    try {
      receipt = admitReceiptForHandle(
        handle,
        await reconcile(gateway, handle, signal),
      );
    } catch {
      return receipt;
    }
  }
  if (settled(receipt)) await store.remove(handle.idempotencyKey);
  return receipt;
}

export async function recoverPendingReceipts(
  gateway: MobileAutomoniqueGateway,
  store: PendingMutationStore,
  signal?: AbortSignal,
): Promise<readonly RecoveredReceipt[]> {
  const recovered: RecoveredReceipt[] = [];
  for (const handle of await store.list()) {
    if (signal?.aborted) throw signal.reason;
    try {
      const receipt = admitReceiptForHandle(
        handle,
        await reconcile(gateway, handle, signal),
      );
      recovered.push({ handle, receipt });
      if (settled(receipt)) await store.remove(handle.idempotencyKey);
    } catch {
      if (signal?.aborted) throw signal.reason;
      // A handle is not a mutation outbox. Keep it for later reconciliation;
      // never replay the original command because it is deliberately absent.
    }
  }
  return recovered;
}
