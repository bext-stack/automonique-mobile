// SPDX-License-Identifier: Elastic-2.0

/**
 * Say why the phone could not refresh its view in words an operator can act
 * on. The technical category stays at the end so a report still names it.
 */
export function describeReconnectError(error: unknown): string {
  if (!(error instanceof Error)) return 'The server view could not be loaded.';
  const status =
    'status' in error && typeof error.status === 'number' ? error.status : null;
  const category =
    'category' in error && typeof error.category === 'string'
      ? error.category
      : error.message;
  if (status === 401 || status === 403) {
    return `The server no longer accepts this phone. Pair it again. (${category})`;
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return `The server is busy or restarting. Try again in a moment. (${status})`;
  }
  if (error.name === 'AbortError') return 'The refresh was interrupted.';
  if (error instanceof TypeError) {
    return 'The server could not be reached. Check the network.';
  }
  switch (category) {
    case 'sdk_capabilities_incompatible':
      return 'This server does not offer everything this phone was authorized for. Update the server or pair again.';
    case 'mobile_session_limit_exceeded':
      return 'The server returned more conversations than this phone can hold.';
    case 'mobile_authorization_expired':
      return 'Secure access expired. Refresh access in Connection.';
    default:
      return `The server view could not be loaded. (${category})`;
  }
}
