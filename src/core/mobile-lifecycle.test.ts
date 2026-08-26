// SPDX-License-Identifier: Elastic-2.0

import {
  MOBILE_AUTH_SCHEMA_V1,
  MobileAccessToken,
  MobileActor,
  MobileCredentialId,
  MobileEpochMillis,
  MobileFollowUpBytes,
  MobileHttpsOrigin,
  MobilePageEvents,
  MobilePairingExchangeEndpoint,
  MobilePairingId,
  MobilePairingToken,
  MobilePlatformEndpoint,
  MobileProtocolVersion,
  MobileRefreshToken,
  MobileRevision,
  MobileServerIdentity,
  MobileSessionId,
  type IssuedMobileCredentials,
  type MobileDiscovery,
  type MobilePairingOffer,
} from '@automonique/sdk';

import {
  loadStoredConnection,
  revokeLocalCredential,
  saveIssuedConnection,
  type ScopedConnection,
} from './credential-store';
import { MobileLifecycleCoordinator } from './mobile-lifecycle';
import { SUPPORTED_MOBILE_PROTOCOL_VERSIONS } from './negotiation';

jest.mock('./credential-store', () => ({
  loadStoredConnection: jest.fn(),
  revokeLocalCredential: jest.fn(),
  saveIssuedConnection: jest.fn(),
}));

const loadStored = jest.mocked(loadStoredConnection);
const removeLocal = jest.mocked(revokeLocalCredential);
const saveIssued = jest.mocked(saveIssuedConnection);
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
const PAIRING_OFFER: MobilePairingOffer = {
  exchange_endpoint: MobilePairingExchangeEndpoint(
    'https://ops.example.test/api/mobile/pairings/exchange',
  ),
  expires_at_ms: MobileEpochMillis(BigInt(NOW + 300_000)),
  origin: DISCOVERY.origin,
  pairing_id: MobilePairingId(`pi_${'e'.repeat(43)}`),
  pairing_token: MobilePairingToken(`mp_${'f'.repeat(43)}`),
  schema: MOBILE_AUTH_SCHEMA_V1,
  server_identity: IDENTITY,
};

function issued(
  revision: bigint,
  token: string,
  expiresAt: number,
): IssuedMobileCredentials {
  return {
    access_token: MobileAccessToken(`ma_${token.repeat(43)}`),
    refresh_token: MobileRefreshToken(`mr_${token.repeat(43)}`),
    authorization: {
      schema: MOBILE_AUTH_SCHEMA_V1,
      actions: ['attach', 'follow_up'],
      actor: MobileActor('operator-1'),
      authorization_revision: MobileRevision(1n),
      credential_id: CREDENTIAL_ID,
      credential_revision: MobileRevision(revision),
      expires_at_ms: MobileEpochMillis(BigInt(expiresAt)),
      issued_at_ms: MobileEpochMillis(BigInt(NOW - 1)),
      limits: {
        max_follow_up_bytes: MobileFollowUpBytes(4096n),
        max_page_events: MobilePageEvents(100n),
      },
      server_identity: IDENTITY,
      session_scope: [MobileSessionId('session-1')],
    },
  };
}

function connection(value: IssuedMobileCredentials): ScopedConnection {
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    authorization: value.authorization,
    profile: {
      origin: DISCOVERY.origin,
      platformEndpoint: DISCOVERY.platform_endpoint,
      serverIdentity: IDENTITY,
      credentialId: CREDENTIAL_ID,
      actor: value.authorization.actor,
      issuedAtMs: value.authorization.issued_at_ms.toString(),
      accessExpiresAtMs: value.authorization.expires_at_ms.toString(),
      authorizationRevision: '1',
      credentialRevision: value.authorization.credential_revision.toString(),
      actions: value.authorization.actions,
      sessionScope: value.authorization.session_scope,
      maxPageEvents: 100,
      maxFollowUpBytes: 4096,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  removeLocal.mockResolvedValue();
});

test('expired access calls share one refresh and one local generation commit', async () => {
  const expired = connection(issued(1n, 'c', NOW));
  const rotatedIssued = issued(2n, 'd', NOW + 900_000);
  const rotated = connection(rotatedIssued);
  loadStored.mockResolvedValue({
    kind: 'refresh_required',
    connection: expired,
  });
  saveIssued.mockResolvedValue(rotated);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refresh = jest.fn(async () => {
    await gate;
    return rotatedIssued;
  });
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh,
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  const first = lifecycle.accessToken();
  const second = lifecycle.accessToken();
  release();
  await expect(Promise.all([first, second])).resolves.toEqual([
    rotated.accessToken,
    rotated.accessToken,
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(saveIssued).toHaveBeenCalledTimes(1);
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });
});

