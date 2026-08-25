// SPDX-License-Identifier: Elastic-2.0

export class EndpointPolicyError extends Error {
  constructor(readonly category: 'invalid_url' | 'https_required') {
    super(category);
    this.name = 'EndpointPolicyError';
  }
}

export function normalizeEndpoint(
  input: string,
  allowLocalhost = __DEV__,
): string {
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
  return endpoint.toString().replace(/\/$/, '');
}
