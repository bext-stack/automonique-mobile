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
  MobileProtocolVersion,
  MobileRefreshToken,
  MobileRevision,
  MobileServerIdentity,
  MobileSessionId,
  type IssuedMobileCredentials,
  type MobileDiscovery,
} from '@automonique/sdk';

import {
  loadStoredConnection,
  revokeLocalCredential,
  saveIssuedConnection,
} from './credential-store';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  isAvailableAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const secureStore = jest.mocked(SecureStore);
const storage = jest.mocked(AsyncStorage);
const NOW = 1_777_000_000_000;
const IDENTITY = MobileServerIdentity(`sha256:${'a'.repeat(64)}`);
const CREDENTIAL_ID = MobileCredentialId(`mc_${'b'.repeat(43)}`);
const DISCOVERY: MobileDiscovery = {
  credential_inventory_endpoint:
    'https://ops.example.test/api/mobile/credentials/list' as MobileDiscovery['credential_inventory_endpoint'],
  credential_revoke_endpoint:
    'https://ops.example.test/api/mobile/credentials/revoke' as MobileDiscovery['credential_revoke_endpoint'],
  operator_provision_endpoint:
    'https://ops.example.test/api/mobile/operator-provision' as MobileDiscovery['operator_provision_endpoint'],
  origin: MobileHttpsOrigin('https://ops.example.test'),
  pairing_create_endpoint:
    'https://ops.example.test/api/mobile/pairings' as MobileDiscovery['pairing_create_endpoint'],
  pairing_exchange_endpoint:
    'https://ops.example.test/api/mobile/pairings/exchange' as MobileDiscovery['pairing_exchange_endpoint'],
  platform_endpoint: MobilePlatformEndpoint(
    'https://ops.example.test/api/platform',
  ),
  protocol: 'automonique.mobile-auth',
  schema: MOBILE_AUTH_SCHEMA_V1,
  server_identity: IDENTITY,
  supported_versions: [MobileProtocolVersion(1n)],
};

function issued(
  expiresAt = NOW + 900_000,
  revision = 1n,
): IssuedMobileCredentials {
  return {
    access_token: MobileAccessToken(`ma_${'c'.repeat(43)}`),
    refresh_token: MobileRefreshToken(`mr_${'d'.repeat(43)}`),
    authorization: {
      schema: MOBILE_AUTH_SCHEMA_V1,
      actions: ['attach', 'follow_up'],
      actor: MobileActor('operator-1'),
      authorization_revision: MobileRevision(1n),
      credential_id: CREDENTIAL_ID,
      credential_revision: MobileRevision(revision),
      expires_at_ms: MobileEpochMillis(BigInt(expiresAt)),
      issued_at_ms: MobileEpochMillis(BigInt(NOW)),
      limits: {
        max_follow_up_bytes: MobileFollowUpBytes(4096n),
        max_page_events: MobilePageEvents(100n),
      },
      server_identity: IDENTITY,
      session_scope: [MobileSessionId('session-1')],
    },
  };
}

let secureValue: string | null;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  secureValue = null;
  secureStore.isAvailableAsync.mockResolvedValue(true);
  secureStore.setItemAsync.mockImplementation(async (_key, value) => {
    secureValue = value;
  });
  secureStore.getItemAsync.mockImplementation(async () => secureValue);
  secureStore.deleteItemAsync.mockImplementation(async () => {
    secureValue = null;
  });
});

