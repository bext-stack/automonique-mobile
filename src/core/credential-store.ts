// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { normalizeEndpoint } from './network-policy';

const PROFILE_KEY = 'automonique.mobile.connection-profile.v1';
const CREDENTIAL_KEY = 'automonique.mobile.scoped-credential.v1';

export interface ConnectionProfile {
  readonly endpoint: string;
  readonly actor: string;
  readonly credentialExpiresAt: string;
  readonly serverIdentity: string;
}

export async function saveConnectionProfile(
  profile: ConnectionProfile,
  credential: string,
): Promise<void> {
  if (!credential || /\s/.test(credential) || credential.length > 4096) {
    throw new Error('credential_invalid');
  }
  const normalized: ConnectionProfile = {
    ...profile,
    endpoint: normalizeEndpoint(profile.endpoint, false),
  };
  await SecureStore.setItemAsync(CREDENTIAL_KEY, credential, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
}

export async function loadConnectionProfile(): Promise<ConnectionProfile | null> {
  const value = await AsyncStorage.getItem(PROFILE_KEY);
  if (!value) return null;
  const parsed = JSON.parse(value) as ConnectionProfile;
  return { ...parsed, endpoint: normalizeEndpoint(parsed.endpoint, false) };
}

export function loadScopedCredential(): Promise<string | null> {
  return SecureStore.getItemAsync(CREDENTIAL_KEY);
}

export async function revokeLocalCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
  await AsyncStorage.removeItem(PROFILE_KEY);
}
