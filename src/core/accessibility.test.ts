// SPDX-License-Identifier: Elastic-2.0

import { approvalAnnouncement, receiptAnnouncement } from './accessibility';

test.each([
  ['follow_up', 'completed', 'Follow-up: completed'],
  ['decide_approval', 'resync_required', 'Approval decision: resync required'],
  ['stop_run', 'accepted', 'Run stop request: accepted'],
] as const)(
  'formats a bounded %s result announcement',
  (action, outcome, expected) => {
    expect(receiptAnnouncement(action, outcome)).toBe(expected);
  },
);

test('approval announcements never invent a completed decision', () => {
  expect(approvalAnnouncement('Deploy', 'grant', 'unknown')).toBe(
    'Deploy. Approval decision: unknown',
  );
  expect(approvalAnnouncement('Deploy', 'deny', 'completed')).toBe(
    'Denied Deploy.',
  );
});
