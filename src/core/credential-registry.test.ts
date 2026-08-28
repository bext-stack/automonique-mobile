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
  type IssuedMobileCredentials,
  type MobileDiscovery,
} from '@automonique/sdk';

import {
  addCredentialRegistryConnection,
  loadCredentialRegistry,
  loadSelectedCredentialRegistryConnection,
  revokeCredentialRegistrySlot,
  rotateCredentialRegistryConnection,
  saveIssuedConnection,
  selectCredentialRegistryMutationSlot,
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
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

const secureStore = jest.mocked(SecureStore);
const crypto = jest.mocked(Crypto);
const NOW = 1_777_000_000_000;
const MANIFEST_KEY = 'automonique.mobile.credential-registry.v6';
const JOURNAL_KEY = 'automonique.mobile.credential-registry-journal.v6';
const MIRROR_KEY = 'automonique.mobile.connection-profiles.v6';
const LEGACY_PROFILE_KEY = 'automonique.mobile.connection-profile.v3';
const LEGACY_CREDENTIAL_KEY = 'automonique.mobile.scoped-credential.v3';

let secureValues: Map<string, string>;
let uuidSequence: number;

function hex(index: number, length: number): string {
  return index.toString(16).padStart(length, '0').slice(-length);
}

function discovery(index: number): MobileDiscovery {
  const origin = MobileHttpsOrigin(`https://ops-${index}.example.test`);
  return {
    credential_inventory_endpoint:
      `${origin}/api/mobile/credentials/list` as MobileDiscovery['credential_inventory_endpoint'],
    credential_revoke_endpoint:
      `${origin}/api/mobile/credentials/revoke` as MobileDiscovery['credential_revoke_endpoint'],
    operator_provision_endpoint:
      `${origin}/api/mobile/operator-provision` as MobileDiscovery['operator_provision_endpoint'],
    origin,
    pairing_create_endpoint:
      `${origin}/api/mobile/pairings` as MobileDiscovery['pairing_create_endpoint'],
    pairing_exchange_endpoint:
      `${origin}/api/mobile/pairings/exchange` as MobileDiscovery['pairing_exchange_endpoint'],
    platform_endpoint: MobilePlatformEndpoint(`${origin}/api/platform`),
    protocol: 'automonique.mobile-auth',
    schema: MOBILE_AUTH_SCHEMA_V1,
    server_identity: MobileServerIdentity(`sha256:${hex(index, 64)}`),
    supported_versions: [1n as never],
  };
}

function issued(
  index: number,
  revision = 1n,
  actions: readonly ('attach' | 'follow_up')[] = ['attach'],
): IssuedMobileCredentials {
  return {
    access_token: MobileAccessToken(`ma_${hex(index * 2, 43)}`),
    refresh_token: MobileRefreshToken(`mr_${hex(index * 2 + 1, 43)}`),
    authorization: {
      schema: MOBILE_AUTH_SCHEMA_V1,
      actions,
      actor: MobileActor(`operator-${index}`),
      authorization_revision: MobileRevision(1n),
      credential_id: MobileCredentialId(`mc_${hex(index, 43)}`),
      credential_revision: MobileRevision(revision),
      expires_at_ms: MobileEpochMillis(BigInt(NOW + 900_000)),
      issued_at_ms: MobileEpochMillis(BigInt(NOW)),
      limits: {
        max_follow_up_bytes: MobileFollowUpBytes(4096n),
        max_page_events: MobilePageEvents(100n),
      },
      server_identity: discovery(index).server_identity,
      session_scope: [MobileSessionId(`session-${index}`)],
    },
  };
}

function activeSlotKey(slotId: string): string {
  const manifest = JSON.parse(secureValues.get(MANIFEST_KEY)!) as {
    slots: { slotId: string; activeShadow: 'a' | 'b' }[];
  };
  const slot = manifest.slots.find((value) => value.slotId === slotId)!;
  return `automonique.mobile.credential-slot.v6.${slotId}.${slot.activeShadow}`;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  secureValues = new Map();
  uuidSequence = 1;
  crypto.randomUUID.mockImplementation(
    () =>
      `${hex(uuidSequence++, 8)}-0000-4000-8000-000000000000` as `${string}-${string}-${string}-${string}-${string}`,
  );
  secureStore.isAvailableAsync.mockResolvedValue(true);
  secureStore.getItemAsync.mockImplementation(
    async (key) => secureValues.get(key) ?? null,
  );
  secureStore.setItemAsync.mockImplementation(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.deleteItemAsync.mockImplementation(async (key) => {
    secureValues.delete(key);
  });
});

test('adds, explicitly selects, and revokes one slot while every other slot survives', async () => {
  const first = await addCredentialRegistryConnection(
    discovery(1),
    issued(1),
    NOW,
  );
  const second = await addCredentialRegistryConnection(
    discovery(2),
    issued(2, 1n, ['follow_up']),
    NOW,
  );

  let loaded = await loadCredentialRegistry(NOW);
  expect(loaded).toMatchObject({
    kind: 'ready',
    registry: {
      selectedMutationSlotId: first.slotId,
      malformedSlotIds: [],
      slots: [
        {
          slotId: first.slotId,
          state: { connection: { accessToken: issued(1).access_token } },
        },
        {
          slotId: second.slotId,
          state: { connection: { accessToken: issued(2).access_token } },
        },
      ],
    },
  });

  await selectCredentialRegistryMutationSlot(second.slotId);
  await expect(
    loadSelectedCredentialRegistryConnection(NOW),
  ).resolves.toMatchObject({
    connection: { profile: { serverIdentity: discovery(2).server_identity } },
  });
  await revokeCredentialRegistrySlot(first.slotId);

  loaded = await loadCredentialRegistry(NOW);
  expect(loaded).toMatchObject({
    kind: 'ready',
    registry: {
      selectedMutationSlotId: second.slotId,
      slots: [{ slotId: second.slotId }],
    },
  });
  expect(secureValues.has(activeSlotKey(second.slotId))).toBe(true);
  expect(
    [...secureValues.keys()].some((key) => key.includes(first.slotId)),
  ).toBe(false);
});

test('keeps credentials and authority context out of the public profile mirror', async () => {
  await addCredentialRegistryConnection(
    discovery(3),
    issued(3, 1n, ['attach', 'follow_up']),
    NOW,
  );
  const mirror = await AsyncStorage.getItem(MIRROR_KEY);
  expect(mirror).toContain('ops-3.example.test');
  for (const forbidden of [
    'ma_',
    'mr_',
    'session-3',
    'follow_up',
    'actions',
    'sessionScope',
    'workspaceAuthorization',
    'project_roots',
    'delegation_id',
  ]) {
    expect(mirror).not.toContain(forbidden);
  }
  expect(await AsyncStorage.getAllKeys()).toEqual([MIRROR_KEY]);
});

test('enforces the eight-slot ceiling without disturbing admitted slots', async () => {
  const slots = [];
  for (let index = 1; index <= 8; index += 1) {
    slots.push(
      await addCredentialRegistryConnection(
        discovery(index),
        issued(index),
        NOW,
      ),
    );
  }
  await expect(
    addCredentialRegistryConnection(discovery(9), issued(9), NOW),
  ).rejects.toThrow('credential_registry_full');
  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
    registry: { slots: slots.map(({ slotId }) => ({ slotId })) },
  });
});

