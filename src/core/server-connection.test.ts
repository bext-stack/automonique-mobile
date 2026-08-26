// SPDX-License-Identifier: Elastic-2.0

import type { MobileDiscovery } from '@automonique/sdk';

import {
  describeServerConnectionError,
  inspectAutomoniqueServer,
} from './server-connection';

const IDENTITY = `sha256:${'a'.repeat(64)}`;

function discovery(
  origin: string,
  supportedVersions: readonly bigint[] = [1n],
): MobileDiscovery {
  return {
    credential_inventory_endpoint: `${origin}/api/mobile/credentials/list`,
    credential_revoke_endpoint: `${origin}/api/mobile/credentials/revoke`,
    operator_provision_endpoint: `${origin}/api/mobile/operator-provision`,
    origin,
    pairing_create_endpoint: `${origin}/api/mobile/pairings`,
    pairing_exchange_endpoint: `${origin}/api/mobile/pairings/exchange`,
    platform_endpoint: `${origin}/api/platform`,
    protocol: 'automonique.mobile-auth',
    schema: 'automonique.mobile-auth/v1',
    server_identity: IDENTITY,
    supported_versions: supportedVersions,
  } as unknown as MobileDiscovery;
}

test('checks a normalized HTTPS origin through canonical SDK discovery', async () => {
  const discover = jest.fn(async (origin: string) => ({
    discovery: discovery(origin),
  }));

  await expect(
    inspectAutomoniqueServer(' https://ops.example.test/ ', undefined, {
      discover,
    }),
  ).resolves.toEqual({
    origin: 'https://ops.example.test',
    platformEndpoint: 'https://ops.example.test/api/platform',
    protocolVersion: '1',
    serverIdentity: IDENTITY,
  });
  expect(discover).toHaveBeenCalledWith(
    'https://ops.example.test',
    expect.any(Function),
    undefined,
  );
});

test('refuses insecure existing infrastructure before discovery', async () => {
  const discover = jest.fn();
  await expect(
    inspectAutomoniqueServer('http://ops.example.test', undefined, {
      discover,
    }),
  ).rejects.toThrow('https_required');
  expect(discover).not.toHaveBeenCalled();
});

test('turns low-level discovery failures into actionable setup guidance', () => {
  expect(describeServerConnectionError(new Error('https_required'))).toContain(
    'HTTPS',
  );
  expect(
    describeServerConnectionError(new Error('mobile_discovery_mismatch')),
  ).toContain('not compatible');
  expect(
    describeServerConnectionError(new TypeError('Network request failed')),
  ).toContain('/.well-known/automonique-mobile');
});

test('admits a server that advertises a newer version alongside a supported one', async () => {
  const discover = jest.fn(async (origin: string) => ({
    discovery: discovery(origin, [1n, 2n]),
  }));

  await expect(
    inspectAutomoniqueServer('https://ops.example.test', undefined, {
      discover,
    }),
  ).resolves.toMatchObject({ protocolVersion: '1' });
});

test('refuses a server whose advertised versions this build cannot speak', async () => {
  const discover = jest.fn(async (origin: string) => ({
    discovery: discovery(origin, [2n]),
  }));

  await expect(
    inspectAutomoniqueServer('https://ops.example.test', undefined, {
      discover,
    }),
  ).rejects.toThrow('mobile_protocol_unsupported');
});

test('explains an unsupported protocol version as an app update', () => {
  expect(
    describeServerConnectionError(new Error('mobile_protocol_unsupported')),
  ).toContain('Update the app');
});
