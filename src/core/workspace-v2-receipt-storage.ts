// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IdempotencyKey } from '@automonique/sdk';

import {
  admitWorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptStore,
} from './workspace-v2-receipts';

const RECEIPT_STORAGE_PREFIX = 'automonique.mobile.workspace-v2-receipts.v2';
const MAX_RECEIPT_HANDLES = 20;
const MAX_RECEIPT_STORAGE_BYTES = 16 * 1024;
const storageTails = new Map<string, Promise<void>>();

async function withStorageLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
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

export function createWorkspaceV2ReceiptStore(
  authorizationDigest: () => Promise<string>,
): WorkspaceV2ReceiptStore {
  let admittedDigest: Promise<string> | null = null;
  async function digest(): Promise<string> {
    admittedDigest ??= authorizationDigest().then((value) => {
      if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
        throw new Error('workspace_v2_receipt_store_scope_invalid');
      }
      return value;
    });
    return admittedDigest;
  }

  async function storageKey(): Promise<string> {
    return `${RECEIPT_STORAGE_PREFIX}.${await digest()}`;
  }

  async function read(
    key: string,
    expectedDigest: string,
  ): Promise<readonly WorkspaceV2ReceiptHandle[]> {
    const encoded = await AsyncStorage.getItem(key);
    if (encoded === null) return [];
    if (
      new TextEncoder().encode(encoded).byteLength > MAX_RECEIPT_STORAGE_BYTES
    ) {
      throw new Error('workspace_v2_receipt_store_too_large');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      throw new Error('workspace_v2_receipt_store_invalid');
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_RECEIPT_HANDLES) {
      throw new Error('workspace_v2_receipt_store_invalid');
    }
    try {
      const handles = parsed.map(admitWorkspaceV2ReceiptHandle);
      if (
        new Set(handles.map((handle) => handle.idempotency_key)).size !==
          handles.length ||
        handles.some((handle) => handle.authorization_digest !== expectedDigest)
      ) {
        throw new Error('workspace_v2_receipt_store_invalid');
      }
      return handles;
    } catch {
      throw new Error('workspace_v2_receipt_store_invalid');
    }
  }

  async function write(
    key: string,
    handles: readonly WorkspaceV2ReceiptHandle[],
  ): Promise<void> {
    if (handles.length > MAX_RECEIPT_HANDLES) {
      throw new Error('workspace_v2_receipt_store_full');
    }
    const encoded = JSON.stringify(handles);
    if (
      new TextEncoder().encode(encoded).byteLength > MAX_RECEIPT_STORAGE_BYTES
    ) {
      throw new Error('workspace_v2_receipt_store_too_large');
    }
    await AsyncStorage.setItem(key, encoded);
  }

  return {
    async list() {
      const expectedDigest = await digest();
      const key = await storageKey();
      return withStorageLock(key, () => read(key, expectedDigest));
    },
    async put(value) {
      const handle = admitWorkspaceV2ReceiptHandle(value);
      const expectedDigest = await digest();
      if (handle.authorization_digest !== expectedDigest) {
        throw new Error('workspace_v2_receipt_handle_scope_mismatch');
      }
      const key = await storageKey();
      return withStorageLock(key, async () => {
        const handles = await read(key, expectedDigest);
        const existing = handles.find(
          (candidate) => candidate.idempotency_key === handle.idempotency_key,
        );
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(handle)) {
            throw new Error('workspace_v2_receipt_handle_collision');
          }
          return false;
        }
        await write(key, [...handles, handle]);
        return true;
      });
    },
    async remove(idempotencyKey) {
      IdempotencyKey(idempotencyKey);
      const expectedDigest = await digest();
      const key = await storageKey();
      await withStorageLock(key, async () => {
        const handles = (await read(key, expectedDigest)).filter(
          (handle) => handle.idempotency_key !== idempotencyKey,
        );
        await write(key, handles);
      });
    },
  };
}
