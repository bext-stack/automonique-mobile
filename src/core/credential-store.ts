// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
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
import {
  admitDelegatedMobileV2Authorization,
  admitMobileV2ReceiptMigrationMetadata,
  deriveMobileV2ReceiptMigrationMetadata,
  type DelegatedMobileV2Authorization,
  type MobileV2ReceiptMigrationMetadata,
} from './mobile-v2-authorization';

const PROFILE_KEY = 'automonique.mobile.connection-profile.v3';
const CREDENTIAL_KEY = 'automonique.mobile.scoped-credential.v3';
const PROFILE_SCHEMA = 'automonique.mobile.connection-profile/v3';
const LEGACY_CREDENTIAL_SCHEMA = 'automonique.mobile.scoped-credential/v3';
const PREVIOUS_CREDENTIAL_SCHEMA = 'automonique.mobile.scoped-credential/v4';
const CREDENTIAL_SCHEMA = 'automonique.mobile.scoped-credential/v5';

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
  readonly workspaceAuthorization?: DelegatedMobileV2Authorization;
  readonly workspaceReceiptMigration?: MobileV2ReceiptMigrationMetadata;
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

interface PersistedWorkspaceAuthorization {
  readonly schema: string;
  readonly server_identity: string;
  readonly credential_id: string;
  readonly credential_revision: string;
  readonly authorization_revision: string;
  readonly principal_generation: string;
  readonly delegation_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly issued_at_ms: string;
  readonly expires_at_ms: string;
  readonly project_roots: readonly string[];
  readonly actions: readonly string[];
}

interface PersistedWorkspaceReceiptMigration {
  readonly schema: string;
  readonly server_identity: string;
  readonly credential_id: string;
  readonly delegation_id: string;
  readonly authorization_digest: string;
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

function persistWorkspaceAuthorization(
  authorization: DelegatedMobileV2Authorization,
): PersistedWorkspaceAuthorization {
  return {
    schema: authorization.schema,
    server_identity: authorization.server_identity,
    credential_id: authorization.credential_id,
    credential_revision: authorization.credential_revision.toString(),
    authorization_revision: authorization.authorization_revision.toString(),
    principal_generation: authorization.principal_generation.toString(),
    delegation_id: authorization.delegation_id,
    tenant_id: authorization.tenant_id,
    actor_id: authorization.actor_id,
    issued_at_ms: authorization.issued_at_ms.toString(),
    expires_at_ms: authorization.expires_at_ms.toString(),
    project_roots: authorization.project_roots,
    actions: authorization.actions,
  };
}

function persistWorkspaceReceiptMigration(
  metadata: MobileV2ReceiptMigrationMetadata,
): PersistedWorkspaceReceiptMigration {
  return { ...metadata };
}

function expectedWorkspaceAuthorization(
  authorization: MobileAuthorization,
  now: number,
) {
  return {
    serverIdentity: authorization.server_identity,
    credentialId: authorization.credential_id,
    credentialRevision: authorization.credential_revision,
    authorizationRevision: authorization.authorization_revision,
    expiresAtMs: authorization.expires_at_ms,
    now,
  };
}

function admitWorkspaceAuthorization(
  value: unknown,
  authorization: MobileAuthorization,
  now: number,
): DelegatedMobileV2Authorization {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'server_identity',
      'credential_id',
      'credential_revision',
      'authorization_revision',
      'principal_generation',
      'delegation_id',
      'tenant_id',
      'actor_id',
      'issued_at_ms',
      'expires_at_ms',
      'project_roots',
      'actions',
    ]) ||
    !Array.isArray(value.project_roots) ||
    !Array.isArray(value.actions)
  ) {
    throw new Error('persisted_connection_invalid');
  }
  return admitDelegatedMobileV2Authorization(
    {
      ...value,
      credential_revision: exactDecimal(value.credential_revision, false),
      authorization_revision: exactDecimal(value.authorization_revision, false),
      principal_generation: exactDecimal(value.principal_generation, false),
      issued_at_ms: exactDecimal(value.issued_at_ms, true),
      expires_at_ms: exactDecimal(value.expires_at_ms, true),
    },
    expectedWorkspaceAuthorization(authorization, now),
  );
}

async function deriveWorkspaceReceiptMigration(
  value: unknown,
  authorization: MobileAuthorization,
  now: number,
): Promise<MobileV2ReceiptMigrationMetadata> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'server_identity',
      'credential_id',
      'credential_revision',
      'authorization_revision',
      'principal_generation',
      'delegation_id',
      'tenant_id',
      'actor_id',
      'issued_at_ms',
      'expires_at_ms',
      'project_roots',
      'actions',
    ]) ||
    !Array.isArray(value.project_roots) ||
    !Array.isArray(value.actions)
  ) {
    throw new Error('persisted_connection_invalid');
  }
  return deriveMobileV2ReceiptMigrationMetadata(
    {
      ...value,
      credential_revision: exactDecimal(value.credential_revision, false),
      authorization_revision: exactDecimal(value.authorization_revision, false),
      principal_generation: exactDecimal(value.principal_generation, false),
      issued_at_ms: exactDecimal(value.issued_at_ms, true),
      expires_at_ms: exactDecimal(value.expires_at_ms, true),
    },
    expectedWorkspaceAuthorization(authorization, now),
  );
}

