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
  ProjectId,
  type IssuedMobileCredentials,
  type MobileDiscovery,
  type MobilePairingOffer,
} from '@automonique/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  loadStoredConnection,
  revokeLocalCredential,
  saveIssuedConnection,
  saveWorkspaceAuthorization,
  type ScopedConnection,
} from './credential-store';
import { MobileLifecycleCoordinator } from './mobile-lifecycle';
import { SUPPORTED_MOBILE_PROTOCOL_VERSIONS } from './negotiation';
import {
  MOBILE_V2_ACTIONS,
  MOBILE_V2_AUTHORIZATION_SCHEMA,
  mobileV2AuthorizationDigest,
  mobileV2CredentialFamilyDigest,
} from './mobile-v2-authorization';
import { createWorkspaceV2ReceiptStore } from './workspace-v2-receipt-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      crypto.createHash('sha256').update(value).digest('hex'),
  };
});

jest.mock('./credential-store', () => ({
  loadStoredConnection: jest.fn(),
  revokeLocalCredential: jest.fn(),
  saveIssuedConnection: jest.fn(),
  saveWorkspaceAuthorization: jest.fn(),
}));

const loadStored = jest.mocked(loadStoredConnection);
const removeLocal = jest.mocked(revokeLocalCredential);
const saveIssued = jest.mocked(saveIssuedConnection);
const saveWorkspace = jest.mocked(saveWorkspaceAuthorization);
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

function withWorkspaceAuthorization(value: ScopedConnection): ScopedConnection {
  return {
    ...value,
    workspaceAuthorization: {
      schema: MOBILE_V2_AUTHORIZATION_SCHEMA,
      server_identity: value.authorization.server_identity,
      credential_id: value.authorization.credential_id,
      credential_revision: value.authorization.credential_revision,
      authorization_revision: value.authorization.authorization_revision,
      principal_generation: 1n,
      delegation_id: 'delegation-mobile',
      tenant_id: 'tenant-mobile',
      actor_id: 'operator-mobile',
      issued_at_ms: BigInt(NOW - 1),
      expires_at_ms: BigInt(NOW + 900_000),
      project_roots: [ProjectId('project-mobile')],
      actions: MOBILE_V2_ACTIONS,
    },
  };
}

