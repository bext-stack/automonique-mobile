// SPDX-License-Identifier: Elastic-2.0

import { fetch as expoFetch } from 'expo/fetch';
import {
  MobileLifecycleClient,
  type MobilePairingOffer,
} from '@automonique/sdk';

import { inspectAutomoniqueServer } from './server-connection';
import { MobileLifecycleCoordinator } from './mobile-lifecycle';
import { describePairingError } from './pairing-offer';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const nativeFetch = jest.mocked(expoFetch);
const origin = 'https://ops.example.test';
const identity = `sha256:${'a'.repeat(64)}`;
const discovery = {
  credential_inventory_endpoint: `${origin}/api/mobile/credentials/list`,
  credential_revoke_endpoint: `${origin}/api/mobile/credentials/revoke`,
  operator_provision_endpoint: `${origin}/api/mobile/operator-provision`,
  origin,
  pairing_create_endpoint: `${origin}/api/mobile/pairings`,
  pairing_exchange_endpoint: `${origin}/api/mobile/pairings/exchange`,
  platform_endpoint: `${origin}/api/platform`,
  protocol: 'automonique.mobile-auth',
  schema: 'automonique.mobile-auth/v1',
  server_identity: identity,
  supported_versions: [1],
};

function response(body: unknown, status = 200): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({
      'content-type': 'application/vnd.automonique.mobile-auth.v1+json',
      'cache-control': 'no-store',
    }),
    body: new ReadableStream({
      start(controller) {
        // Exercise the real SDK's decoder across arbitrary network chunks.
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    }),
  } as Response;
}

beforeEach(() => nativeFetch.mockReset());

test('server setup defaults to streamed native fetch through the real SDK decoder', async () => {
  nativeFetch.mockResolvedValue(response(discovery) as never);
  await expect(inspectAutomoniqueServer(origin)).resolves.toMatchObject({
    origin,
    serverIdentity: identity,
    protocolVersion: '1',
  });
  expect(nativeFetch).toHaveBeenCalledWith(
    `${origin}/.well-known/automonique-mobile`,
    expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
  );
});

test('the legacy React Native response shape reproduces the healthy-server failure', async () => {
  const legacy = response(discovery);
  Object.defineProperty(legacy, 'body', { value: undefined });
  await expect(
    MobileLifecycleClient.discover(origin, async () => legacy),
  ).rejects.toMatchObject({
    category: 'response_stream_unavailable',
    status: 200,
  });
});

test('pairing uses native streams for discovery and exchange and preserves server refusal', async () => {
  nativeFetch.mockResolvedValueOnce(response(discovery) as never);
  nativeFetch.mockResolvedValueOnce(
    response({ error: 'mobile_pairing_invalid' }, 401) as never,
  );
  const lifecycle = new MobileLifecycleCoordinator();
  const offer = {
    exchange_endpoint: discovery.pairing_exchange_endpoint,
    expires_at_ms: BigInt(Date.now() + 240_000),
    origin,
    pairing_id: `pi_${'b'.repeat(43)}`,
    pairing_token: `mp_${'c'.repeat(43)}`,
    schema: discovery.schema,
    server_identity: identity,
  } as MobilePairingOffer;
  let failure: unknown;
  try {
    await lifecycle.pair(offer);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    category: 'mobile_pairing_invalid',
    status: 401,
  });
  expect(describePairingError(failure)).toContain('no longer available');
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  expect(nativeFetch).toHaveBeenLastCalledWith(
    offer.exchange_endpoint,
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  );
  expect(lifecycle.snapshot().phase).toBe('unpaired');
});

test('streamed native responses retain the SDK response-size limit', async () => {
  const oversized = response('x');
  Object.defineProperty(oversized, 'body', {
    value: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    }),
  });
  nativeFetch.mockResolvedValue(oversized as never);
  await expect(inspectAutomoniqueServer(origin)).rejects.toMatchObject({
    category: 'response_too_large',
  });
});