function admitWorkspaceReceiptMigration(
  value: unknown,
  authorization: MobileAuthorization,
): MobileV2ReceiptMigrationMetadata {
  return admitMobileV2ReceiptMigrationMetadata(value, {
    serverIdentity: authorization.server_identity,
    credentialId: authorization.credential_id,
  });
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
    workspaceAuthorization: null,
    workspaceReceiptMigration: null,
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

/** Persist only the server-issued v2 grant for the current credential family. */
export async function saveWorkspaceAuthorization(
  connection: ScopedConnection,
  value: DelegatedMobileV2Authorization | undefined,
  now = Date.now(),
): Promise<ScopedConnection> {
  if (!(await secureStoreAvailable())) {
    throw new Error('secure_store_unavailable');
  }
  const workspaceAuthorization =
    value === undefined
      ? undefined
      : admitWorkspaceAuthorization(
          persistWorkspaceAuthorization(value),
          connection.authorization,
          now,
        );
  const workspaceReceiptMigration =
    workspaceAuthorization === undefined
      ? undefined
      : await deriveMobileV2ReceiptMigrationMetadata(
          workspaceAuthorization,
          expectedWorkspaceAuthorization(connection.authorization, now),
        );
  const privateValue = {
    schema: CREDENTIAL_SCHEMA,
    profile: connection.profile,
    accessToken: MobileAccessToken(connection.accessToken),
    refreshToken: MobileRefreshToken(connection.refreshToken),
    authorization: persistAuthorization(connection.authorization),
    workspaceAuthorization:
      workspaceAuthorization === undefined
        ? null
        : persistWorkspaceAuthorization(workspaceAuthorization),
    workspaceReceiptMigration:
      workspaceReceiptMigration === undefined
        ? null
        : persistWorkspaceReceiptMigration(workspaceReceiptMigration),
  } as const;
  await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(privateValue), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const {
    workspaceAuthorization: _previous,
    workspaceReceiptMigration: _previousMigration,
    ...base
  } = connection;
  if (
    workspaceAuthorization === undefined ||
    workspaceReceiptMigration === undefined
  ) {
    return base;
  }
  return { ...base, workspaceAuthorization, workspaceReceiptMigration };
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
    const legacyPrivateValue =
      isRecord(privateValue) &&
      privateValue.schema === LEGACY_CREDENTIAL_SCHEMA &&
      hasExactKeys(privateValue, [
        'schema',
        'profile',
        'accessToken',
        'refreshToken',
        'authorization',
      ]);
    const previousPrivateValue =
      isRecord(privateValue) &&
      privateValue.schema === PREVIOUS_CREDENTIAL_SCHEMA &&
      hasExactKeys(privateValue, [
        'schema',
        'profile',
        'accessToken',
        'refreshToken',
        'authorization',
        'workspaceAuthorization',
      ]);
    const currentPrivateValue =
      isRecord(privateValue) &&
      privateValue.schema === CREDENTIAL_SCHEMA &&
      hasExactKeys(privateValue, [
        'schema',
        'profile',
        'accessToken',
        'refreshToken',
        'authorization',
        'workspaceAuthorization',
        'workspaceReceiptMigration',
      ]);
    if (
      !isRecord(privateValue) ||
      (!legacyPrivateValue && !previousPrivateValue && !currentPrivateValue) ||
      typeof privateValue.accessToken !== 'string' ||
      typeof privateValue.refreshToken !== 'string'
    ) {
      throw new Error('persisted_connection_invalid');
    }
    const privateProfile = admitProfile(privateValue.profile);
    const authorization = admitAuthorization(privateValue.authorization);
    let workspaceAuthorization: DelegatedMobileV2Authorization | undefined;
    let workspaceReceiptMigration: MobileV2ReceiptMigrationMetadata | undefined;
    if (
      currentPrivateValue &&
      privateValue.workspaceReceiptMigration !== null
    ) {
      try {
        workspaceReceiptMigration = admitWorkspaceReceiptMigration(
          privateValue.workspaceReceiptMigration,
          authorization,
        );
      } catch {
        // Optional non-authority metadata can never invalidate the refresh
        // credential. A live grant below can reconstruct an exact copy.
      }
    }
    if (
      (previousPrivateValue || currentPrivateValue) &&
      privateValue.workspaceAuthorization !== null
    ) {
      try {
        workspaceAuthorization = admitWorkspaceAuthorization(
          privateValue.workspaceAuthorization,
          authorization,
          now,
        );
        const derived = await deriveWorkspaceReceiptMigration(
          privateValue.workspaceAuthorization,
          authorization,
          now,
        );
        if (
          workspaceReceiptMigration !== undefined &&
          JSON.stringify(workspaceReceiptMigration) !== JSON.stringify(derived)
        ) {
          workspaceAuthorization = undefined;
          workspaceReceiptMigration = undefined;
        } else {
          workspaceReceiptMigration = derived;
        }
      } catch {
        try {
          // An expired old grant is admitted only through this derivation. Its
          // authority object is never returned to the lifecycle or gateway.
          const derived = await deriveWorkspaceReceiptMigration(
            privateValue.workspaceAuthorization,
            authorization,
            now,
          );
          if (
            workspaceReceiptMigration !== undefined &&
            JSON.stringify(workspaceReceiptMigration) !==
              JSON.stringify(derived)
          ) {
            workspaceReceiptMigration = undefined;
          } else {
            workspaceReceiptMigration = derived;
          }
        } catch {
          // Malformed optional state is discarded without erasing a valid
          // primary access/refresh generation.
          workspaceReceiptMigration = undefined;
        }
      }
    }
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
      ...(workspaceAuthorization === undefined
        ? {}
        : { workspaceAuthorization }),
      ...(workspaceReceiptMigration === undefined
        ? {}
        : { workspaceReceiptMigration }),
    };
    if (!legacyPrivateValue) {
      const sanitizedPrivateValue = {
        schema: CREDENTIAL_SCHEMA,
        profile: privateProfile,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        authorization: persistAuthorization(authorization),
        workspaceAuthorization:
          workspaceAuthorization === undefined
            ? null
            : persistWorkspaceAuthorization(workspaceAuthorization),
        workspaceReceiptMigration:
          workspaceReceiptMigration === undefined
            ? null
            : persistWorkspaceReceiptMigration(workspaceReceiptMigration),
      } as const;
      const sanitized = JSON.stringify(sanitizedPrivateValue);
      if (sanitized !== credentialJson) {
        await SecureStore.setItemAsync(CREDENTIAL_KEY, sanitized, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => undefined);
      }
    }
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

const REGISTRY_MANIFEST_KEY = 'automonique.mobile.credential-registry.v6';
const REGISTRY_JOURNAL_KEY =
  'automonique.mobile.credential-registry-journal.v6';
const REGISTRY_PROFILE_MIRROR_KEY = 'automonique.mobile.connection-profiles.v6';
const REGISTRY_MANIFEST_SCHEMA = 'automonique.mobile.credential-registry/v6';
const REGISTRY_JOURNAL_SCHEMA =
  'automonique.mobile.credential-registry-journal/v1';
const REGISTRY_SLOT_SCHEMA = 'automonique.mobile.credential-slot/v6';
const REGISTRY_PROFILE_MIRROR_SCHEMA =
  'automonique.mobile.connection-profiles/v6';
const MAX_CREDENTIAL_SLOTS = 8;

type CredentialShadow = 'a' | 'b';

interface CredentialSlotManifest {
  readonly slotId: string;
  readonly activeShadow: CredentialShadow;
  readonly generation: string;
  readonly serverIdentity: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
}

interface CredentialRegistryManifest {
  readonly schema: typeof REGISTRY_MANIFEST_SCHEMA;
  readonly revision: string;
  readonly selectedMutationSlotId: string | null;
  readonly slots: readonly CredentialSlotManifest[];
}

interface CredentialRegistryJournal {
  readonly schema: typeof REGISTRY_JOURNAL_SCHEMA;
  readonly operation: 'write' | 'select' | 'revoke';
  readonly previousManifest: CredentialRegistryManifest;
  readonly nextManifest: CredentialRegistryManifest;
  readonly target: {
    readonly slotId: string;
    readonly shadow: CredentialShadow;
    readonly generation: string;
  } | null;
  readonly cleanupSlotIds: readonly string[];
}

interface PersistedCredentialSlot {
  readonly schema: typeof REGISTRY_SLOT_SCHEMA;
  readonly slotId: string;
  readonly generation: string;
  readonly connection: {
    readonly schema: typeof CREDENTIAL_SCHEMA;
    readonly profile: ConnectionProfile;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly authorization: PersistedAuthorization;
    readonly workspaceAuthorization: PersistedWorkspaceAuthorization | null;
    readonly workspaceReceiptMigration: PersistedWorkspaceReceiptMigration | null;
  };
}

export interface CredentialRegistrySlot {
  readonly slotId: string;
  readonly state: StoredConnection;
}

export interface CredentialRegistry {
  readonly slots: readonly CredentialRegistrySlot[];
  readonly selectedMutationSlotId: string | null;
  readonly malformedSlotIds: readonly string[];
}

export type CredentialRegistryLoad =
  | { readonly kind: 'ready'; readonly registry: CredentialRegistry }
  | {
      readonly kind: 'recovery_required';
      readonly reason:
        | 'legacy_registry_mismatch'
        | 'selected_slot_unavailable'
        | 'manifest_invalid';
      readonly registry: CredentialRegistry;
    };

function emptyRegistryManifest(): CredentialRegistryManifest {
  return {
    schema: REGISTRY_MANIFEST_SCHEMA,
    revision: '0',
    selectedMutationSlotId: null,
    slots: [],
  };
}

function slotKey(slotId: string, shadow: CredentialShadow): string {
  return `automonique.mobile.credential-slot.v6.${slotId}.${shadow}`;
}

function isSlotId(value: unknown): value is string {
  return typeof value === 'string' && /^slot_[0-9a-f]{32}$/u.test(value);
}

function newSlotId(): string {
  return `slot_${Crypto.randomUUID().replaceAll('-', '').toLowerCase()}`;
}

function incrementDecimal(value: string): string {
  return (exactDecimal(value, true) + 1n).toString();
}

function admitSlotManifest(value: unknown): CredentialSlotManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'slotId',
      'activeShadow',
      'generation',
      'serverIdentity',
      'credentialId',
      'credentialRevision',
    ]) ||
    !isSlotId(value.slotId) ||
    (value.activeShadow !== 'a' && value.activeShadow !== 'b') ||
    typeof value.serverIdentity !== 'string' ||
    typeof value.credentialId !== 'string'
  ) {
    throw new Error('credential_registry_manifest_invalid');
  }
  exactDecimal(value.generation, false);
  exactDecimal(value.credentialRevision, false);
  return {
    slotId: value.slotId,
    activeShadow: value.activeShadow,
    generation: value.generation as string,
    serverIdentity: MobileServerIdentity(value.serverIdentity),
    credentialId: MobileCredentialId(value.credentialId),
    credentialRevision: value.credentialRevision as string,
  };
}

