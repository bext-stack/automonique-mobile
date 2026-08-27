// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IdempotencyKey } from '@automonique/sdk';

import {
  admitWorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptStore,
} from './workspace-v2-receipts';

const RECEIPT_STORAGE_PREFIX = 'automonique.mobile.workspace-v2-receipts.v1';
const MAX_RECEIPT_HANDLES = 20;
const MAX_RECEIPT_STORAGE_BYTES = 256 * 1024;

export function createWorkspaceV2ReceiptStore(
  authorizationFingerprint: string,
  storageScope = authorizationFingerprint,
): WorkspaceV2ReceiptStore {
  if (
    storageScope.length === 0 ||
    new TextEncoder().encode(storageScope).byteLength > 512 ||
    /\p{Cc}/u.test(storageScope)
  ) {
    throw new Error('workspace_v2_receipt_store_scope_invalid');
  }
  const storageKey = `${RECEIPT_STORAGE_PREFIX}.${storageScope}`;

  async function list(): Promise<readonly WorkspaceV2ReceiptHandle[]> {
    const encoded = await AsyncStorage.getItem(storageKey);
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
        handles.some(
          (handle) =>
            handle.authorization_fingerprint !== authorizationFingerprint,
        )
      ) {
        throw new Error('workspace_v2_receipt_store_invalid');
      }
      return handles;
    } catch {
      throw new Error('workspace_v2_receipt_store_invalid');
    }
  }

  async function write(
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
    await AsyncStorage.setItem(storageKey, encoded);
  }

  return {
    list,
    async put(value) {
      const handle = admitWorkspaceV2ReceiptHandle(value);
      if (handle.authorization_fingerprint !== authorizationFingerprint) {
        throw new Error('workspace_v2_receipt_handle_scope_mismatch');
      }
      const handles = await list();
      const existing = handles.find(
        (candidate) => candidate.idempotency_key === handle.idempotency_key,
      );
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(handle)) {
          throw new Error('workspace_v2_receipt_handle_collision');
        }
        return;
      }
      await write([...handles, handle]);
    },
    async remove(idempotencyKey) {
      IdempotencyKey(idempotencyKey);
      await write(
        (await list()).filter(
          (handle) => handle.idempotency_key !== idempotencyKey,
        ),
      );
    },
  };
}