test('stores both rotating tokens only inside the secure generation', async () => {
  await saveIssuedConnection(DISCOVERY, issued(), NOW);
  await expect(loadStoredConnection(NOW)).resolves.toMatchObject({
    kind: 'active',
    connection: {
      accessToken: `ma_${'c'.repeat(43)}`,
      refreshToken: `mr_${'d'.repeat(43)}`,
      profile: { credentialId: CREDENTIAL_ID, credentialRevision: '1' },
    },
  });
  const publicValue = await AsyncStorage.getItem(
    'automonique.mobile.connection-profile.v3',
  );
  expect(publicValue).not.toContain('ma_');
  expect(publicValue).not.toContain('mr_');
  expect(secureStore.setItemAsync).toHaveBeenCalledWith(
    'automonique.mobile.scoped-credential.v3',
    expect.stringContaining(`\"refreshToken\":\"mr_${'d'.repeat(43)}\"`),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
});

test('retains an expired access generation for refresh', async () => {
  await saveIssuedConnection(DISCOVERY, issued(NOW + 1), NOW);
  await expect(loadStoredConnection(NOW + 1)).resolves.toMatchObject({
    kind: 'refresh_required',
    connection: { profile: { credentialId: CREDENTIAL_ID } },
  });
  expect(secureValue).not.toBeNull();
});

test('rotation requires the same credential and commits its new revision', async () => {
  const previous = await saveIssuedConnection(DISCOVERY, issued(), NOW);
  await saveIssuedConnection(
    DISCOVERY,
    issued(NOW + 900_000, 2n),
    NOW,
    previous,
  );
  await expect(loadStoredConnection(NOW)).resolves.toMatchObject({
    connection: { profile: { credentialRevision: '2' } },
  });
  await expect(
    saveIssuedConnection(
      DISCOVERY,
      {
        ...issued(NOW + 900_000, 3n),
        authorization: {
          ...issued().authorization,
          credential_id: MobileCredentialId(`mc_${'e'.repeat(43)}`),
          credential_revision: MobileRevision(3n),
        },
      },
      NOW,
      previous,
    ),
  ).rejects.toThrow('issued_connection_mismatch');
});

test('rotation rejects revision reuse, authorization rollback, and silent scope drift', async () => {
  const previous = await saveIssuedConnection(DISCOVERY, issued(), NOW);
  await expect(
    saveIssuedConnection(DISCOVERY, issued(NOW + 900_000, 1n), NOW, previous),
  ).rejects.toThrow('issued_connection_mismatch');

  const authorizationRevisionTwo = {
    ...issued(NOW + 900_000, 2n),
    authorization: {
      ...issued().authorization,
      authorization_revision: MobileRevision(2n),
      credential_revision: MobileRevision(2n),
    },
  };
  const revisionTwo = await saveIssuedConnection(
    DISCOVERY,
    authorizationRevisionTwo,
    NOW,
    previous,
  );
  await expect(
    saveIssuedConnection(
      DISCOVERY,
      issued(NOW + 900_000, 3n),
      NOW,
      revisionTwo,
    ),
  ).rejects.toThrow('issued_connection_mismatch');

  await expect(
    saveIssuedConnection(
      DISCOVERY,
      {
        ...authorizationRevisionTwo,
        authorization: {
          ...authorizationRevisionTwo.authorization,
          credential_revision: MobileRevision(3n),
          session_scope: [MobileSessionId('session-2')],
        },
      },
      NOW,
      revisionTwo,
    ),
  ).rejects.toThrow('issued_connection_mismatch');
});

test('identity mismatch and already expired issuance fail before persistence', async () => {
  await expect(
    saveIssuedConnection(
      {
        ...DISCOVERY,
        server_identity: MobileServerIdentity(`sha256:${'f'.repeat(64)}`),
      },
      issued(),
      NOW,
    ),
  ).rejects.toThrow('issued_connection_mismatch');
  await expect(
    saveIssuedConnection(DISCOVERY, issued(NOW), NOW),
  ).rejects.toThrow('issued_connection_mismatch');
  expect(secureStore.setItemAsync).not.toHaveBeenCalled();
});

test('keeps the secure generation when the public mirror commit fails', async () => {
  storage.setItem.mockRejectedValueOnce(new Error('profile_write_failed'));
  await expect(
    saveIssuedConnection(DISCOVERY, issued(), NOW),
  ).resolves.toMatchObject({
    profile: { credentialId: CREDENTIAL_ID },
  });
  expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(secureValue).not.toBeNull();
  await expect(loadStoredConnection(NOW)).resolves.toMatchObject({
    kind: 'active',
  });
});

test('repairs a stale public mirror from the authoritative secure generation', async () => {
  await saveIssuedConnection(DISCOVERY, issued(), NOW);
  const key = 'automonique.mobile.connection-profile.v3';
  const persisted = JSON.parse((await AsyncStorage.getItem(key))!) as {
    profile: { actor: string };
  };
  persisted.profile.actor = 'different-operator';
  await AsyncStorage.setItem(key, JSON.stringify(persisted));
  await expect(loadStoredConnection(NOW)).resolves.toMatchObject({
    kind: 'active',
    connection: { profile: { actor: 'operator-1' } },
  });
  expect(await AsyncStorage.getItem(key)).toContain('operator-1');
  expect(secureValue).not.toBeNull();
});

test('reconstructs a missing public mirror after a post-rotation crash', async () => {
  await saveIssuedConnection(DISCOVERY, issued(), NOW);
  const key = 'automonique.mobile.connection-profile.v3';
  await AsyncStorage.removeItem(key);
  await expect(loadStoredConnection(NOW)).resolves.toMatchObject({
    kind: 'active',
  });
  expect(await AsyncStorage.getItem(key)).toContain(CREDENTIAL_ID);
});

test('unavailable secure storage disables and removes the public profile', async () => {
  await saveIssuedConnection(DISCOVERY, issued(), NOW);
  secureStore.isAvailableAsync.mockResolvedValue(false);
  await expect(loadStoredConnection(NOW)).resolves.toBeNull();
  expect(
    await AsyncStorage.getItem('automonique.mobile.connection-profile.v3'),
  ).toBeNull();
});

test('revocation attempts both stores even when one removal fails', async () => {
  storage.removeItem.mockRejectedValueOnce(new Error('profile_delete_failed'));
  await expect(revokeLocalCredential()).rejects.toThrow(
    'profile_delete_failed',
  );
  expect(secureStore.deleteItemAsync).toHaveBeenCalled();
});