function admitManifest(value: unknown): CredentialRegistryManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'revision',
      'selectedMutationSlotId',
      'slots',
    ]) ||
    value.schema !== REGISTRY_MANIFEST_SCHEMA ||
    !Array.isArray(value.slots) ||
    value.slots.length > MAX_CREDENTIAL_SLOTS ||
    !(
      value.selectedMutationSlotId === null ||
      isSlotId(value.selectedMutationSlotId)
    )
  ) {
    throw new Error('credential_registry_manifest_invalid');
  }
  exactDecimal(value.revision, true);
  const slots = value.slots.map(admitSlotManifest);
  if (
    new Set(slots.map(({ slotId }) => slotId)).size !== slots.length ||
    (value.selectedMutationSlotId !== null &&
      !slots.some(({ slotId }) => slotId === value.selectedMutationSlotId))
  ) {
    throw new Error('credential_registry_manifest_invalid');
  }
  return {
    schema: REGISTRY_MANIFEST_SCHEMA,
    revision: value.revision as string,
    selectedMutationSlotId: value.selectedMutationSlotId,
    slots,
  };
}

function admitJournal(value: unknown): CredentialRegistryJournal {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'operation',
      'previousManifest',
      'nextManifest',
      'target',
      'cleanupSlotIds',
    ]) ||
    value.schema !== REGISTRY_JOURNAL_SCHEMA ||
    !['write', 'select', 'revoke'].includes(value.operation as string) ||
    !Array.isArray(value.cleanupSlotIds) ||
    value.cleanupSlotIds.some((slotId) => !isSlotId(slotId))
  ) {
    throw new Error('credential_registry_journal_invalid');
  }
  let target: CredentialRegistryJournal['target'] = null;
  if (value.target !== null) {
    if (
      !isRecord(value.target) ||
      !hasExactKeys(value.target, ['slotId', 'shadow', 'generation']) ||
      !isSlotId(value.target.slotId) ||
      (value.target.shadow !== 'a' && value.target.shadow !== 'b')
    ) {
      throw new Error('credential_registry_journal_invalid');
    }
    exactDecimal(value.target.generation, false);
    target = {
      slotId: value.target.slotId,
      shadow: value.target.shadow,
      generation: value.target.generation as string,
    };
  }
  const operation = value.operation as CredentialRegistryJournal['operation'];
  if ((operation === 'write') !== (target !== null)) {
    throw new Error('credential_registry_journal_invalid');
  }
  return {
    schema: REGISTRY_JOURNAL_SCHEMA,
    operation,
    previousManifest: admitManifest(value.previousManifest),
    nextManifest: admitManifest(value.nextManifest),
    target,
    cleanupSlotIds: [...(value.cleanupSlotIds as string[])],
  };
}

