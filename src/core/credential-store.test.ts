// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  loadScopedConnection,
  revokeLocalCredential,
  saveConnectionProfile,
  type ConnectionProfile,
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
const NOW = Date.parse('2026-08-25T09:00:00.000Z');
const PROFILE: ConnectionProfile = {
  endpoint: 'https://ops.example.test/api/platform?discard=yes#fragment',
  actor: 'operator-1',
  credentialExpiresAt: '2026-08-25T10:00:00Z',
  serverIdentity: 'server-1',
};

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

test('stores and loads one normalized, SDK-compatible scoped pair', async () => {
  await saveConnectionProfile(PROFILE, 'token-._~+/=', NOW);

  await expect(loadScopedConnection(NOW)).resolves.toEqual({
    profile: {
      ...PROFILE,
      endpoint: 'https://ops.example.test/api/platform',
      credentialExpiresAt: '2026-08-25T10:00:00.000Z',
    },
    credential: 'token-._~+/=',
  });
  expect(secureStore.setItemAsync).toHaveBeenCalledWith(
    'automonique.mobile.scoped-credential.v1',
    expect.stringContaining('"credential":"token-._~+/="'),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  expect(
    await AsyncStorage.getItem('automonique.mobile.connection-profile.v1'),
  ).not.toContain('token-._~+/=');
});

test.each(['', 'contains space', 'nul\0byte', 'café', 'line\nfeed'])(
  'rejects a bearer token the canonical SDK would reject: %p',
  async (credential) => {
    await expect(
      saveConnectionProfile(PROFILE, credential, NOW),
    ).rejects.toThrow('credential_invalid');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  },
);

test('rejects expired credentials before touching storage', async () => {
  await expect(
    saveConnectionProfile(
      { ...PROFILE, credentialExpiresAt: '2026-08-25T09:00:00Z' },
      'token',
      NOW,
    ),
  ).rejects.toThrow('credential_expired');
  expect(storage.removeItem).not.toHaveBeenCalled();
  expect(secureStore.setItemAsync).not.toHaveBeenCalled();
});

test('rejects impossible expiry dates and malformed identity Unicode', async () => {
  await expect(
    saveConnectionProfile(
      { ...PROFILE, credentialExpiresAt: '2026-02-30T10:00:00Z' },
      'token',
      NOW,
    ),
  ).rejects.toThrow('credential_expired');
  await expect(
    saveConnectionProfile(
      { ...PROFILE, actor: 'operator-\ud800' },
      'token',
      NOW,
    ),
  ).rejects.toThrow('connection_profile_invalid');
  expect(secureStore.setItemAsync).not.toHaveBeenCalled();
});

test('cleans the private half when the public commit fails', async () => {
  storage.setItem.mockRejectedValueOnce(new Error('profile_write_failed'));

  await expect(saveConnectionProfile(PROFILE, 'token', NOW)).rejects.toThrow(
    'profile_write_failed',
  );
  expect(secureStore.deleteItemAsync).toHaveBeenCalled();
  expect(secureValue).toBeNull();
});

test('cleans both halves when the secure write reports failure', async () => {
  secureStore.setItemAsync.mockImplementationOnce(async (_key, value) => {
    secureValue = value;
    throw new Error('credential_write_failed');
  });

  await expect(saveConnectionProfile(PROFILE, 'token', NOW)).rejects.toThrow(
    'credential_write_failed',
  );
  expect(secureStore.deleteItemAsync).toHaveBeenCalled();
  expect(secureValue).toBeNull();
});

test('rejects and removes profile-token mismatches', async () => {
  await saveConnectionProfile(PROFILE, 'token', NOW);
  const key = 'automonique.mobile.connection-profile.v1';
  const persisted = JSON.parse((await AsyncStorage.getItem(key))!) as {
    profile: ConnectionProfile;
  };
  persisted.profile = { ...persisted.profile, actor: 'different-operator' };
  await AsyncStorage.setItem(key, JSON.stringify(persisted));

  await expect(loadScopedConnection(NOW)).resolves.toBeNull();
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(secureValue).toBeNull();
});

test('rejects and removes a pair once it expires', async () => {
  await saveConnectionProfile(PROFILE, 'token', NOW);

  await expect(
    loadScopedConnection(Date.parse('2026-08-25T10:00:00.000Z')),
  ).resolves.toBeNull();
  expect(secureValue).toBeNull();
});

test('a missing half never admits the remaining half', async () => {
  await saveConnectionProfile(PROFILE, 'token', NOW);
  secureValue = null;

  await expect(loadScopedConnection(NOW)).resolves.toBeNull();
  expect(
    await AsyncStorage.getItem('automonique.mobile.connection-profile.v1'),
  ).toBeNull();
});

test('unavailable secure storage disables and removes the public profile', async () => {
  await saveConnectionProfile(PROFILE, 'token', NOW);
  secureStore.isAvailableAsync.mockResolvedValue(false);

  await expect(loadScopedConnection(NOW)).resolves.toBeNull();
  expect(
    await AsyncStorage.getItem('automonique.mobile.connection-profile.v1'),
  ).toBeNull();
});

test('revocation attempts both stores even when one removal fails', async () => {
  storage.removeItem.mockRejectedValueOnce(new Error('profile_delete_failed'));

  await expect(revokeLocalCredential()).rejects.toThrow(
    'profile_delete_failed',
  );
  expect(secureStore.deleteItemAsync).toHaveBeenCalled();
});
