// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  attentionNotificationKey,
  type DecodedAttentionNotification,
} from './review-notifications';

const STORE_KEY = 'automonique.mobile-attention-notifications.v1';
const MAX_RECORDS = 256;
const MAX_KEY_BYTES = 2_048;
const MAX_ENVELOPE_BYTES = 640 * 1024;
const encoder = new TextEncoder();
let storageTail: Promise<void> = Promise.resolve();

interface DeliveryRecord {
  readonly key: string;
  readonly serverIdentity: string;
  readonly authorizationRevision: string;
  readonly principalGeneration: string;
  readonly deliveredAtMs: string;
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageTail.then(operation, operation);
  storageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function decode(encoded: string | null): readonly DeliveryRecord[] {
  if (encoded === null) return [];
  if (encoder.encode(encoded).byteLength > MAX_ENVELOPE_BYTES) {
    throw new Error('attention_notification_store_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('attention_notification_store_invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('attention_notification_store_invalid');
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== 2 ||
    envelope.schema !== 'automonique.mobile-attention-notifications/v1' ||
    !Array.isArray(envelope.records) ||
    envelope.records.length > MAX_RECORDS
  ) {
    throw new Error('attention_notification_store_invalid');
  }
  const keys = new Set<string>();
  return envelope.records.map((entry): DeliveryRecord => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('attention_notification_store_invalid');
    }
    const value = entry as Record<string, unknown>;
    const fields = [
      'key',
      'serverIdentity',
      'authorizationRevision',
      'principalGeneration',
      'deliveredAtMs',
    ];
    if (
      Object.keys(value).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(value, field)) ||
      typeof value.key !== 'string' ||
      encoder.encode(value.key).byteLength > MAX_KEY_BYTES ||
      typeof value.serverIdentity !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.serverIdentity) ||
      typeof value.authorizationRevision !== 'string' ||
      !/^[1-9][0-9]{0,19}$/u.test(value.authorizationRevision) ||
      typeof value.principalGeneration !== 'string' ||
      !/^[1-9][0-9]{0,19}$/u.test(value.principalGeneration) ||
      typeof value.deliveredAtMs !== 'string' ||
      !/^[1-9][0-9]{0,18}$/u.test(value.deliveredAtMs) ||
      keys.has(value.key)
    ) {
      throw new Error('attention_notification_store_invalid');
    }
    keys.add(value.key);
    return {
      key: value.key,
      serverIdentity: value.serverIdentity,
      authorizationRevision: value.authorizationRevision,
      principalGeneration: value.principalGeneration,
      deliveredAtMs: value.deliveredAtMs,
    };
  });
}

function encode(records: readonly DeliveryRecord[]): string {
  const encoded = JSON.stringify({
    schema: 'automonique.mobile-attention-notifications/v1',
    records: records.slice(0, MAX_RECORDS),
  });
  if (encoder.encode(encoded).byteLength > MAX_ENVELOPE_BYTES) {
    throw new Error('attention_notification_store_invalid');
  }
  decode(encoded);
  return encoded;
}

async function read(): Promise<readonly DeliveryRecord[]> {
  try {
    return decode(await AsyncStorage.getItem(STORE_KEY));
  } catch {
    await AsyncStorage.removeItem(STORE_KEY);
    return [];
  }
}

export function loadAttentionNotificationKeys(): Promise<readonly string[]> {
  return serialized(async () => (await read()).map((record) => record.key));
}

export function recordAttentionNotification(
  decoded: DecodedAttentionNotification,
  now = Date.now(),
): Promise<void> {
  return serialized(async () => {
    const key = attentionNotificationKey(decoded);
    const current = await read();
    if (current.some((record) => record.key === key)) return;
    const request = decoded.request;
    const records = [
      {
        key,
        serverIdentity: request.serverIdentity,
        authorizationRevision: request.authorizationRevision,
        principalGeneration: request.principalGeneration,
        deliveredAtMs: BigInt(now).toString(),
      },
      ...current,
    ].slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(STORE_KEY, encode(records));
  });
}

export function revokeAttentionNotificationRecords(
  serverIdentity: string,
): Promise<void> {
  return serialized(async () => {
    const retained = (await read()).filter(
      (record) => record.serverIdentity !== serverIdentity,
    );
    await AsyncStorage.setItem(STORE_KEY, encode(retained));
  });
}
