// SPDX-License-Identifier: Elastic-2.0

import { syntheticSnapshot } from './fixtures';
import type {
  ApprovalCommand,
  FollowUpCommand,
  MobileAutomoniqueGateway,
  MobileSnapshot,
  Receipt,
  StopRunCommand,
} from './types';

function cloneSnapshot(): MobileSnapshot {
  return JSON.parse(JSON.stringify(syntheticSnapshot)) as MobileSnapshot;
}

function makeReceipt(
  command: FollowUpCommand | ApprovalCommand | StopRunCommand,
  action: Receipt['action'],
): Receipt {
  const target =
    'session' in command
      ? command.session
      : 'approval' in command
        ? command.approval
        : command.run;
  return {
    id: `receipt-${command.idempotencyKey}`,
    idempotencyKey: command.idempotencyKey,
    action,
    target: target.coordinate,
    revision: target.revision,
    outcome: 'completed',
    explanation: 'Synthetic transport completed the exact revision.',
  };
}

export function createMockGateway(): MobileAutomoniqueGateway {
  const receipts = new Map<string, Receipt>();
  const fingerprints = new Map<string, string>();
  const approvals = new Map(
    syntheticSnapshot.approvals.map((approval) => [
      approval.target.coordinate.id,
      approval,
    ]),
  );
  const sessions = new Map(
    syntheticSnapshot.sessions.map((session) => [
      session.target.coordinate.id,
      session,
    ]),
  );

  function existingReceipt(
    idempotencyKey: string,
    fingerprint: string,
  ): Receipt | null {
    const existing = receipts.get(idempotencyKey);
    if (!existing) return null;
    if (fingerprints.get(idempotencyKey) !== fingerprint) {
      throw new Error('idempotency_key_conflict');
    }
    return existing;
  }

  function remember(
    receipt: Receipt,
    idempotencyKey: string,
    fingerprint: string,
  ): Receipt {
    receipts.set(idempotencyKey, receipt);
    fingerprints.set(idempotencyKey, fingerprint);
    return receipt;
  }

  return {
    async bootstrap() {
      return cloneSnapshot();
    },

    async attach(target, afterCursor) {
      const current = sessions.get(target.coordinate.id);
      if (
        !current?.attachable ||
        JSON.stringify(current.target) !== JSON.stringify(target)
      ) {
        throw new Error('session_revision_conflict');
      }
      const allEvents = syntheticSnapshot.timelines[target.coordinate.id] ?? [];
      const cursorIndex =
        afterCursor === null
          ? -1
          : allEvents.findIndex((event) => event.cursor === afterCursor);
      if (afterCursor !== null && cursorIndex < 0) {
        throw new Error('cursor_unknown');
      }
      const events = allEvents.slice(cursorIndex + 1);
      return {
        session: target,
        cursor: afterCursor,
        sequence:
          afterCursor === null
            ? null
            : (allEvents[cursorIndex]?.sequence ?? null),
        async *events() {
          yield {
            sessionId: target.coordinate.id,
            afterCursor,
            cursor: events.at(-1)?.cursor ?? afterCursor ?? '0',
            events,
          };
        },
      };
    },

    async followUp(command) {
      const fingerprint = JSON.stringify(['follow_up', command]);
      const existing = existingReceipt(command.idempotencyKey, fingerprint);
      if (existing) return existing;
      if (!command.text.trim()) throw new Error('follow_up_empty');
      const current = sessions.get(command.session.coordinate.id);
      if (
        !current ||
        !current.followUpAllowed ||
        JSON.stringify(current.target) !== JSON.stringify(command.session)
      ) {
        throw new Error('session_revision_conflict');
      }
      const receipt = makeReceipt(command, 'follow_up');
      return remember(receipt, command.idempotencyKey, fingerprint);
    },

    async decideApproval(command) {
      const fingerprint = JSON.stringify(['decide_approval', command]);
      const existing = existingReceipt(command.idempotencyKey, fingerprint);
      if (existing) return existing;
      const current = approvals.get(command.approval.coordinate.id);
      if (
        !current ||
        JSON.stringify(current.target) !== JSON.stringify(command.approval)
      ) {
        throw new Error('approval_revision_conflict');
      }
      approvals.delete(command.approval.coordinate.id);
      const receipt = makeReceipt(command, 'decide_approval');
      return remember(receipt, command.idempotencyKey, fingerprint);
    },

    async stopRun(command) {
      const fingerprint = JSON.stringify(['stop_run', command]);
      const existing = existingReceipt(command.idempotencyKey, fingerprint);
      if (existing) return existing;
      const current = [...sessions.values()].find(
        (session) => session.run?.coordinate.id === command.run.coordinate.id,
      );
      if (
        !current?.run ||
        JSON.stringify(current.run) !== JSON.stringify(command.run)
      ) {
        throw new Error('run_revision_conflict');
      }
      sessions.set(current.target.coordinate.id, {
        ...current,
        state: 'completed',
        followUpAllowed: false,
        run: null,
      });
      const receipt = makeReceipt(command, 'stop_run');
      return remember(receipt, command.idempotencyKey, fingerprint);
    },

    async reconcile(idempotencyKey) {
      const receipt = receipts.get(idempotencyKey);
      if (!receipt) throw new Error('receipt_unknown');
      return receipt;
    },
  };
}
