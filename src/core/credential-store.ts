// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  MOBILE_AUTH_SCHEMA_V1,
  MobileAccessToken,
  MobileActor,
  MobileCredentialId,
  MobileEpochMillis,
  MobileFollowUpBytes,
  MobileHttpsOrigin,
  MobilePageEvents,
  MobilePlatformEndpoint,
  MobileRefreshToken,
  MobileRevision,
  MobileServerIdentity,
  MobileSessionId,
  decodeMobileAction,
  type IssuedMobileCredentials,
  type MobileAction,
  type MobileAuthorization,
  type MobileDiscovery,
} from '@automonique/sdk';

const PROFILE_KEY = 'automonique.mobile.connection-profile.v3';
const CREDENTIAL_KEY = 'automonique.mobile.scoped-credential.v3';
const PROFILE_SCHEMA = 'automonique.mobile.connection-profile/v3';
const CREDENTIAL_SCHEMA = 'automonique.mobile.scoped-credential/v3';

export interface ConnectionProfile {
  readonly origin: string;
  readonly platformEndpoint: string;
  readonly serverIdentity: string;
  readonly credentialId: string;
  readonly actor: string;
  readonly issuedAtMs: string;
  readonly accessExpiresAtMs: string;
  readonly authorizationRevision: string;
  readonly credentialRevision: string;
  readonly actions: readonly MobileAction[];
  readonly sessionScope: readonly string[];
  readonly maxPageEvents: number;
  readonly maxFollowUpBytes: number;
}

export interface ScopedConnection {
  readonly profile: ConnectionProfile;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly authorization: MobileAuthorization;
}

export type StoredConnection =
  | { readonly kind: 'active'; readonly connection: ScopedConnection }
  | {
      readonly kind: 'refresh_required';
      readonly connection: ScopedConnection;
    };

interface PersistedAuthorization {
  readonly schema: typeof MOBILE_AUTH_SCHEMA_V1;
  readonly actions: readonly string[];
  readonly actor: string;
  readonly authorization_revision: string;
  readonly credential_id: string;
  readonly credential_revision: string;
  readonly expires_at_ms: string;
  readonly issued_at_ms: string;
  readonly limits: {
    readonly max_follow_up_bytes: string;
    readonly max_page_events: string;
  };
  readonly server_identity: string;
  readonly session_scope: readonly string[];
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

function exactDecimal(value: unknown, allowZero: boolean): bigint {
  if (
    typeof value !== 'string' ||
    !(allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u).test(value)
  ) {
    throw new Error('persisted_connection_invalid');
  }
  return BigInt(value);
}

function persistAuthorization(
  authorization: MobileAuthorization,
): PersistedAuthorization {
  return {
    schema: MOBILE_AUTH_SCHEMA_V1,
    actions: authorization.actions,
    actor: authorization.actor,
    authorization_revision: authorization.authorization_revision.toString(),
    credential_id: authorization.credential_id,
    credential_revision: authorization.credential_revision.toString(),
    expires_at_ms: authorization.expires_at_ms.toString(),
    issued_at_ms: authorization.issued_at_ms.toString(),
    limits: {
      max_follow_up_bytes: authorization.limits.max_follow_up_bytes.toString(),
      max_page_events: authorization.limits.max_page_events.toString(),
    },
    server_identity: authorization.server_identity,
    session_scope: authorization.session_scope,
  };
}

function admitAuthorization(value: unknown): MobileAuthorization {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'actions',
      'actor',
      'authorization_revision',
      'credential_id',
      'credential_revision',
      'expires_at_ms',
      'issued_at_ms',
      'limits',
      'server_identity',
      'session_scope',
    ]) ||
    value.schema !== MOBILE_AUTH_SCHEMA_V1 ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.session_scope) ||
    !isRecord(value.limits) ||
    !hasExactKeys(value.limits, ['max_follow_up_bytes', 'max_page_events']) ||
    typeof value.actor !== 'string' ||
    typeof value.credential_id !== 'string' ||
    typeof value.server_identity !== 'string' ||
    value.actions.some((action) => typeof action !== 'string') ||
    value.session_scope.some((session) => typeof session !== 'string')
  ) {
    throw new Error('persisted_connection_invalid');
  }
  const actions = value.actions.map((action) =>
    decodeMobileAction(action as string),
  );
  const sessionScope = value.session_scope.map((session) =>
    MobileSessionId(session as string),
  );
  if (
    actions.length === 0 ||
    new Set(actions).size !== actions.length ||
    new Set(sessionScope).size !== sessionScope.length
  ) {
    throw new Error('persisted_connection_invalid');
  }
  const authorization: MobileAuthorization = {
    schema: MOBILE_AUTH_SCHEMA_V1,
    actions,
    actor: MobileActor(value.actor),
    authorization_revision: MobileRevision(
      exactDecimal(value.authorization_revision, false),
    ),
    credential_id: MobileCredentialId(value.credential_id),
    credential_revision: MobileRevision(
      exactDecimal(value.credential_revision, false),
    ),
    expires_at_ms: MobileEpochMillis(exactDecimal(value.expires_at_ms, true)),
    issued_at_ms: MobileEpochMillis(exactDecimal(value.issued_at_ms, true)),
    limits: {
      max_follow_up_bytes: MobileFollowUpBytes(
        exactDecimal(value.limits.max_follow_up_bytes, false),
      ),
      max_page_events: MobilePageEvents(
        exactDecimal(value.limits.max_page_events, false),
      ),
    },
    server_identity: MobileServerIdentity(value.server_identity),
    session_scope: sessionScope,
  };
  if (authorization.issued_at_ms >= authorization.expires_at_ms) {
    throw new Error('persisted_connection_invalid');
  }
  return authorization;
}