test('a consumed remote refresh plus failed secure commit requires re-pairing', async () => {
  const expired = connection(issued(1n, 'c', NOW));
  loadStored.mockResolvedValue({
    kind: 'refresh_required',
    connection: expired,
  });
  saveIssued.mockRejectedValue(new Error('secure_commit_failed'));
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(async () => issued(2n, 'd', NOW + 900_000)),
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.accessToken()).rejects.toThrow('secure_commit_failed');
  expect(removeLocal).toHaveBeenCalledTimes(1);
  expect(lifecycle.snapshot()).toMatchObject({
    phase: 'recovery_required',
    reason: 'refresh_commit_uncertain',
  });
});

test('revocation is remote-first and only deletes locally after confirmation', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const order: string[] = [];
  removeLocal.mockImplementation(async () => {
    order.push('local');
  });
  const revoke = jest.fn(async () => {
    order.push('remote');
  });
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(),
      revoke,
    })),
  });
  await lifecycle.hydrate();
  await lifecycle.revoke();
  expect(order).toEqual(['remote', 'local']);
  expect(lifecycle.snapshot()).toEqual({ phase: 'unpaired', profile: null });
});

test('failed remote revocation preserves the local credential', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(),
      revoke: jest.fn(async () => {
        throw new Error('offline');
      }),
    })),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.revoke()).rejects.toThrow('offline');
  expect(removeLocal).not.toHaveBeenCalled();
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });
});

test('successful remote revoke never returns to ready when local cleanup fails', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  removeLocal.mockRejectedValue(new Error('secure_delete_failed'));
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(),
      revoke: jest.fn(async () => undefined),
    })),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.revoke()).rejects.toThrow('secure_delete_failed');
  expect(lifecycle.snapshot()).toMatchObject({
    phase: 'recovery_required',
    reason: 'revoked_local_cleanup_failed',
  });
  await expect(lifecycle.accessToken()).rejects.toThrow(
    'mobile_credential_unavailable',
  );
});

test('hydration storage failure becomes an explicit recovery state', async () => {
  loadStored.mockRejectedValue(new Error('secure_store_read_failed'));
  const lifecycle = new MobileLifecycleCoordinator({ now: () => NOW });
  await expect(lifecycle.hydrate()).resolves.toMatchObject({
    phase: 'recovery_required',
    reason: 'secure_store_read_failed',
  });
});

test('an old gateway cannot combine its descriptor with a rotated token', async () => {
  let clock = NOW;
  const active = connection(issued(1n, 'c', NOW + 1));
  const rotatedIssued = issued(2n, 'd', NOW + 900_000);
  const rotated = connection(rotatedIssued);
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  saveIssued.mockResolvedValue(rotated);
  const platformFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => clock,
    fetcher: platformFetch,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(async () => rotatedIssued),
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  const oldGateway = lifecycle.createGateway();
  clock = NOW + 1;
  await expect(oldGateway.bootstrap()).rejects.toThrow(
    'gateway_generation_replaced',
  );
  expect(platformFetch).not.toHaveBeenCalled();
  expect(lifecycle.snapshot()).toMatchObject({
    phase: 'ready',
    profile: { credentialRevision: '2' },
  });
});

test('replacement intent blocks new token readers until queued hydration settles', async () => {
  const expired = connection(issued(1n, 'c', NOW));
  const rotatedIssued = issued(2n, 'd', NOW + 900_000);
  const rotated = connection(rotatedIssued);
  loadStored
    .mockResolvedValueOnce({ kind: 'refresh_required', connection: expired })
    .mockResolvedValue({ kind: 'active', connection: rotated });
  saveIssued.mockResolvedValue(rotated);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refresh = jest.fn(async () => {
    await gate;
    return rotatedIssued;
  });
  const client = { discovery: DISCOVERY, refresh, revoke: jest.fn() };
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => client),
  });
  await lifecycle.hydrate();
  const oldReader = lifecycle.accessToken();
  await Promise.resolve();
  const hydration = lifecycle.hydrate();
  await expect(lifecycle.accessToken()).rejects.toThrow(
    'mobile_credential_unavailable',
  );
  release();
  await oldReader;
  await hydration;
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });
});

test('ready state expires on a timer and foreground validation gates navigation', async () => {
  jest.useFakeTimers();
  try {
    let clock = NOW;
    const active = connection(issued(1n, 'c', NOW + 1_000));
    loadStored.mockResolvedValue({ kind: 'active', connection: active });
    const lifecycle = new MobileLifecycleCoordinator({ now: () => clock });
    await lifecycle.hydrate();
    expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });

    clock = NOW + 1_000;
    jest.advanceTimersByTime(1_000);
    expect(lifecycle.snapshot()).toMatchObject({ phase: 'refresh_required' });

    clock = NOW;
    await lifecycle.hydrate();
    clock = NOW + 1_000;
    expect(lifecycle.validateCurrentAuthorization()).toMatchObject({
      phase: 'refresh_required',
    });
  } finally {
    jest.useRealTimers();
  }
});

