// SPDX-License-Identifier: Elastic-2.0

import {
  ResourceAuthority_VALUES,
  ResourceKind_VALUES,
} from '@automonique/sdk';

import {
  decimalRevision,
  type MobileAction,
  type MobileSnapshot,
  type SessionEvent,
} from './types';
import { timelineMatchesResume } from './projection';

export const MAX_CACHED_SNAPSHOT_BYTES = 256 * 1024;
export const MAX_CACHED_SESSIONS = 100;
export const MAX_CACHED_EVENTS = 1_000;
export const MAX_CACHED_APPROVALS = 100;
export const MAX_CACHED_RECEIPTS = 200;

const ACTIONS: readonly MobileAction[] = [
  'attach',
  'follow_up',
  'decide_approval',
  'stop_run',
];

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
}

function revision(value: unknown): void {
  if (typeof value !== 'string')
    throw new Error('mobile_snapshot_cache_invalid');
  decimalRevision(value);
}

function boundedString(value: unknown, max = 4_096): value is string {
  return typeof value === 'string' && value.length <= max;
}

function coordinate(value: unknown): void {
  const candidate = record(value);
  exactKeys(candidate, ['authority', 'kind', 'id']);
  if (
    !ResourceAuthority_VALUES.includes(
      candidate.authority as (typeof ResourceAuthority_VALUES)[number],
    ) ||
    !ResourceKind_VALUES.includes(
      candidate.kind as (typeof ResourceKind_VALUES)[number],
    ) ||
    !boundedString(candidate.id, 256) ||
    candidate.id.length === 0
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
}

function target(value: unknown): void {
  const candidate = record(value);
  exactKeys(candidate, ['coordinate', 'revision']);
  revision(candidate.revision);
  coordinate(candidate.coordinate);
}

function timestamp(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  if (!boundedString(value, 64) || !Number.isFinite(Date.parse(value))) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
}

function event(value: unknown): void {
  const candidate = record(value);
  if (
    !boundedString(candidate.id, 512) ||
    candidate.id.length === 0 ||
    !boundedString(candidate.cursor, 1_024) ||
    !['authoritative', 'preview', 'synthetic'].includes(
      String(candidate.provenance),
    )
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  revision(candidate.sequence);
  timestamp(candidate.createdAt);
  switch (candidate.kind) {
    case 'message':
      exactKeys(candidate, [
        'id',
        'cursor',
        'sequence',
        'createdAt',
        'provenance',
        'kind',
        'role',
        'text',
      ]);
      if (
        !['user', 'assistant'].includes(String(candidate.role)) ||
        !boundedString(candidate.text, 65_536)
      ) {
        throw new Error('mobile_snapshot_cache_invalid');
      }
      return;
    case 'tool':
      exactKeys(candidate, [
        'id',
        'cursor',
        'sequence',
        'createdAt',
        'provenance',
        'kind',
        'name',
        'state',
        'publicText',
      ]);
      if (
        !boundedString(candidate.name, 256) ||
        !['started', 'updated', 'completed'].includes(
          String(candidate.state),
        ) ||
        (candidate.publicText !== null &&
          !boundedString(candidate.publicText, 65_536))
      ) {
        throw new Error('mobile_snapshot_cache_invalid');
      }
      return;
    case 'run_state':
      exactKeys(candidate, [
        'id',
        'cursor',
        'sequence',
        'createdAt',
        'provenance',
        'kind',
        'state',
      ]);
      if (!boundedString(candidate.state, 256)) {
        throw new Error('mobile_snapshot_cache_invalid');
      }
      return;
    case 'unknown':
      exactKeys(candidate, [
        'id',
        'cursor',
        'sequence',
        'createdAt',
        'provenance',
        'kind',
        'eventType',
      ]);
      if (!boundedString(candidate.eventType, 512)) {
        throw new Error('mobile_snapshot_cache_invalid');
      }
      return;
    default:
      throw new Error('mobile_snapshot_cache_invalid');
  }
}

function admitSnapshot(value: unknown): MobileSnapshot {
  const snapshot = record(value);
  exactKeys(snapshot, [
    'schema',
    'connection',
    'sessions',
    'timelines',
    'approvals',
    'receipts',
  ]);
  if (snapshot.schema !== 'automonique.mobile-snapshot/v1') {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  const connection = record(snapshot.connection);
  exactKeys(connection, [
    'phase',
    'label',
    'mutationsAllowed',
    'synthetic',
    'allowedActions',
    'limits',
  ]);
  if (
    !['live', 'reconnecting', 'stale', 'incompatible'].includes(
      String(connection.phase),
    ) ||
    !boundedString(connection.label, 512) ||
    typeof connection.mutationsAllowed !== 'boolean' ||
    typeof connection.synthetic !== 'boolean' ||
    !Array.isArray(connection.allowedActions) ||
    new Set(connection.allowedActions).size !==
      connection.allowedActions.length ||
    connection.allowedActions.some(
      (action) =>
        typeof action !== 'string' || !ACTIONS.includes(action as MobileAction),
    )
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  const limits = record(connection.limits);
  exactKeys(limits, ['maxPageEvents', 'maxFollowUpBytes']);
  if (
    !Number.isInteger(limits.maxPageEvents) ||
    Number(limits.maxPageEvents) < 1 ||
    Number(limits.maxPageEvents) > 512 ||
    !Number.isInteger(limits.maxFollowUpBytes) ||
    Number(limits.maxFollowUpBytes) < 1 ||
    Number(limits.maxFollowUpBytes) > 65_536
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }

  if (
    !Array.isArray(snapshot.sessions) ||
    snapshot.sessions.length > MAX_CACHED_SESSIONS ||
    !Array.isArray(snapshot.approvals) ||
    snapshot.approvals.length > MAX_CACHED_APPROVALS ||
    !Array.isArray(snapshot.receipts) ||
    snapshot.receipts.length > MAX_CACHED_RECEIPTS
  ) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  const sessionIds = new Set<string>();
  for (const sessionValue of snapshot.sessions) {
    const session = record(sessionValue);
    exactKeys(session, [
      'target',
      'title',
      'run',
      'state',
      'attachable',
      'followUpAllowed',
      'observedAt',
      'lastCursor',
    ]);
    target(session.target);
    if (session.run !== null) target(session.run);
    const sessionCoordinate = record(record(session.target).coordinate);
    const sessionId = sessionCoordinate.id as string;
    if (
      sessionCoordinate.kind !== 'session' ||
      sessionIds.has(sessionId) ||
      !boundedString(session.title, 4_096) ||
      !['active', 'waiting', 'completed', 'lost'].includes(
        String(session.state),
      ) ||
      typeof session.attachable !== 'boolean' ||
      typeof session.followUpAllowed !== 'boolean' ||
      !boundedString(session.lastCursor, 1_024)
    ) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
    sessionIds.add(sessionId);
    if (
      session.run !== null &&
      record(record(session.run).coordinate).kind !== 'run'
    ) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
    timestamp(session.observedAt);
  }
  const approvalIds = new Set<string>();
  for (const approvalValue of snapshot.approvals) {
    const approval = record(approvalValue);
    exactKeys(approval, [
      'target',
      'approvalType',
      'title',
      'detail',
      'impact',
      'requester',
      'expiresAt',
    ]);
    target(approval.target);
    const approvalCoordinate = record(record(approval.target).coordinate);
    const approvalId = approvalCoordinate.id as string;
    if (
      approvalCoordinate.kind !== 'approval' ||
      approvalIds.has(approvalId) ||
      !['automonique', 'provider'].includes(String(approval.approvalType)) ||
      !boundedString(approval.title) ||
      !boundedString(approval.detail, 65_536) ||
      !boundedString(approval.impact, 65_536) ||
      !boundedString(approval.requester, 512)
    ) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
    approvalIds.add(approvalId);
    timestamp(approval.expiresAt, true);
  }
  for (const receiptValue of snapshot.receipts) {
    const receipt = record(receiptValue);
    exactKeys(receipt, [
      'id',
      'idempotencyKey',
      'action',
      'target',
      'revision',
      'outcome',
      'explanation',
    ]);
    revision(receipt.revision);
    coordinate(receipt.target);
    if (
      (receipt.id !== null && !boundedString(receipt.id, 256)) ||
      !boundedString(receipt.idempotencyKey, 256) ||
      receipt.idempotencyKey.length === 0 ||
      !['follow_up', 'decide_approval', 'stop_run'].includes(
        String(receipt.action),
      ) ||
      ![
        'accepted',
        'completed',
        'conflict',
        'rejected',
        'resync_required',
        'unknown',
      ].includes(String(receipt.outcome)) ||
      (receipt.explanation !== null &&
        !boundedString(receipt.explanation, 65_536))
    ) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
  }

  const timelines = record(snapshot.timelines);
  if (Object.keys(timelines).length > MAX_CACHED_SESSIONS) {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  let eventCount = 0;
  for (const [sessionId, events] of Object.entries(timelines)) {
    if (!sessionIds.has(sessionId)) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
    if (!Array.isArray(events))
      throw new Error('mobile_snapshot_cache_invalid');
    eventCount += events.length;
    if (eventCount > MAX_CACHED_EVENTS) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
    for (const eventValue of events) {
      event(eventValue);
    }
    const session = snapshot.sessions.find(
      (candidate) =>
        (record(record(candidate).target).coordinate as { id: string }).id ===
        sessionId,
    ) as { lastCursor: string } | undefined;
    const acknowledged = events.find(
      (candidate) => record(candidate).cursor === session?.lastCursor,
    );
    const acknowledgedSequence =
      acknowledged === undefined
        ? null
        : (record(acknowledged).sequence as SessionEvent['sequence']);
    if (
      session === undefined ||
      !timelineMatchesResume(
        events as readonly SessionEvent[],
        session.lastCursor,
        acknowledgedSequence,
      )
    ) {
      throw new Error('mobile_snapshot_cache_invalid');
    }
  }
  return snapshot as unknown as MobileSnapshot;
}

export function boundMobileSnapshot(snapshot: MobileSnapshot): MobileSnapshot {
  const sessions = snapshot.sessions.slice(0, MAX_CACHED_SESSIONS);
  const sessionIds = new Set(
    sessions.map((session) => session.target.coordinate.id),
  );
  const timelines: Record<string, MobileSnapshot['timelines'][string]> = {};
  let remaining = MAX_CACHED_EVENTS;
  for (const [sessionId, events] of Object.entries(snapshot.timelines)) {
    if (!sessionIds.has(sessionId) || remaining === 0) continue;
    const resumeCursor = sessions.find(
      (session) => session.target.coordinate.id === sessionId,
    )?.lastCursor;
    const acknowledgedIndex = events.findIndex(
      (event) => event.cursor === resumeCursor,
    );
    if (acknowledgedIndex < 0) continue;
    const acknowledged = events.slice(0, acknowledgedIndex + 1);
    const local = events.slice(acknowledgedIndex + 1);
    const admittedAcknowledged = acknowledged.slice(-remaining);
    const localCapacity =
      admittedAcknowledged.length === acknowledged.length
        ? remaining - admittedAcknowledged.length
        : 0;
    const admitted = [
      ...admittedAcknowledged,
      ...local.slice(0, localCapacity),
    ];
    timelines[sessionId] = admitted;
    remaining -= admitted.length;
  }
  return {
    ...snapshot,
    sessions,
    timelines,
    approvals: snapshot.approvals.slice(0, MAX_CACHED_APPROVALS),
    receipts: snapshot.receipts.slice(-MAX_CACHED_RECEIPTS),
  };
}

export function encodeCachedSnapshot(snapshot: MobileSnapshot): string {
  const encoded = JSON.stringify(boundMobileSnapshot(snapshot));
  if (
    new TextEncoder().encode(encoded).byteLength > MAX_CACHED_SNAPSHOT_BYTES
  ) {
    throw new Error('mobile_snapshot_cache_too_large');
  }
  return encoded;
}

export function decodeCachedSnapshot(encoded: string): MobileSnapshot {
  if (
    new TextEncoder().encode(encoded).byteLength > MAX_CACHED_SNAPSHOT_BYTES
  ) {
    throw new Error('mobile_snapshot_cache_too_large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('mobile_snapshot_cache_invalid');
  }
  const snapshot = admitSnapshot(parsed);
  return {
    ...snapshot,
    connection: {
      ...snapshot.connection,
      phase: 'stale',
      label: 'Cached projection — read only',
      mutationsAllowed: false,
    },
  };
}
