// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { normalizeEndpoint } from './network-policy';

const PROFILE_KEY = 'automonique.mobile.connection-profile.v1';
const CREDENTIAL_KEY = 'automonique.mobile.scoped-credential.v1';
const PROFILE_SCHEMA = 'automonique.mobile.connection-profile/v2';
const CREDENTIAL_SCHEMA = 'automonique.mobile.scoped-credential/v2';
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_IDENTITY_BYTES = 256;
const MAX_CREDENTIAL_LENGTH = 4096;

export interface ConnectionProfile {
  readonly endpoint: string;
  readonly actor: string;
  readonly credentialExpiresAt: string;
  readonly serverIdentity: string;
}

export interface ScopedConnection {
  readonly profile: ConnectionProfile;
  readonly credential: string;
}

interface PersistedProfile {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly profile: ConnectionProfile;
}

interface PersistedCredential {
  readonly schema: typeof CREDENTIAL_SCHEMA;
  readonly profile: ConnectionProfile;
  readonly credential: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedIdentity(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !isWellFormedUnicode(value) ||
    !/^[^\p{Cc}]+$/u.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_IDENTITY_BYTES
  ) {
    throw new Error('connection_profile_invalid');
  }
  return value;
}

function canonicalExpiry(value: unknown, now: number): string {
  if (
    !Number.isFinite(now) ||
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    throw new Error('credential_expiry_invalid');
  }
  const expiresAt = Date.parse(value);
  const canonical = Number.isFinite(expiresAt)
    ? new Date(expiresAt).toISOString()
    : null;
  const inputWithMillis = value.includes('.')
    ? value
    : value.replace(/Z$/u, '.000Z');
  if (canonical !== inputWithMillis || expiresAt <= now) {
    throw new Error('credential_expired');
  }
  return canonical;
}

function admitProfile(value: unknown, now: number): ConnectionProfile {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'endpoint',
      'actor',
      'credentialExpiresAt',
      'serverIdentity',
    ]) ||
    typeof value.endpoint !== 'string' ||
    value.endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error('connection_profile_invalid');
  }
  return {
    endpoint: normalizeEndpoint(value.endpoint, false),
    actor: boundedIdentity(value.actor),
    credentialExpiresAt: canonicalExpiry(value.credentialExpiresAt, now),
    serverIdentity: boundedIdentity(value.serverIdentity),
  };
}

function admitCredential(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_LENGTH ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    throw new Error('credential_invalid');
  }
  return value;
}

function sameProfile(
  left: ConnectionProfile,
  right: ConnectionProfile,
): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.actor === right.actor &&
    left.credentialExpiresAt === right.credentialExpiresAt &&
    left.serverIdentity === right.serverIdentity
  );
}

async function secureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function removePersistedConnection(): Promise<void> {
  const results = await Promise.allSettled([
    AsyncStorage.removeItem(PROFILE_KEY),
    SecureStore.deleteItemAsync(CREDENTIAL_KEY),
  ]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length === 1) throw failures[0]!.reason;
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      'credential_revoke_failed',
    );
  }
}

async function removePersistedConnectionBestEffort(): Promise<void> {
  try {
    await removePersistedConnection();
  } catch {
    // Admission has failed, so cleanup errors cannot make this pair usable.
  }
}

export async function saveConnectionProfile(
  profile: ConnectionProfile,
  credential: string,
  now = Date.now(),
): Promise<void> {
  const normalized = admitProfile(profile, now);
  const admittedCredential = admitCredential(credential);
  if (!(await secureStoreAvailable())) {
    throw new Error('secure_store_unavailable');
  }
  const persistedProfile: PersistedProfile = {
    schema: PROFILE_SCHEMA,
    profile: normalized,
  };
  const persistedCredential: PersistedCredential = {
    schema: CREDENTIAL_SCHEMA,
    profile: normalized,
    credential: admittedCredential,
  };

  // Remove the public half before rotating the token. An interruption leaves
  // no pair or two halves with different embedded profiles; both are refused.
  await AsyncStorage.removeItem(PROFILE_KEY);
  try {
    await SecureStore.setItemAsync(
      CREDENTIAL_KEY,
      JSON.stringify(persistedCredential),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  } catch (error) {
    await removePersistedConnectionBestEffort();
    throw error;
  }
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(persistedProfile));
  } catch (error) {
    await removePersistedConnectionBestEffort();
    throw error;
  }
}

/** Load the profile and bearer token as one admitted, non-expired pair. */
export async function loadScopedConnection(
  now = Date.now(),
): Promise<ScopedConnection | null> {
  if (!(await secureStoreAvailable())) {
    try {
      await AsyncStorage.removeItem(PROFILE_KEY);
    } catch {
      // The unavailable secure boundary still makes the connection unusable.
    }
    return null;
  }

  const [profileJson, credentialJson] = await Promise.all([
    AsyncStorage.getItem(PROFILE_KEY),
    SecureStore.getItemAsync(CREDENTIAL_KEY),
  ]);
  if (profileJson === null && credentialJson === null) return null;

  try {
    const persistedProfile: unknown =
      profileJson === null ? null : JSON.parse(profileJson);
    const persistedCredential: unknown =
      credentialJson === null ? null : JSON.parse(credentialJson);
    if (
      !isRecord(persistedProfile) ||
      !hasExactKeys(persistedProfile, ['schema', 'profile']) ||
      persistedProfile.schema !== PROFILE_SCHEMA ||
      !isRecord(persistedCredential) ||
      !hasExactKeys(persistedCredential, ['schema', 'profile', 'credential']) ||
      persistedCredential.schema !== CREDENTIAL_SCHEMA
    ) {
      throw new Error('persisted_connection_invalid');
    }
    const publicProfile = admitProfile(persistedProfile.profile, now);
    const privateProfile = admitProfile(persistedCredential.profile, now);
    const credential = admitCredential(persistedCredential.credential);
    if (!sameProfile(publicProfile, privateProfile)) {
      throw new Error('persisted_connection_mismatch');
    }
    return { profile: publicProfile, credential };
  } catch {
    await removePersistedConnectionBestEffort();
    return null;
  }
}

/** Prefer loadScopedConnection when both values will be used for networking. */
export async function loadConnectionProfile(
  now = Date.now(),
): Promise<ConnectionProfile | null> {
  return (await loadScopedConnection(now))?.profile ?? null;
}

/** Prefer loadScopedConnection when both values will be used for networking. */
export async function loadScopedCredential(
  now = Date.now(),
): Promise<string | null> {
  return (await loadScopedConnection(now))?.credential ?? null;
}

export function revokeLocalCredential(): Promise<void> {
  return removePersistedConnection();
}