test('pairing refuses an offer whose lifetime exceeds the canonical five minutes', async () => {
  loadStored.mockResolvedValue(null);
  const lifecycle = new MobileLifecycleCoordinator({ now: () => NOW });
  await lifecycle.hydrate();
  await expect(
    lifecycle.pair({
      ...PAIRING_OFFER,
      expires_at_ms: MobileEpochMillis(BigInt(NOW + 300_001)),
    }),
  ).rejects.toThrow('mobile_pairing_lifetime_invalid');
});

test('a Platform authorization refusal immediately makes the lifecycle read only', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const platformFetch = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('', { status: 401 }),
  ) as jest.MockedFunction<typeof fetch>;
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    fetcher: platformFetch,
  });
  await lifecycle.hydrate();

  await expect(lifecycle.createGateway().bootstrap()).rejects.toThrow();
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'refresh_required' });
});

test('one-time pairing pins discovery, exchanges once, and commits the issued pair', async () => {
  const pairedIssued = issued(1n, 'c', NOW + 900_000);
  const paired = connection(pairedIssued);
  loadStored.mockResolvedValue(null);
  saveIssued.mockResolvedValue(paired);
  const exchangePairing = jest.fn(async () => pairedIssued);
  const client = {
    discovery: DISCOVERY,
    exchangePairing,
    refresh: jest.fn(),
    revoke: jest.fn(),
  };
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => client),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.pair(PAIRING_OFFER)).resolves.toEqual(paired.profile);
  expect(exchangePairing).toHaveBeenCalledWith(
    {
      pairing_id: PAIRING_OFFER.pairing_id,
      pairing_token: PAIRING_OFFER.pairing_token,
      server_identity: PAIRING_OFFER.server_identity,
    },
    expect.any(AbortSignal),
  );
  expect(saveIssued).toHaveBeenCalledWith(DISCOVERY, pairedIssued, NOW);
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });
});

test('a consumed pairing with failed secure commit enters explicit recovery', async () => {
  loadStored.mockResolvedValue(null);
  saveIssued.mockRejectedValue(new Error('secure_commit_failed'));
  const client = {
    discovery: DISCOVERY,
    exchangePairing: jest.fn(async () => issued(1n, 'c', NOW + 900_000)),
    refresh: jest.fn(),
    revoke: jest.fn(),
  };
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => client),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.pair(PAIRING_OFFER)).rejects.toThrow(
    'secure_commit_failed',
  );
  expect(lifecycle.snapshot()).toMatchObject({
    phase: 'recovery_required',
    reason: 'pairing_commit_uncertain',
  });
});

/**
 * Admission negotiates on the advertised protocol major version, so a server
 * that has moved ahead of this build stays pairable as long as it still
 * advertises a version this build speaks. The vendored schema digest is not
 * consulted; only these version lists decide.
 */
function discoveryAdvertising(versions: readonly bigint[]): MobileDiscovery {
  return {
    ...DISCOVERY,
    supported_versions:
      versions as unknown as MobileDiscovery['supported_versions'],
  };
}

const NEWER_THAN_THIS_BUILD = SUPPORTED_MOBILE_PROTOCOL_VERSIONS.max + 1n;

test('pairing admits a server that also advertises a newer protocol version', async () => {
  const pairedIssued = issued(1n, 'c', NOW + 900_000);
  const paired = connection(pairedIssued);
  loadStored.mockResolvedValue(null);
  saveIssued.mockResolvedValue(paired);
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: discoveryAdvertising([
        SUPPORTED_MOBILE_PROTOCOL_VERSIONS.max,
        NEWER_THAN_THIS_BUILD,
      ]),
      exchangePairing: jest.fn(async () => pairedIssued),
      refresh: jest.fn(),
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.pair(PAIRING_OFFER)).resolves.toEqual(paired.profile);
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'ready' });
});

test('pairing refuses a server with no shared protocol version before exchanging', async () => {
  loadStored.mockResolvedValue(null);
  const exchangePairing = jest.fn();
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    discover: jest.fn(async () => ({
      discovery: discoveryAdvertising([NEWER_THAN_THIS_BUILD]),
      exchangePairing,
      refresh: jest.fn(),
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  await expect(lifecycle.pair(PAIRING_OFFER)).rejects.toThrow(
    'mobile_protocol_unsupported',
  );
  expect(exchangePairing).not.toHaveBeenCalled();
  expect(saveIssued).not.toHaveBeenCalled();
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'unpaired' });
});