async function readManifest(): Promise<CredentialRegistryManifest> {
  const encoded = await SecureStore.getItemAsync(REGISTRY_MANIFEST_KEY);
  return encoded === null
    ? emptyRegistryManifest()
    : admitManifest(JSON.parse(encoded));
}

async function writeManifest(
  manifest: CredentialRegistryManifest,
): Promise<void> {
  await SecureStore.setItemAsync(
    REGISTRY_MANIFEST_KEY,
    JSON.stringify(manifest),
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

function persistedConnectionFor(
  connection: ScopedConnection,
): PersistedCredentialSlot['connection'] {
  return {
    schema: CREDENTIAL_SCHEMA,
    profile: connection.profile,
    accessToken: MobileAccessToken(connection.accessToken),
    refreshToken: MobileRefreshToken(connection.refreshToken),
    authorization: persistAuthorization(connection.authorization),
    workspaceAuthorization:
      connection.workspaceAuthorization === undefined
        ? null
        : persistWorkspaceAuthorization(connection.workspaceAuthorization),
    workspaceReceiptMigration:
      connection.workspaceReceiptMigration === undefined
        ? null
        : persistWorkspaceReceiptMigration(
            connection.workspaceReceiptMigration,
          ),
  };
}

async function admitPersistedSlot(
  encoded: string,
  expected: CredentialSlotManifest,
  now: number,
): Promise<StoredConnection> {
  const value: unknown = JSON.parse(encoded);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'slotId', 'generation', 'connection']) ||
    value.schema !== REGISTRY_SLOT_SCHEMA ||
    value.slotId !== expected.slotId ||
    value.generation !== expected.generation ||
    !isRecord(value.connection) ||
    !hasExactKeys(value.connection, [
      'schema',
      'profile',
      'accessToken',
      'refreshToken',
      'authorization',
      'workspaceAuthorization',
      'workspaceReceiptMigration',
    ]) ||
    value.connection.schema !== CREDENTIAL_SCHEMA ||
    typeof value.connection.accessToken !== 'string' ||
    typeof value.connection.refreshToken !== 'string'
  ) {
    throw new Error('credential_registry_slot_invalid');
  }
  const privateProfile = admitProfile(value.connection.profile);
  const authorization = admitAuthorization(value.connection.authorization);
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
    authorization.issued_at_ms > BigInt(now) ||
    privateProfile.serverIdentity !== expected.serverIdentity ||
    privateProfile.credentialId !== expected.credentialId ||
    privateProfile.credentialRevision !== expected.credentialRevision
  ) {
    throw new Error('credential_registry_slot_mismatch');
  }
  let workspaceAuthorization: DelegatedMobileV2Authorization | undefined;
  let workspaceReceiptMigration: MobileV2ReceiptMigrationMetadata | undefined;
  if (value.connection.workspaceReceiptMigration !== null) {
    try {
      workspaceReceiptMigration = admitWorkspaceReceiptMigration(
        value.connection.workspaceReceiptMigration,
        authorization,
      );
    } catch {
      // Optional receipt metadata never grants authority.
    }
  }
  if (value.connection.workspaceAuthorization !== null) {
    try {
      workspaceAuthorization = admitWorkspaceAuthorization(
        value.connection.workspaceAuthorization,
        authorization,
        now,
      );
      const derived = await deriveWorkspaceReceiptMigration(
        value.connection.workspaceAuthorization,
        authorization,
        now,
      );
      if (
        workspaceReceiptMigration !== undefined &&
        JSON.stringify(workspaceReceiptMigration) !== JSON.stringify(derived)
      ) {
        workspaceAuthorization = undefined;
        workspaceReceiptMigration = undefined;
      } else {
        workspaceReceiptMigration = derived;
      }
    } catch {
      workspaceAuthorization = undefined;
      workspaceReceiptMigration = undefined;
    }
  }
  const connection: ScopedConnection = {
    profile: privateProfile,
    accessToken: MobileAccessToken(value.connection.accessToken),
    refreshToken: MobileRefreshToken(value.connection.refreshToken),
    authorization,
    ...(workspaceAuthorization === undefined ? {} : { workspaceAuthorization }),
    ...(workspaceReceiptMigration === undefined
      ? {}
      : { workspaceReceiptMigration }),
  };
  return authorization.expires_at_ms <= BigInt(now)
    ? { kind: 'refresh_required', connection }
    : { kind: 'active', connection };
}

