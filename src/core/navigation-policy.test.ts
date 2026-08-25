// SPDX-License-Identifier: Elastic-2.0

import { admitsOperationalNavigation } from './navigation-policy';

test.each([
  'loading',
  'unpaired',
  'pairing',
  'refresh_required',
  'refreshing',
  'revoking',
  'recovery_required',
] as const)('%s cannot render operational routes', (phase) => {
  expect(admitsOperationalNavigation(phase)).toBe(false);
});

test('ready is the only phase admitted to operational routes', () => {
  expect(admitsOperationalNavigation('ready')).toBe(true);
});
