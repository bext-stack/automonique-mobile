// SPDX-License-Identifier: Elastic-2.0

import {
  MobileHttpsOrigin,
  MobileLifecycleClient,
  type MobileDiscovery,
} from '@automonique/sdk';

import { normalizeEndpoint } from './network-policy';
import { negotiateMobileProtocolVersion } from './negotiation';

export interface CompatibleAutomoniqueServer {
  readonly origin: string;
  readonly platformEndpoint: string;
  readonly serverIdentity: string;
  readonly protocolVersion: string;
}

interface ServerConnectionDependencies {
  readonly discover?: (
    origin: string,
    fetcher: typeof fetch,
    signal?: AbortSignal,
  ) => Promise<{ readonly discovery: MobileDiscovery }>;
  readonly fetcher?: typeof fetch;
}

/**
 * Verify the public, credential-free mobile discovery contract before asking
 * an operator to create a one-time pairing offer.
 */
export async function inspectAutomoniqueServer(
  input: string,
  signal?: AbortSignal,
  dependencies: ServerConnectionDependencies = {},
): Promise<CompatibleAutomoniqueServer> {
  const origin = MobileHttpsOrigin(normalizeEndpoint(input, false));
  const discover = dependencies.discover ?? MobileLifecycleClient.discover;
  const client = await discover(origin, dependencies.fetcher ?? fetch, signal);
  const { discovery } = client;
  return {
    origin: discovery.origin,
    platformEndpoint: discovery.platform_endpoint,
    serverIdentity: discovery.server_identity,
    protocolVersion: negotiateMobileProtocolVersion(
      discovery.supported_versions,
    ).toString(),
  };
}

export function describeServerConnectionError(error: unknown): string {
  const category = error instanceof Error ? error.message : '';
  switch (category) {
    case 'invalid_url':
      return 'Enter the public origin only, for example https://ops.example.com.';
    case 'https_required':
      return 'Your server must use HTTPS without credentials in the URL.';
    case 'mobile_discovery_mismatch':
    case 'mobile_auth_schema_mismatch':
    case 'mobile_auth_protocol_mismatch':
      return 'This server answered, but its mobile API is not compatible with this app.';
    case 'mobile_protocol_unsupported':
      return 'This server speaks a mobile protocol version this app build does not. Update the app.';
    default:
      return 'The app could not verify the Automonique mobile API at this origin. Check HTTPS, DNS, the reverse proxy, and /.well-known/automonique-mobile.';
  }
}
