// SPDX-License-Identifier: Elastic-2.0

import { syntheticSnapshot } from './fixtures';
import { createMockGateway } from './mock-gateway';

test('ambiguous follow-up reconciliation is idempotent and never resubmits', async () => {
  const gateway = createMockGateway();
  const session = syntheticSnapshot.sessions[0]!;
  const command = {
    session: session.target,
    text: 'Continue safely',
    idempotencyKey: 'same-key',
  };
  const first = await gateway.followUp(command);
  const retry = await gateway.followUp(command);
  const reconciled = await gateway.reconcile('same-key');
  expect(retry).toEqual(first);
  expect(reconciled).toEqual(first);
});

test('approval decision fails closed on a stale exact revision', async () => {
  const gateway = createMockGateway();
  const approval = syntheticSnapshot.approvals[0]!;
  await expect(
    gateway.decideApproval({
      approval: {
        ...approval.target,
        revision: '2' as typeof approval.target.revision,
      },
      decision: 'grant',
      idempotencyKey: 'stale-decision',
    }),
  ).rejects.toThrow('approval_revision_conflict');
});

test('attachment exposes typed resumable pages', async () => {
  const gateway = createMockGateway();
  const session = syntheticSnapshot.sessions[0]!;
  const attachment = await gateway.attach(session.target, null);
  const pages = [];
  for await (const value of attachment.events()) pages.push(value);
  expect(pages).toHaveLength(1);
  expect(pages[0]?.sessionId).toBe(session.target.coordinate.id);
  expect(pages[0]?.cursor).toBe(session.lastCursor);
});
