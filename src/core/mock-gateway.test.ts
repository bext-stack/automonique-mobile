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
  const reconciled = await gateway.reconcile({
    action: 'follow_up',
    idempotencyKey: 'same-key',
    session: session.target,
    target: session.target,
  });
  expect(retry).toEqual(first);
  expect(reconciled).toEqual(first);
});

test('approval decision fails closed on a stale exact revision', async () => {
  const gateway = createMockGateway();
  const approval = syntheticSnapshot.approvals[0]!;
  await expect(
    gateway.decideApproval({
      session: approval.session,
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

test('attachment resumes strictly after an admitted cursor', async () => {
  const gateway = createMockGateway();
  const session = syntheticSnapshot.sessions[0]!;
  const attachment = await gateway.attach(session.target, '2');
  const pages = [];
  for await (const value of attachment.events()) pages.push(value);

  expect(attachment.sequence).toBe('2');
  expect(pages[0]?.afterCursor).toBe('2');
  expect(pages[0]?.events.map((event) => event.sequence)).toEqual(['3']);
  await expect(gateway.attach(session.target, 'missing')).rejects.toThrow(
    'cursor_unknown',
  );
});

test('an idempotency key cannot alias a different command', async () => {
  const gateway = createMockGateway();
  const session = syntheticSnapshot.sessions[0]!;
  await gateway.followUp({
    session: session.target,
    text: 'First command',
    idempotencyKey: 'collision-key',
  });
  await expect(
    gateway.followUp({
      session: session.target,
      text: 'Different command',
      idempotencyKey: 'collision-key',
    }),
  ).rejects.toThrow('idempotency_key_conflict');
});

test('approval and run commands require their exact authority-qualified target', async () => {
  const gateway = createMockGateway();
  const approval = syntheticSnapshot.approvals[0]!;
  await expect(
    gateway.decideApproval({
      session: approval.session,
      approval: {
        ...approval.target,
        coordinate: { ...approval.target.coordinate, authority: 'provider' },
      },
      decision: 'deny',
      idempotencyKey: 'wrong-authority',
    }),
  ).rejects.toThrow('approval_revision_conflict');

  const session = syntheticSnapshot.sessions[0]!;
  await gateway.stopRun({
    session: session.target,
    run: session.run!,
    idempotencyKey: 'stop-1',
  });
  await expect(
    gateway.stopRun({
      session: session.target,
      run: session.run!,
      idempotencyKey: 'stop-2',
    }),
  ).rejects.toThrow('run_revision_conflict');
});