function workspaceAuthorizationResponse(value: ScopedConnection): Response {
  const authorization =
    withWorkspaceAuthorization(value).workspaceAuthorization!;
  return new Response(
    JSON.stringify({
      actions: authorization.actions,
      actor_id: authorization.actor_id,
      authorization_revision: Number(authorization.authorization_revision),
      credential_id: authorization.credential_id,
      credential_revision: Number(authorization.credential_revision),
      delegation_id: authorization.delegation_id,
      expires_at_ms: Number(authorization.expires_at_ms),
      issued_at_ms: Number(authorization.issued_at_ms),
      principal_generation: Number(authorization.principal_generation),
      project_roots: authorization.project_roots,
      schema: authorization.schema,
      server_identity: authorization.server_identity,
      tenant_id: authorization.tenant_id,
    }),
    {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type':
          'application/vnd.automonique.mobile-platform-v2-authorization.v1+json',
      },
    },
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  removeLocal.mockResolvedValue();
  saveWorkspace.mockImplementation(async (value, workspaceAuthorization) =>
    workspaceAuthorization === undefined
      ? value
      : { ...value, workspaceAuthorization },
  );
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

test('refresh migrates the old receipt digest before remote rotation and reloads it under the new grant', async () => {
  const active = withWorkspaceAuthorization(
    connection(issued(1n, 'c', NOW + 60_000)),
  );
  const oldAuthorization = active.workspaceAuthorization!;
  const oldDigest = await mobileV2AuthorizationDigest(oldAuthorization);
  const familyDigest = await mobileV2CredentialFamilyDigest(oldAuthorization);
  const handle = {
    schema: 'automonique.mobile-workspace-v2-receipt-handle/v2' as const,
    authorization_digest: oldDigest,
    project: 'project-mobile',
    idempotency_key: 'workspace-create-before-rotation',
    preview_id: 'preview-before-rotation',
    preview_revision: '1',
    preview_digest: `sha256:${'a'.repeat(64)}`,
    request_digest: `sha256:${'b'.repeat(64)}`,
    approval_id: null,
    expected_resulting_revision: '1',
    created_at_ms: String(NOW),
  };
  const legacyKey = `automonique.mobile.workspace-v2-receipts.v2.${oldDigest}`;
  const familyKey = `automonique.mobile.workspace-v2-receipts.v3.${familyDigest}`;
  await AsyncStorage.setItem(legacyKey, JSON.stringify([handle]));

  const rotatedIssued = issued(2n, 'd', NOW + 900_000);
  const rotated = connection(rotatedIssued);
  const rotatedAuthorization =
    withWorkspaceAuthorization(rotated).workspaceAuthorization!;
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  saveIssued.mockResolvedValue(rotated);
  const refresh = jest.fn(async () => {
    // This is the irreversible remote rotation boundary. The only legacy copy
    // must already be committed to its exact stable family before it runs.
    expect(await AsyncStorage.getItem(legacyKey)).toBeNull();
    expect(await AsyncStorage.getItem(familyKey)).not.toBeNull();
    return rotatedIssued;
  });
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    fetcher: jest.fn(async () => workspaceAuthorizationResponse(rotated)),
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh,
      revoke: jest.fn(),
    })),
  });
  await lifecycle.hydrate();
  await lifecycle.refresh();
  expect(refresh).toHaveBeenCalledTimes(1);

  // Recreate the store as an app reload would, using only the rotated grant.
  const reloaded = createWorkspaceV2ReceiptStore(
    () => mobileV2CredentialFamilyDigest(rotatedAuthorization),
    () => mobileV2AuthorizationDigest(rotatedAuthorization),
  );
  await expect(reloaded.list()).resolves.toEqual([handle]);
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
  expect(
    platformFetch.mock.calls.some(
      ([input]) => String(input) === 'https://ops.example.test/api/platform/v2',
    ),
  ).toBe(false);
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

test('Platform v2 remains unavailable without an exact server-issued delegated principal', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const lifecycle = new MobileLifecycleCoordinator({ now: () => NOW });
  await lifecycle.hydrate();
  expect(lifecycle.createWorkspaceGateway()).toBeNull();
});

test('hydrates and persists the dedicated server-issued Platform v2 authorization', async () => {
  const active = connection(issued(1n, 'c', NOW + 900_000));
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const platformFetch = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      workspaceAuthorizationResponse(active),
  ) as jest.MockedFunction<typeof fetch>;
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    fetcher: platformFetch,
  });

  await lifecycle.hydrate();
  expect(lifecycle.createWorkspaceGateway()).not.toBeNull();
  expect(platformFetch).toHaveBeenCalledWith(
    'https://ops.example.test/api/mobile/platform-v2/authorization',
    expect.objectContaining({
      credentials: 'omit',
      headers: expect.objectContaining({
        authorization: `Bearer ma_${'c'.repeat(43)}`,
      }),
      method: 'GET',
      redirect: 'error',
    }),
  );
  expect(saveWorkspace).toHaveBeenCalledWith(
    active,
    expect.objectContaining({
      credential_revision: 1n,
      principal_generation: 1n,
      project_roots: ['project-mobile'],
    }),
    NOW,
  );
});