test('rotates into a complete inactive shadow without altering sibling authority', async () => {
  const first = await addCredentialRegistryConnection(
    discovery(1),
    issued(1),
    NOW,
  );
  const second = await addCredentialRegistryConnection(
    discovery(2),
    issued(2, 1n, ['follow_up']),
    NOW,
  );
  const firstOldKey = activeSlotKey(first.slotId);
  const secondValue = secureValues.get(activeSlotKey(second.slotId));

  await rotateCredentialRegistryConnection(
    first.slotId,
    discovery(1),
    issued(1, 2n),
    NOW,
  );

  expect(activeSlotKey(first.slotId)).not.toBe(firstOldKey);
  expect(secureValues.get(activeSlotKey(second.slotId))).toBe(secondValue);
  const loaded = await loadCredentialRegistry(NOW);
  expect(loaded).toMatchObject({
    kind: 'ready',
    registry: {
      slots: [
        {
          state: {
            connection: {
              profile: { credentialRevision: '2' },
              authorization: { actions: ['attach'] },
            },
          },
        },
        {
          state: {
            connection: {
              profile: { credentialRevision: '1' },
              authorization: { actions: ['follow_up'] },
            },
          },
        },
      ],
    },
  });
});

test('recovers a completed shadow write when the manifest commit was interrupted', async () => {
  const slot = await addCredentialRegistryConnection(
    discovery(1),
    issued(1),
    NOW,
  );
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockRejectedValueOnce(new Error('manifest_crash'));

  await expect(
    rotateCredentialRegistryConnection(
      slot.slotId,
      discovery(1),
      issued(1, 2n),
      NOW,
    ),
  ).rejects.toThrow('manifest_crash');
  expect(secureValues.has(JOURNAL_KEY)).toBe(true);

  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
    registry: {
      slots: [
        { state: { connection: { profile: { credentialRevision: '2' } } } },
      ],
    },
  });
  expect(secureValues.has(JOURNAL_KEY)).toBe(false);
});