async function deleteSlotShadows(slotId: string): Promise<void> {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(slotKey(slotId, 'a')),
    SecureStore.deleteItemAsync(slotKey(slotId, 'b')),
  ]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length === 1) throw failures[0]!.reason;
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      'credential_registry_revoke_failed',
    );
  }
}

async function recoverRegistryJournal(): Promise<void> {
  const encoded = await SecureStore.getItemAsync(REGISTRY_JOURNAL_KEY);
  if (encoded === null) return;
  let journal: CredentialRegistryJournal;
  try {
    journal = admitJournal(JSON.parse(encoded));
  } catch {
    throw new Error('credential_registry_recovery_required');
  }
  if (journal.target !== null) {
    const targetManifest = journal.nextManifest.slots.find(
      ({ slotId }) => slotId === journal.target!.slotId,
    );
    let targetComplete = false;
    if (
      targetManifest !== undefined &&
      targetManifest.activeShadow === journal.target.shadow &&
      targetManifest.generation === journal.target.generation
    ) {
      const targetValue = await SecureStore.getItemAsync(
        slotKey(journal.target.slotId, journal.target.shadow),
      );
      if (targetValue !== null) {
        try {
          await admitPersistedSlot(targetValue, targetManifest, Date.now());
          targetComplete = true;
        } catch {
          targetComplete = false;
        }
      }
    }
    if (!targetComplete) {
      await writeManifest(journal.previousManifest);
      const wasPreviouslyActive = journal.previousManifest.slots.some(
        ({ slotId, activeShadow }) =>
          slotId === journal.target!.slotId &&
          activeShadow === journal.target!.shadow,
      );
      if (!wasPreviouslyActive) {
        await SecureStore.deleteItemAsync(
          slotKey(journal.target.slotId, journal.target.shadow),
        ).catch(() => undefined);
      }
      await SecureStore.deleteItemAsync(REGISTRY_JOURNAL_KEY);
      return;
    }
  }
  await writeManifest(journal.nextManifest);
  for (const slotId of journal.cleanupSlotIds) {
    await deleteSlotShadows(slotId);
  }
  await SecureStore.deleteItemAsync(REGISTRY_JOURNAL_KEY);
}