test.each([
  [
    'future grant',
    (value: ScopedConnection) => ({
      ...withWorkspaceAuthorization(value),
      workspaceAuthorization: {
        ...withWorkspaceAuthorization(value).workspaceAuthorization!,
        issued_at_ms: BigInt(NOW + 1),
      },
    }),
  ],
  [
    'mismatched credential',
    (value: ScopedConnection) => ({
      ...withWorkspaceAuthorization(value),
      workspaceAuthorization: {
        ...withWorkspaceAuthorization(value).workspaceAuthorization!,
        credential_revision: 2n,
      },
    }),
  ],
  [
    'unsorted actions',
    (value: ScopedConnection) => ({
      ...withWorkspaceAuthorization(value),
      workspaceAuthorization: {
        ...withWorkspaceAuthorization(value).workspaceAuthorization!,
        actions: [...MOBILE_V2_ACTIONS].reverse(),
      },
    }),
  ],
])(
  'refuses a %s before constructing any v2 transport',
  async (_label, alter) => {
    const active = alter(connection(issued(1n, 'c', NOW + 900_000)));
    loadStored.mockResolvedValue({ kind: 'active', connection: active });
    const platformFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    const lifecycle = new MobileLifecycleCoordinator({
      now: () => NOW,
      fetcher: platformFetch,
    });
    await lifecycle.hydrate();
    expect(() => lifecycle.createWorkspaceGateway()).toThrow(
      'mobile_v2_authorization_invalid',
    );
    expect(platformFetch).not.toHaveBeenCalled();
  },
);

test('a Platform v2 authorization refusal also gates the shared lifecycle', async () => {
  const active = withWorkspaceAuthorization(
    connection(issued(1n, 'c', NOW + 900_000)),
  );
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  const platformFetch = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('', { status: 403 }),
  ) as jest.MockedFunction<typeof fetch>;
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    fetcher: platformFetch,
  });
  await lifecycle.hydrate();

  await expect(
    lifecycle.createWorkspaceGateway()!.negotiate(),
  ).rejects.toThrow();
  expect(platformFetch).toHaveBeenCalledWith(
    'https://ops.example.test/api/platform/v2',
    expect.objectContaining({ method: 'POST', redirect: 'error' }),
  );
  expect(lifecycle.snapshot()).toMatchObject({ phase: 'refresh_required' });
});

test('an old Platform v2 gateway cannot read a rotated credential', async () => {
  let clock = NOW;
  const active = withWorkspaceAuthorization(
    connection(issued(1n, 'c', NOW + 1)),
  );
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
  const oldGateway = lifecycle.createWorkspaceGateway()!;
  clock = NOW + 1;
  await expect(oldGateway.negotiate()).rejects.toThrow();
  // The old request observes generation replacement immediately; wait for the
  // shared rotation task before asserting its committed successor.
  await lifecycle.accessToken();
  expect(
    platformFetch.mock.calls.some(
      ([input]) => String(input) === 'https://ops.example.test/api/platform/v2',
    ),
  ).toBe(false);
  expect(lifecycle.snapshot()).toMatchObject({
    phase: 'ready',
    profile: { credentialRevision: '2' },
  });
});

test('revocation aborts an in-flight Platform v2 call before any late response can be admitted', async () => {
  const active = withWorkspaceAuthorization(
    connection(issued(1n, 'c', NOW + 900_000)),
  );
  loadStored.mockResolvedValue({ kind: 'active', connection: active });
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  const platformFetch = jest.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchStarted();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('fetch_aborted')),
          { once: true },
        );
      });
    },
  ) as jest.MockedFunction<typeof fetch>;
  const lifecycle = new MobileLifecycleCoordinator({
    now: () => NOW,
    fetcher: platformFetch,
    discover: jest.fn(async () => ({
      discovery: DISCOVERY,
      refresh: jest.fn(),
      revoke: jest.fn(async () => undefined),
    })),
  });
  await lifecycle.hydrate();
  const oldRequest = lifecycle.createWorkspaceGateway()!.negotiate();
  await started;
  await lifecycle.revoke();
  await expect(oldRequest).rejects.toThrow();
  expect(lifecycle.snapshot()).toEqual({ phase: 'unpaired', profile: null });
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