test('recovers a completed first pairing when its manifest commit was interrupted', async () => {
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockRejectedValueOnce(new Error('manifest_crash'));

  await expect(
    addCredentialRegistryConnection(discovery(7), issued(7), NOW),
  ).rejects.toThrow('manifest_crash');
  expect(secureValues.has(JOURNAL_KEY)).toBe(true);

  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
    registry: {
      slots: [
        {
          state: {
            connection: {
              profile: { credentialId: issued(7).authorization.credential_id },
            },
          },
        },
      ],
    },
  });
  expect(secureValues.has(JOURNAL_KEY)).toBe(false);
});

test('rolls back an incomplete shadow write and retains the previous generation', async () => {
  const slot = await addCredentialRegistryConnection(
    discovery(1),
    issued(1),
    NOW,
  );
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockRejectedValueOnce(new Error('slot_crash'));

  await expect(
    rotateCredentialRegistryConnection(
      slot.slotId,
      discovery(1),
      issued(1, 2n),
      NOW,
    ),
  ).rejects.toThrow('slot_crash');
  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
    registry: {
      slots: [
        { state: { connection: { profile: { credentialRevision: '1' } } } },
      ],
    },
  });
});

test('migrates valid v5 only after a re-admitted v6 commit', async () => {
  await saveIssuedConnection(discovery(4), issued(4), NOW);
  expect(secureValues.has(LEGACY_CREDENTIAL_KEY)).toBe(true);

  const loaded = await loadCredentialRegistry(NOW);
  expect(loaded).toMatchObject({
    kind: 'ready',
    registry: {
      slots: [
        {
          state: {
            connection: {
              profile: { credentialId: issued(4).authorization.credential_id },
            },
          },
        },
      ],
    },
  });
  expect(secureValues.has(MANIFEST_KEY)).toBe(true);
  expect(secureValues.has(LEGACY_CREDENTIAL_KEY)).toBe(false);
  expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).toBeNull();
});

test('preserves valid v5 when its first v6 shadow cannot be committed', async () => {
  await saveIssuedConnection(discovery(5), issued(5), NOW);
  secureStore.setItemAsync.mockImplementationOnce(async (key, value) => {
    secureValues.set(key, value);
  });
  secureStore.setItemAsync.mockRejectedValueOnce(
    new Error('slot_write_failed'),
  );

  await expect(loadCredentialRegistry(NOW)).rejects.toThrow(
    'slot_write_failed',
  );
  expect(secureValues.has(LEGACY_CREDENTIAL_KEY)).toBe(true);
  expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).not.toBeNull();
});

test('coexisting exact legacy generation is retired but mismatch requires recovery', async () => {
  const slot = await addCredentialRegistryConnection(
    discovery(6),
    issued(6),
    NOW,
  );
  await saveIssuedConnection(discovery(6), issued(6), NOW);
  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
  });
  expect(secureValues.has(LEGACY_CREDENTIAL_KEY)).toBe(false);

  await rotateCredentialRegistryConnection(
    slot.slotId,
    discovery(6),
    issued(6, 2n),
    NOW,
  );
  await saveIssuedConnection(discovery(6), issued(6), NOW);
  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'recovery_required',
    reason: 'legacy_registry_mismatch',
    registry: {
      slots: [
        { state: { connection: { profile: { credentialRevision: '2' } } } },
      ],
    },
  });
  expect(secureValues.has(LEGACY_CREDENTIAL_KEY)).toBe(true);
});

test('isolates one malformed non-selected slot without erasing its healthy sibling', async () => {
  const selected = await addCredentialRegistryConnection(
    discovery(1),
    issued(1),
    NOW,
  );
  const malformed = await addCredentialRegistryConnection(
    discovery(2),
    issued(2),
    NOW,
  );
  secureValues.set(activeSlotKey(malformed.slotId), '{');

  await expect(loadCredentialRegistry(NOW)).resolves.toMatchObject({
    kind: 'ready',
    registry: {
      selectedMutationSlotId: selected.slotId,
      slots: [{ slotId: selected.slotId }],
      malformedSlotIds: [malformed.slotId],
    },
  });
  expect(secureValues.has(activeSlotKey(selected.slotId))).toBe(true);
  expect(secureStore.deleteItemAsync).not.toHaveBeenCalledWith(
    activeSlotKey(selected.slotId),
  );
});