function profileFor(
  discovery: Pick<MobileDiscovery, 'origin' | 'platform_endpoint'>,
  authorization: MobileAuthorization,
): ConnectionProfile {
  return {
    origin: discovery.origin,
    platformEndpoint: discovery.platform_endpoint,
    serverIdentity: authorization.server_identity,
    credentialId: authorization.credential_id,
    actor: authorization.actor,
    issuedAtMs: authorization.issued_at_ms.toString(),
    accessExpiresAtMs: authorization.expires_at_ms.toString(),
    authorizationRevision: authorization.authorization_revision.toString(),
    credentialRevision: authorization.credential_revision.toString(),
    actions: authorization.actions,
    sessionScope: authorization.session_scope,
    maxPageEvents: Number(authorization.limits.max_page_events),
    maxFollowUpBytes: Number(authorization.limits.max_follow_up_bytes),
  };
}

function admitProfile(value: unknown): ConnectionProfile {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'origin',
      'platformEndpoint',
      'serverIdentity',
      'credentialId',
      'actor',
      'issuedAtMs',
      'accessExpiresAtMs',
      'authorizationRevision',
      'credentialRevision',
      'actions',
      'sessionScope',
      'maxPageEvents',
      'maxFollowUpBytes',
    ]) ||
    typeof value.origin !== 'string' ||
    typeof value.platformEndpoint !== 'string' ||
    typeof value.serverIdentity !== 'string' ||
    typeof value.credentialId !== 'string' ||
    typeof value.actor !== 'string' ||
    typeof value.issuedAtMs !== 'string' ||
    typeof value.accessExpiresAtMs !== 'string' ||
    typeof value.authorizationRevision !== 'string' ||
    typeof value.credentialRevision !== 'string' ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.sessionScope) ||
    !Number.isInteger(value.maxPageEvents) ||
    !Number.isInteger(value.maxFollowUpBytes)
  ) {
    throw new Error('persisted_connection_invalid');
  }
  const authorization = admitAuthorization({
    schema: MOBILE_AUTH_SCHEMA_V1,
    actions: value.actions,
    actor: value.actor,
    authorization_revision: value.authorizationRevision,
    credential_id: value.credentialId,
    credential_revision: value.credentialRevision,
    expires_at_ms: value.accessExpiresAtMs,
    issued_at_ms: value.issuedAtMs,
    limits: {
      max_follow_up_bytes: String(value.maxFollowUpBytes),
      max_page_events: String(value.maxPageEvents),
    },
    server_identity: value.serverIdentity,
    session_scope: value.sessionScope,
  });
  const origin = MobileHttpsOrigin(value.origin);
  const platformEndpoint = MobilePlatformEndpoint(value.platformEndpoint);
  if (platformEndpoint !== `${origin}/api/platform`) {
    throw new Error('persisted_connection_invalid');
  }
  return profileFor(
    { origin, platform_endpoint: platformEndpoint },
    authorization,
  );
}

function sameProfile(
  left: ConnectionProfile,
  right: ConnectionProfile,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  await removePersistedConnection().catch(() => undefined);
}

