// SPDX-License-Identifier: Elastic-2.0

export class EndpointPolicyError extends Error {
  constructor(readonly category: 'invalid_url' | 'https_required') {
    super(category);
    this.name = 'EndpointPolicyError';
  }
}

export const MAX_ENDPOINT_BYTES = 2_048;

export function normalizeEndpoint(
  input: string,
  allowLocalhost = __DEV__,
): string {
  if (new TextEncoder().encode(input).byteLength > MAX_ENDPOINT_BYTES) {
    throw new EndpointPolicyError('invalid_url');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.trim());
  } catch {
    throw new EndpointPolicyError('invalid_url');
  }

  const local =
    endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (
    (endpoint.protocol !== 'https:' && !(allowLocalhost && local)) ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  ) {
    throw new EndpointPolicyError('https_required');
  }

  endpoint.hash = '';
  endpoint.search = '';
  const normalized = endpoint.toString().replace(/\/$/, '');
  if (new TextEncoder().encode(normalized).byteLength > MAX_ENDPOINT_BYTES) {
    throw new EndpointPolicyError('invalid_url');
  }
  return normalized;
}
