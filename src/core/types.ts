// SPDX-License-Identifier: Elastic-2.0

import type { ResourceAuthority, ResourceKind } from '@automonique/sdk';

export type DecimalRevision = string & { readonly __brand: 'DecimalRevision' };

const MAX_I64 = 9_223_372_036_854_775_807n;

export function decimalRevision(value: string): DecimalRevision {
  if (
    value.length > 19 ||
    !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > MAX_I64
  ) {
    throw new Error('decimal_revision_invalid');
  }
  return value as DecimalRevision;
}

export interface Coordinate {
  readonly authority: ResourceAuthority;
  readonly kind: ResourceKind;
  readonly id: string;
}

export interface VersionedTarget {
  readonly coordinate: Coordinate;
  readonly revision: DecimalRevision;
}

export type ConnectionPhase =
  'live' | 'reconnecting' | 'stale' | 'incompatible';

export type MobileAction =
  'attach' | 'follow_up' | 'decide_approval' | 'stop_run';

export interface ConnectionStatus {
  readonly phase: ConnectionPhase;
  readonly label: string;
  readonly mutationsAllowed: boolean;
  readonly synthetic: boolean;
  readonly allowedActions: readonly MobileAction[];
  readonly limits: {
    readonly maxPageEvents: number;
    readonly maxFollowUpBytes: number;
  };
}

export interface SessionSummary {
  readonly target: VersionedTarget;
  readonly title: string;
  readonly run: VersionedTarget | null;
  readonly state: 'active' | 'waiting' | 'completed' | 'lost';
  readonly attachable: boolean;
  readonly followUpAllowed: boolean;
  readonly observedAt: string;
  readonly lastCursor: string;
}

export type EventProvenance = 'authoritative' | 'preview' | 'synthetic';

interface EventBase {
  readonly id: string;
  readonly cursor: string;
  readonly sequence: DecimalRevision;
  readonly createdAt: string;
  readonly provenance: EventProvenance;
}

export type SessionEvent =
  | (EventBase & {
      readonly kind: 'message';
      readonly role: 'user' | 'assistant';
      readonly text: string;
    })
  | (EventBase & {
      readonly kind: 'tool';
      readonly name: string;
      readonly state: 'started' | 'updated' | 'completed';
      readonly publicText: string | null;
    })
  | (EventBase & {
      readonly kind: 'run_state';
      readonly state: string;
    })
  | (EventBase & {
      readonly kind: 'unknown';
      readonly eventType: string;
    });

export interface SessionPage {
  readonly sessionId: string;
  readonly afterCursor: string | null;
  readonly cursor: string;
  readonly events: readonly SessionEvent[];
}

export interface ApprovalSummary {
  readonly target: VersionedTarget;
  readonly approvalType: 'automonique' | 'provider';
  readonly title: string;
  readonly detail: string;
  readonly impact: string;
  readonly requester: string;
  readonly expiresAt: string | null;
}

export type ReceiptOutcome =
  | 'accepted'
  | 'completed'
  | 'conflict'
  | 'rejected'
  | 'resync_required'
  | 'unknown';

export interface Receipt {
  readonly id: string | null;
  readonly idempotencyKey: string;
  readonly action: 'follow_up' | 'decide_approval' | 'stop_run';
  readonly target: Coordinate;
  readonly revision: DecimalRevision;
  readonly outcome: ReceiptOutcome;
  readonly explanation: string | null;
}

export interface MobileSnapshot {
  readonly schema: 'automonique.mobile-snapshot/v1';
  readonly connection: ConnectionStatus;
  readonly sessions: readonly SessionSummary[];
  readonly timelines: Readonly<Record<string, readonly SessionEvent[]>>;
  readonly approvals: readonly ApprovalSummary[];
  readonly receipts: readonly Receipt[];
}

export interface FollowUpCommand {
  readonly session: VersionedTarget;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface ApprovalCommand {
  readonly approval: VersionedTarget;
  readonly decision: 'grant' | 'deny';
  readonly idempotencyKey: string;
}

export interface StopRunCommand {
  readonly run: VersionedTarget;
  readonly idempotencyKey: string;
}

export interface AttachmentHandle {
  readonly session: VersionedTarget;
  readonly cursor: string | null;
  readonly sequence: DecimalRevision | null;
  events(signal?: AbortSignal): AsyncIterable<SessionPage>;
}

export interface MobileAutomoniqueGateway {
  bootstrap(signal?: AbortSignal): Promise<MobileSnapshot>;
  attach(
    session: VersionedTarget,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<AttachmentHandle>;
  followUp(command: FollowUpCommand, signal?: AbortSignal): Promise<Receipt>;
  decideApproval(
    command: ApprovalCommand,
    signal?: AbortSignal,
  ): Promise<Receipt>;
  stopRun(command: StopRunCommand, signal?: AbortSignal): Promise<Receipt>;
  reconcile(idempotencyKey: string, signal?: AbortSignal): Promise<Receipt>;
}