/** Commit a newly issued or rotated access/refresh pair as one local generation. */
export async function saveIssuedConnection(
  discovery: Pick<
    MobileDiscovery,
    'origin' | 'platform_endpoint' | 'server_identity'
  >,
  issued: IssuedMobileCredentials,
  now = Date.now(),
  previous?: ScopedConnection,
): Promise<ScopedConnection> {
  if (!(await secureStoreAvailable()))
    throw new Error('secure_store_unavailable');
  let authorization: MobileAuthorization;
  try {
    authorization = admitAuthorization(
      persistAuthorization(issued.authorization),
    );
  } catch (error) {
    throw new Error('issued_connection_mismatch', { cause: error });
  }
  if (
    discovery.server_identity !== authorization.server_identity ||
    authorization.issued_at_ms > BigInt(now) ||
    authorization.expires_at_ms <= BigInt(now) ||
    (previous !== undefined &&
      (discovery.origin !== previous.profile.origin ||
        discovery.platform_endpoint !== previous.profile.platformEndpoint ||
        discovery.server_identity !== previous.profile.serverIdentity ||
        authorization.credential_id !== previous.authorization.credential_id ||
        authorization.credential_revision <=
          previous.authorization.credential_revision ||
        authorization.authorization_revision <
          previous.authorization.authorization_revision ||
        (authorization.authorization_revision ===
          previous.authorization.authorization_revision &&
          JSON.stringify({
            actor: authorization.actor,
            actions: authorization.actions,
            sessionScope: authorization.session_scope,
            limits: {
              maxPageEvents: authorization.limits.max_page_events.toString(),
              maxFollowUpBytes:
                authorization.limits.max_follow_up_bytes.toString(),
            },
          }) !==
            JSON.stringify({
              actor: previous.authorization.actor,
              actions: previous.authorization.actions,
              sessionScope: previous.authorization.session_scope,
              limits: {
                maxPageEvents:
                  previous.authorization.limits.max_page_events.toString(),
                maxFollowUpBytes:
                  previous.authorization.limits.max_follow_up_bytes.toString(),
              },
            }))))
  ) {
    throw new Error('issued_connection_mismatch');
  }
  const accessToken = MobileAccessToken(issued.access_token);
  const refreshToken = MobileRefreshToken(issued.refresh_token);
  const profile = profileFor(discovery, authorization);
  const publicValue = { schema: PROFILE_SCHEMA, profile } as const;
  const privateValue = {
    schema: CREDENTIAL_SCHEMA,
    profile,
    accessToken,
    refreshToken,
    authorization: persistAuthorization(authorization),
  } as const;

  // The secure record is the generation commit. Removing the public mirror
  // first prevents an interrupted rotation from exposing a mismatched pair.
  await AsyncStorage.removeItem(PROFILE_KEY);
  try {
    await SecureStore.setItemAsync(
      CREDENTIAL_KEY,
      JSON.stringify(privateValue),
      {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
  } catch (error) {
    await removePersistedConnectionBestEffort();
    throw error;
  }
  // The secure generation is authoritative. A missing or stale non-secret
  // mirror is repaired on the next load and must never destroy a rotated token.
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(publicValue)).catch(
    () => undefined,
  );
  return { profile, accessToken, refreshToken, authorization };
}

/** Load an admitted pair without discarding an expired access token's refresh path. */
export async function loadStoredConnection(
  now = Date.now(),
): Promise<StoredConnection | null> {
  if (!(await secureStoreAvailable())) {
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => undefined);
    return null;
  }
  const [profileJson, credentialJson] = await Promise.all([
    AsyncStorage.getItem(PROFILE_KEY),
    SecureStore.getItemAsync(CREDENTIAL_KEY),
  ]);
  if (credentialJson === null) {
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => undefined);
    return null;
  }

  try {
    const privateValue: unknown = JSON.parse(credentialJson);
    if (
      !isRecord(privateValue) ||
      !hasExactKeys(privateValue, [
        'schema',
        'profile',
        'accessToken',
        'refreshToken',
        'authorization',
      ]) ||
      privateValue.schema !== CREDENTIAL_SCHEMA ||
      typeof privateValue.accessToken !== 'string' ||
      typeof privateValue.refreshToken !== 'string'
    ) {
      throw new Error('persisted_connection_invalid');
    }
    const privateProfile = admitProfile(privateValue.profile);
    const authorization = admitAuthorization(privateValue.authorization);
    const expectedProfile = profileFor(
      {
        origin: MobileHttpsOrigin(privateProfile.origin),
        platform_endpoint: MobilePlatformEndpoint(
          privateProfile.platformEndpoint,
        ),
      },
      authorization,
    );
    if (
      !sameProfile(privateProfile, expectedProfile) ||
      authorization.issued_at_ms > BigInt(now)
    ) {
      throw new Error('persisted_connection_mismatch');
    }
    let publicProfile: ConnectionProfile | null = null;
    if (profileJson !== null) {
      try {
        const publicValue: unknown = JSON.parse(profileJson);
        if (
          isRecord(publicValue) &&
          hasExactKeys(publicValue, ['schema', 'profile']) &&
          publicValue.schema === PROFILE_SCHEMA
        ) {
          publicProfile = admitProfile(publicValue.profile);
        }
      } catch {
        // The private generation below remains authoritative.
      }
    }
    if (publicProfile === null || !sameProfile(publicProfile, privateProfile)) {
      await AsyncStorage.setItem(
        PROFILE_KEY,
        JSON.stringify({ schema: PROFILE_SCHEMA, profile: privateProfile }),
      ).catch(() => undefined);
    }
    const connection: ScopedConnection = {
      profile: privateProfile,
      accessToken: MobileAccessToken(privateValue.accessToken),
      refreshToken: MobileRefreshToken(privateValue.refreshToken),
      authorization,
    };
    return authorization.expires_at_ms <= BigInt(now)
      ? { kind: 'refresh_required', connection }
      : { kind: 'active', connection };
  } catch {
    await removePersistedConnectionBestEffort();
    return null;
  }
}

export function revokeLocalCredential(): Promise<void> {
  return removePersistedConnection();
}