async function commitRegistryJournal(
  journal: CredentialRegistryJournal,
  targetValue?: PersistedCredentialSlot,
): Promise<void> {
  await SecureStore.setItemAsync(
    REGISTRY_JOURNAL_KEY,
    JSON.stringify(journal),
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (journal.target !== null) {
    if (targetValue === undefined) {
      throw new Error('credential_registry_target_missing');
    }
    await SecureStore.setItemAsync(
      slotKey(journal.target.slotId, journal.target.shadow),
      JSON.stringify(targetValue),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  }
  await writeManifest(journal.nextManifest);
  for (const slotId of journal.cleanupSlotIds) {
    await deleteSlotShadows(slotId);
  }
  await SecureStore.deleteItemAsync(REGISTRY_JOURNAL_KEY);
}

async function loadManifestSlots(
  manifest: CredentialRegistryManifest,
  now: number,
): Promise<CredentialRegistry> {
  const slots: CredentialRegistrySlot[] = [];
  const malformedSlotIds: string[] = [];
  for (const slot of manifest.slots) {
    const encoded = await SecureStore.getItemAsync(
      slotKey(slot.slotId, slot.activeShadow),
    );
    if (encoded === null) {
      malformedSlotIds.push(slot.slotId);
      continue;
    }
    try {
      slots.push({
        slotId: slot.slotId,
        state: await admitPersistedSlot(encoded, slot, now),
      });
    } catch {
      malformedSlotIds.push(slot.slotId);
    }
  }
  return {
    slots,
    selectedMutationSlotId: manifest.selectedMutationSlotId,
    malformedSlotIds,
  };
}

async function writePublicRegistryMirror(
  manifest: CredentialRegistryManifest,
  registry: CredentialRegistry,
): Promise<void> {
  const profiles = registry.slots.map(({ slotId, state }) => ({
    slotId,
    profile: {
      origin: state.connection.profile.origin,
      platformEndpoint: state.connection.profile.platformEndpoint,
      serverIdentity: state.connection.profile.serverIdentity,
      credentialId: state.connection.profile.credentialId,
      actor: state.connection.profile.actor,
      accessExpiresAtMs: state.connection.profile.accessExpiresAtMs,
      authorizationRevision: state.connection.profile.authorizationRevision,
      credentialRevision: state.connection.profile.credentialRevision,
    },
  }));
  await AsyncStorage.setItem(
    REGISTRY_PROFILE_MIRROR_KEY,
    JSON.stringify({
      schema: REGISTRY_PROFILE_MIRROR_SCHEMA,
      manifestRevision: manifest.revision,
      selectedMutationSlotId: manifest.selectedMutationSlotId,
      profiles,
    }),
  ).catch(() => undefined);
}

let registryQueue: Promise<void> = Promise.resolve();

async function withRegistryLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = registryQueue;
  let release!: () => void;
  registryQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function prepareIssuedConnection(
  discovery: Pick<
    MobileDiscovery,
    'origin' | 'platform_endpoint' | 'server_identity'
  >,
  issued: IssuedMobileCredentials,
  now: number,
  previous?: ScopedConnection,
): Promise<ScopedConnection> {
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
  return {
    profile: profileFor(discovery, authorization),
    accessToken: MobileAccessToken(issued.access_token),
    refreshToken: MobileRefreshToken(issued.refresh_token),
    authorization,
  };
}

async function migrateLegacyConnection(
  manifest: CredentialRegistryManifest,
  now: number,
): Promise<
  | { readonly manifest: CredentialRegistryManifest; readonly mismatch: false }
  | { readonly manifest: CredentialRegistryManifest; readonly mismatch: true }
> {
  const legacy = await loadStoredConnection(now);
  if (legacy === null) return { manifest, mismatch: false };
  const matching = manifest.slots.find(
    ({ serverIdentity, credentialId }) =>
      serverIdentity === legacy.connection.profile.serverIdentity &&
      credentialId === legacy.connection.profile.credentialId,
  );
  if (matching !== undefined) {
    const encoded = await SecureStore.getItemAsync(
      slotKey(matching.slotId, matching.activeShadow),
    );
    if (encoded === null) return { manifest, mismatch: true };
    try {
      const existing = await admitPersistedSlot(encoded, matching, now);
      if (
        JSON.stringify(persistedConnectionFor(existing.connection)) !==
        JSON.stringify(persistedConnectionFor(legacy.connection))
      ) {
        return { manifest, mismatch: true };
      }
    } catch {
      return { manifest, mismatch: true };
    }
    await removePersistedConnection();
    return { manifest, mismatch: false };
  }
  if (manifest.slots.length > 0) {
    return { manifest, mismatch: true };
  }
  if (manifest.slots.length >= MAX_CREDENTIAL_SLOTS) {
    return { manifest, mismatch: true };
  }
  const slotId = newSlotId();
  const slot: CredentialSlotManifest = {
    slotId,
    activeShadow: 'a',
    generation: '1',
    serverIdentity: legacy.connection.profile.serverIdentity,
    credentialId: legacy.connection.profile.credentialId,
    credentialRevision: legacy.connection.profile.credentialRevision,
  };
  const nextManifest: CredentialRegistryManifest = {
    ...manifest,
    revision: incrementDecimal(manifest.revision),
    selectedMutationSlotId: manifest.selectedMutationSlotId ?? slotId,
    slots: [...manifest.slots, slot],
  };
  const journal: CredentialRegistryJournal = {
    schema: REGISTRY_JOURNAL_SCHEMA,
    operation: 'write',
    previousManifest: manifest,
    nextManifest,
    target: { slotId, shadow: 'a', generation: '1' },
    cleanupSlotIds: [],
  };
  await commitRegistryJournal(journal, {
    schema: REGISTRY_SLOT_SCHEMA,
    slotId,
    generation: '1',
    connection: persistedConnectionFor(legacy.connection),
  });
  // Re-admit the v6 commit before removing either legacy generation.
  const committed = await readManifest();
  const committedRegistry = await loadManifestSlots(committed, now);
  if (!committedRegistry.slots.some((entry) => entry.slotId === slotId)) {
    throw new Error('credential_registry_migration_incomplete');
  }
  await removePersistedConnection();
  return { manifest: committed, mismatch: false };
}

async function loadCredentialRegistryUnlocked(
  now: number,
): Promise<CredentialRegistryLoad> {
  if (!(await secureStoreAvailable())) {
    await AsyncStorage.removeItem(REGISTRY_PROFILE_MIRROR_KEY).catch(
      () => undefined,
    );
    return {
      kind: 'ready',
      registry: {
        slots: [],
        selectedMutationSlotId: null,
        malformedSlotIds: [],
      },
    };
  }
  try {
    await recoverRegistryJournal();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'credential_registry_recovery_required' ||
        error.message === 'credential_registry_manifest_invalid' ||
        error.message === 'credential_registry_journal_invalid')
    ) {
      return {
        kind: 'recovery_required',
        reason: 'manifest_invalid',
        registry: {
          slots: [],
          selectedMutationSlotId: null,
          malformedSlotIds: [],
        },
      };
    }
    throw error;
  }
  let manifest: CredentialRegistryManifest;
  try {
    manifest = await readManifest();
  } catch {
    return {
      kind: 'recovery_required',
      reason: 'manifest_invalid',
      registry: {
        slots: [],
        selectedMutationSlotId: null,
        malformedSlotIds: [],
      },
    };
  }
  const migration = await migrateLegacyConnection(manifest, now);
  manifest = migration.manifest;
  const registry = await loadManifestSlots(manifest, now);
  await writePublicRegistryMirror(manifest, registry);
  if (migration.mismatch) {
    return {
      kind: 'recovery_required',
      reason: 'legacy_registry_mismatch',
      registry,
    };
  }
  if (
    registry.selectedMutationSlotId !== null &&
    !registry.slots.some(
      ({ slotId }) => slotId === registry.selectedMutationSlotId,
    )
  ) {
    return {
      kind: 'recovery_required',
      reason: 'selected_slot_unavailable',
      registry,
    };
  }
  return { kind: 'ready', registry };
}

