// SPDX-License-Identifier: Elastic-2.0

import { describeReconnectError } from './reconnect-error';

function transportError(status: number, category: string): Error {
  return Object.assign(new Error(category), { status, category });
}

test('a shed or restarting server asks for a retry, not a diagnosis', () => {
  expect(describeReconnectError(transportError(503, 'remote_refusal'))).toBe(
    'The server is busy or restarting. Try again in a moment. (503)',
  );
  expect(describeReconnectError(transportError(429, 'remote_refusal'))).toMatch(
    /Try again in a moment/,
  );
});

test('a rejected credential points at pairing', () => {
  expect(
    describeReconnectError(transportError(401, 'mobile_credential_invalid')),
  ).toBe(
    'The server no longer accepts this phone. Pair it again. (mobile_credential_invalid)',
  );
});

test('an unreachable server names the network', () => {
  expect(describeReconnectError(new TypeError('Network request failed'))).toBe(
    'The server could not be reached. Check the network.',
  );
});

test('an unknown category is kept so a report can name it', () => {
  expect(
    describeReconnectError(new Error('sdk_session_identity_invalid')),
  ).toBe('The server view could not be loaded. (sdk_session_identity_invalid)');
  expect(describeReconnectError('nope')).toBe(
    'The server view could not be loaded.',
  );
});
