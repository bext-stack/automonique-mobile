// SPDX-License-Identifier: Elastic-2.0

import { admitsOperationalNavigation } from './navigation-policy';

test.each([
  'loading',
  'unpaired',
  'pairing',
  'revoking',
  'recovery_required',
] as const)('%s cannot render operational routes', (phase) => {
  expect(admitsOperationalNavigation(phase)).toBe(false);
});

test.each(['ready', 'refreshing', 'refresh_required'] as const)(
  '%s preserves access to operational views',
  (phase) => {
    expect(admitsOperationalNavigation(phase)).toBe(true);
  },
);