/** Load all independently admitted server credentials, isolating malformed slots. */
export function loadCredentialRegistry(
  now = Date.now(),
): Promise<CredentialRegistryLoad> {
  return withRegistryLock(() => loadCredentialRegistryUnlocked(now));
}

/** Pair a new server credential without replacing any existing server. */
export function addCredentialRegistryConnection(
  discovery: Pick<
    MobileDiscovery,
    'origin' | 'platform_endpoint' | 'server_identity'
  >,
  issued: IssuedMobileCredentials,
  now = Date.now(),
): Promise<CredentialRegistrySlot> {
  return withRegistryLock(async () => {
    if (!(await secureStoreAvailable()))
      throw new Error('secure_store_unavailable');
    await recoverRegistryJournal();
    const migration = await migrateLegacyConnection(await readManifest(), now);
    if (migration.mismatch)
      throw new Error('credential_registry_recovery_required');
    const manifest = migration.manifest;
    if (manifest.slots.length >= MAX_CREDENTIAL_SLOTS) {
      throw new Error('credential_registry_full');
    }
    const connection = await prepareIssuedConnection(discovery, issued, now);
    if (
      manifest.slots.some(
        ({ serverIdentity, credentialId }) =>
          serverIdentity === connection.profile.serverIdentity ||
          credentialId === connection.profile.credentialId,
      )
    ) {
      throw new Error('credential_registry_duplicate');
    }
    const slotId = newSlotId();
    const slot: CredentialSlotManifest = {
      slotId,
      activeShadow: 'a',
      generation: '1',
      serverIdentity: connection.profile.serverIdentity,
      credentialId: connection.profile.credentialId,
      credentialRevision: connection.profile.credentialRevision,
    };
    const nextManifest: CredentialRegistryManifest = {
      ...manifest,
      revision: incrementDecimal(manifest.revision),
      selectedMutationSlotId: manifest.selectedMutationSlotId ?? slotId,
      slots: [...manifest.slots, slot],
    };
    await commitRegistryJournal(
      {
        schema: REGISTRY_JOURNAL_SCHEMA,
        operation: 'write',
        previousManifest: manifest,
        nextManifest,
        target: { slotId, shadow: 'a', generation: '1' },
        cleanupSlotIds: [],
      },
      {
        schema: REGISTRY_SLOT_SCHEMA,
        slotId,
        generation: '1',
        connection: persistedConnectionFor(connection),
      },
    );
    const registry = await loadManifestSlots(nextManifest, now);
    await writePublicRegistryMirror(nextManifest, registry);
    return registry.slots.find((entry) => entry.slotId === slotId)!;
  });
}

/** Rotate exactly one slot into its inactive complete shadow generation. */
export function rotateCredentialRegistryConnection(
  slotId: string,
  discovery: Pick<
    MobileDiscovery,
    'origin' | 'platform_endpoint' | 'server_identity'
  >,
  issued: IssuedMobileCredentials,
  now = Date.now(),
): Promise<CredentialRegistrySlot> {
  return withRegistryLock(async () => {
    if (!isSlotId(slotId)) throw new Error('credential_registry_slot_invalid');
    if (!(await secureStoreAvailable()))
      throw new Error('secure_store_unavailable');
    await recoverRegistryJournal();
    const manifest = await readManifest();
    const previousSlot = manifest.slots.find((slot) => slot.slotId === slotId);
    if (previousSlot === undefined)
      throw new Error('credential_registry_slot_missing');
    const encoded = await SecureStore.getItemAsync(
      slotKey(slotId, previousSlot.activeShadow),
    );
    if (encoded === null)
      throw new Error('credential_registry_recovery_required');
    const previous = await admitPersistedSlot(encoded, previousSlot, now);
    const connection = await prepareIssuedConnection(
      discovery,
      issued,
      now,
      previous.connection,
    );
    const shadow: CredentialShadow =
      previousSlot.activeShadow === 'a' ? 'b' : 'a';
    const generation = incrementDecimal(previousSlot.generation);
    const slot: CredentialSlotManifest = {
      ...previousSlot,
      activeShadow: shadow,
      generation,
      credentialRevision: connection.profile.credentialRevision,
    };
    const nextManifest: CredentialRegistryManifest = {
      ...manifest,
      revision: incrementDecimal(manifest.revision),
      slots: manifest.slots.map((entry) =>
        entry.slotId === slotId ? slot : entry,
      ),
    };
    await commitRegistryJournal(
      {
        schema: REGISTRY_JOURNAL_SCHEMA,
        operation: 'write',
        previousManifest: manifest,
        nextManifest,
        target: { slotId, shadow, generation },
        cleanupSlotIds: [],
      },
      {
        schema: REGISTRY_SLOT_SCHEMA,
        slotId,
        generation,
        connection: persistedConnectionFor(connection),
      },
    );
    const registry = await loadManifestSlots(nextManifest, now);
    await writePublicRegistryMirror(nextManifest, registry);
    return registry.slots.find((entry) => entry.slotId === slotId)!;
  });
}

