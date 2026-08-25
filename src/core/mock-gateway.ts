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
  const approvals = new Map(
    syntheticSnapshot.approvals.map((approval) => [
      approval.target.coordinate.id,
      approval,
    ]),
  );

  return {
    async bootstrap() {
      return cloneSnapshot();
    },

    async attach(target, afterCursor) {
      const events = syntheticSnapshot.timelines[target.coordinate.id] ?? [];
      return {
        session: target,
        cursor: events.at(-1)?.cursor ?? afterCursor ?? '0',
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
      const existing = receipts.get(command.idempotencyKey);
      if (existing) return existing;
      if (!command.text.trim()) throw new Error('follow_up_empty');
      const receipt = makeReceipt(command, 'follow_up');
      receipts.set(command.idempotencyKey, receipt);
      return receipt;
    },

    async decideApproval(command) {
      const existing = receipts.get(command.idempotencyKey);
      if (existing) return existing;
      const current = approvals.get(command.approval.coordinate.id);
      if (!current || current.target.revision !== command.approval.revision) {
        throw new Error('approval_revision_conflict');
      }
      approvals.delete(command.approval.coordinate.id);
      const receipt = makeReceipt(command, 'decide_approval');
      receipts.set(command.idempotencyKey, receipt);
      return receipt;
    },

    async stopRun(command) {
      const existing = receipts.get(command.idempotencyKey);
      if (existing) return existing;
      const receipt = makeReceipt(command, 'stop_run');
      receipts.set(command.idempotencyKey, receipt);
      return receipt;
    },

    async reconcile(idempotencyKey) {
      const receipt = receipts.get(idempotencyKey);
      if (!receipt) throw new Error('receipt_unknown');
      return receipt;
    },
  };
}
