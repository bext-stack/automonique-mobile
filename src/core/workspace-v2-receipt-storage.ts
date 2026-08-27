// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IdempotencyKey } from '@automonique/sdk';

import {
  admitWorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptStore,
} from './workspace-v2-receipts';

const LEGACY_RECEIPT_STORAGE_PREFIX =
  'automonique.mobile.workspace-v2-receipts.v2';
const RECEIPT_STORAGE_PREFIX = 'automonique.mobile.workspace-v2-receipts.v4';
const RECEIPT_INDEX_SCHEMA = 'automonique.mobile-workspace-v2-receipt-index/v4';
const MAX_RECEIPT_HANDLES = 20;
const MAX_RECEIPT_STORAGE_BYTES = 16 * 1024;
const storageTails = new Map<string, Promise<void>>();

interface ReceiptIndex {
  readonly schema: typeof RECEIPT_INDEX_SCHEMA;
  readonly authorization_digests: readonly string[];
  readonly handles: readonly WorkspaceV2ReceiptHandle[];
}

function admitDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error('workspace_v2_receipt_store_scope_invalid');
  }
  return value;
}

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

function parseEncoded(value: string): unknown {
  if (new TextEncoder().encode(value).byteLength > MAX_RECEIPT_STORAGE_BYTES) {
    throw new Error('workspace_v2_receipt_store_too_large');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
}

function admitHandles(value: unknown): readonly WorkspaceV2ReceiptHandle[] {
  if (!Array.isArray(value) || value.length > MAX_RECEIPT_HANDLES) {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
  try {
    const handles = value.map(admitWorkspaceV2ReceiptHandle);
    if (
      new Set(handles.map((handle) => handle.idempotency_key)).size !==
      handles.length
    ) {
      throw new Error('workspace_v2_receipt_store_invalid');
    }
    return handles;
  } catch {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
}

function admitIndex(value: unknown): ReceiptIndex {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 3 ||
    !['schema', 'authorization_digests', 'handles'].every((key) =>
      Object.hasOwn(candidate, key),
    ) ||
    candidate.schema !== RECEIPT_INDEX_SCHEMA ||
    !Array.isArray(candidate.authorization_digests) ||
    candidate.authorization_digests.length > MAX_RECEIPT_HANDLES
  ) {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
  const authorizationDigests = candidate.authorization_digests.map(admitDigest);
  const handles = admitHandles(candidate.handles);
  const usedDigests = [
    ...new Set(handles.map((handle) => handle.authorization_digest)),
  ].sort();
  if (
    new Set(authorizationDigests).size !== authorizationDigests.length ||
    authorizationDigests.some(
      (digest, index) =>
        index > 0 && authorizationDigests[index - 1]! >= digest,
    ) ||
    authorizationDigests.length !== usedDigests.length ||
    authorizationDigests.some((digest, index) => digest !== usedDigests[index])
  ) {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
  return {
    schema: RECEIPT_INDEX_SCHEMA,
    authorization_digests: authorizationDigests,
    handles,
  };
}

function indexFor(handles: readonly WorkspaceV2ReceiptHandle[]): ReceiptIndex {
  return {
    schema: RECEIPT_INDEX_SCHEMA,
    authorization_digests: [
      ...new Set(handles.map((handle) => handle.authorization_digest)),
    ].sort(),
    handles,
  };
}

async function writeIndex(key: string, index: ReceiptIndex): Promise<void> {
  if (index.handles.length > MAX_RECEIPT_HANDLES) {
    throw new Error('workspace_v2_receipt_store_full');
  }
  const encoded = JSON.stringify(index);
  if (
    new TextEncoder().encode(encoded).byteLength > MAX_RECEIPT_STORAGE_BYTES
  ) {
    throw new Error('workspace_v2_receipt_store_too_large');
  }
  await AsyncStorage.setItem(key, encoded);
}

async function loadIndex(key: string): Promise<ReceiptIndex> {
  const encoded = await AsyncStorage.getItem(key);
  return encoded === null ? indexFor([]) : admitIndex(parseEncoded(encoded));
}

async function migrateLegacyIndex(
  key: string,
  legacyAuthorizationDigest: string,
  index: ReceiptIndex,
): Promise<ReceiptIndex> {
  const legacyKey = `${LEGACY_RECEIPT_STORAGE_PREFIX}.${legacyAuthorizationDigest}`;
  const legacyEncoded = await AsyncStorage.getItem(legacyKey);
  if (legacyEncoded === null) return index;
  const legacy = admitHandles(parseEncoded(legacyEncoded));
  if (
    legacy.some(
      (handle) => handle.authorization_digest !== legacyAuthorizationDigest,
    )
  ) {
    throw new Error('workspace_v2_receipt_store_invalid');
  }
  const merged = [...index.handles];
  for (const handle of legacy) {
    const existing = merged.find(
      (candidate) => candidate.idempotency_key === handle.idempotency_key,
    );
    if (existing === undefined) merged.push(handle);
    else if (JSON.stringify(existing) !== JSON.stringify(handle)) {
      throw new Error('workspace_v2_receipt_handle_collision');
    }
  }
  const migrated = indexFor(merged);
  // Commit the stable-family copy before removing the only legacy copy. Both
  // writes are idempotent, so a crash between them is safely replayable.
  await writeIndex(key, migrated);
  await AsyncStorage.removeItem(legacyKey);
  return migrated;
}

/**
 * Move one exactly identified legacy authorization generation into its stable
 * delegation-family namespace. Callers must derive both digests from the same
 * admitted secure grant; this deliberately never scans unrelated app keys.
 */
export async function migrateLegacyWorkspaceV2Receipts(
  delegationFamilyDigest: () => Promise<string>,
  legacyAuthorizationDigest: () => Promise<string>,
): Promise<void> {
  const [family, legacyDigest] = await Promise.all([
    delegationFamilyDigest().then(admitDigest),
    legacyAuthorizationDigest().then(admitDigest),
  ]);
  const key = `${RECEIPT_STORAGE_PREFIX}.${family}`;
  await withStorageLock(key, async () => {
    await migrateLegacyIndex(key, legacyDigest, await loadIndex(key));
  });
}

export function createWorkspaceV2ReceiptStore(
  delegationFamilyDigest: () => Promise<string>,
  authorizationDigest: () => Promise<string>,
): WorkspaceV2ReceiptStore {
  let admittedFamily: Promise<string> | null = null;
  let admittedAuthorization: Promise<string> | null = null;
  const familyDigest = (): Promise<string> => {
    admittedFamily ??= delegationFamilyDigest().then(admitDigest);
    return admittedFamily;
  };
  const currentAuthorizationDigest = (): Promise<string> => {
    admittedAuthorization ??= authorizationDigest().then(admitDigest);
    return admittedAuthorization;
  };

  async function load(
    key: string,
    currentDigest: string,
  ): Promise<ReceiptIndex> {
    return migrateLegacyIndex(key, currentDigest, await loadIndex(key));
  }

  async function coordinates(): Promise<{
    readonly key: string;
    readonly currentDigest: string;
  }> {
    const [family, currentDigest] = await Promise.all([
      familyDigest(),
      currentAuthorizationDigest(),
    ]);
    return {
      key: `${RECEIPT_STORAGE_PREFIX}.${family}`,
      currentDigest,
    };
  }

  return {
    async list() {
      const { key, currentDigest } = await coordinates();
      return withStorageLock(
        key,
        async () => (await load(key, currentDigest)).handles,
      );
    },
    async put(value) {
      const handle = admitWorkspaceV2ReceiptHandle(value);
      const { key, currentDigest } = await coordinates();
      if (handle.authorization_digest !== currentDigest) {
        throw new Error('workspace_v2_receipt_handle_scope_mismatch');
      }
      return withStorageLock(key, async () => {
        const index = await load(key, currentDigest);
        const existing = index.handles.find(
          (candidate) => candidate.idempotency_key === handle.idempotency_key,
        );
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(handle)) {
            throw new Error('workspace_v2_receipt_handle_collision');
          }
          return false;
        }
        await writeIndex(key, indexFor([...index.handles, handle]));
        return true;
      });
    },
    async remove(idempotencyKey) {
      IdempotencyKey(idempotencyKey);
      const { key, currentDigest } = await coordinates();
      await withStorageLock(key, async () => {
        const index = await load(key, currentDigest);
        await writeIndex(
          key,
          indexFor(
            index.handles.filter(
              (handle) => handle.idempotency_key !== idempotencyKey,
            ),
          ),
        );
      });
    },
  };
}
