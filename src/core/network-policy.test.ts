// SPDX-License-Identifier: Elastic-2.0

import { normalizeEndpoint } from './network-policy';

test('production endpoints require HTTPS without embedded credentials', () => {
  expect(
    normalizeEndpoint(
      'https://ops.example.test/path?secret=no#fragment',
      false,
    ),
  ).toBe('https://ops.example.test/path');
  expect(() => normalizeEndpoint('http://ops.example.test', false)).toThrow(
    'https_required',
  );
  expect(() =>
    normalizeEndpoint('https://user:password@ops.example.test', false),
  ).toThrow('https_required');
});

test('localhost cleartext is development-only', () => {
  expect(normalizeEndpoint('http://localhost:8080/', true)).toBe(
    'http://localhost:8080',
  );
  expect(() => normalizeEndpoint('http://localhost:8080/', false)).toThrow(
    'https_required',
  );
});