/** Replace only one slot's server-issued workspace grant in a new shadow. */
export function saveCredentialRegistryWorkspaceAuthorization(
  slotId: string,
  value: DelegatedMobileV2Authorization | undefined,
  now = Date.now(),
): Promise<ScopedConnection> {
  return withRegistryLock(async () => {
    if (!isSlotId(slotId)) throw new Error('credential_registry_slot_invalid');
    if (!(await secureStoreAvailable()))
      throw new Error('secure_store_unavailable');
    await recoverRegistryJournal();
    const manifest = await readManifest();
    const previousSlot = manifest.slots.find((slot) => slot.slotId === slotId);
    if (previousSlot === undefined)
      throw new Error('credential_registry_slot_missing');
    const encoded = await SecureStore.getItemAsync(
      slotKey(slotId, previousSlot.activeShadow),
    );
    if (encoded === null)
      throw new Error('credential_registry_recovery_required');
    const previous = await admitPersistedSlot(encoded, previousSlot, now);
    const workspaceAuthorization =
      value === undefined
        ? undefined
        : admitWorkspaceAuthorization(
            persistWorkspaceAuthorization(value),
            previous.connection.authorization,
            now,
          );
    const workspaceReceiptMigration =
      workspaceAuthorization === undefined
        ? undefined
        : await deriveMobileV2ReceiptMigrationMetadata(
            workspaceAuthorization,
            expectedWorkspaceAuthorization(
              previous.connection.authorization,
              now,
            ),
          );
    const {
      workspaceAuthorization: _previousAuthorization,
      workspaceReceiptMigration: _previousMigration,
      ...base
    } = previous.connection;
    const connection: ScopedConnection =
      workspaceAuthorization === undefined ||
      workspaceReceiptMigration === undefined
        ? base
        : { ...base, workspaceAuthorization, workspaceReceiptMigration };
    const shadow: CredentialShadow =
      previousSlot.activeShadow === 'a' ? 'b' : 'a';
    const generation = incrementDecimal(previousSlot.generation);
    const slot: CredentialSlotManifest = {
      ...previousSlot,
      activeShadow: shadow,
      generation,
    };
    const nextManifest: CredentialRegistryManifest = {
      ...manifest,
      revision: incrementDecimal(manifest.revision),
      slots: manifest.slots.map((entry) =>
        entry.slotId === slotId ? slot : entry,
      ),
    };
    await commitRegistryJournal(
      {
        schema: REGISTRY_JOURNAL_SCHEMA,
        operation: 'write',
        previousManifest: manifest,
        nextManifest,
        target: { slotId, shadow, generation },
        cleanupSlotIds: [],
      },
      {
        schema: REGISTRY_SLOT_SCHEMA,
        slotId,
        generation,
        connection: persistedConnectionFor(connection),
      },
    );
    await writePublicRegistryMirror(
      nextManifest,
      await loadManifestSlots(nextManifest, now),
    );
    return connection;
  });
}

/** Select the one credential allowed to issue mutations; this never unions scope. */
export function selectCredentialRegistryMutationSlot(
  slotId: string,
): Promise<void> {
  return withRegistryLock(async () => {
    if (!isSlotId(slotId)) throw new Error('credential_registry_slot_invalid');
    if (!(await secureStoreAvailable()))
      throw new Error('secure_store_unavailable');
    await recoverRegistryJournal();
    const manifest = await readManifest();
    if (!manifest.slots.some((slot) => slot.slotId === slotId)) {
      throw new Error('credential_registry_slot_missing');
    }
    const nextManifest: CredentialRegistryManifest = {
      ...manifest,
      revision: incrementDecimal(manifest.revision),
      selectedMutationSlotId: slotId,
    };
    await commitRegistryJournal({
      schema: REGISTRY_JOURNAL_SCHEMA,
      operation: 'select',
      previousManifest: manifest,
      nextManifest,
      target: null,
      cleanupSlotIds: [],
    });
    await writePublicRegistryMirror(
      nextManifest,
      await loadManifestSlots(nextManifest, Date.now()),
    );
  });
}

/** Revoke exactly one local slot while every other server survives. */
export function revokeCredentialRegistrySlot(slotId: string): Promise<void> {
  return withRegistryLock(async () => {
    if (!isSlotId(slotId)) throw new Error('credential_registry_slot_invalid');
    if (!(await secureStoreAvailable()))
      throw new Error('secure_store_unavailable');
    await recoverRegistryJournal();
    const manifest = await readManifest();
    if (!manifest.slots.some((slot) => slot.slotId === slotId)) return;
    const remaining = manifest.slots.filter((slot) => slot.slotId !== slotId);
    const nextManifest: CredentialRegistryManifest = {
      ...manifest,
      revision: incrementDecimal(manifest.revision),
      selectedMutationSlotId:
        manifest.selectedMutationSlotId === slotId
          ? (remaining[0]?.slotId ?? null)
          : manifest.selectedMutationSlotId,
      slots: remaining,
    };
    await commitRegistryJournal({
      schema: REGISTRY_JOURNAL_SCHEMA,
      operation: 'revoke',
      previousManifest: manifest,
      nextManifest,
      target: null,
      cleanupSlotIds: [slotId],
    });
    await writePublicRegistryMirror(
      nextManifest,
      await loadManifestSlots(nextManifest, Date.now()),
    );
  });
}

/** Compatibility seam for the current single-selected-profile lifecycle. */
export async function loadSelectedCredentialRegistryConnection(
  now = Date.now(),
): Promise<StoredConnection | null> {
  const loaded = await loadCredentialRegistry(now);
  if (loaded.kind !== 'ready') return null;
  const selected = loaded.registry.selectedMutationSlotId;
  return selected === null
    ? null
    : (loaded.registry.slots.find(({ slotId }) => slotId === selected)?.state ??
        null);
}
