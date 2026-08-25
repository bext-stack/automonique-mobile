// SPDX-License-Identifier: Elastic-2.0

import { syntheticSnapshot } from './fixtures';
import {
  emptyTimelineProjection,
  reduceSessionPage,
  replaceWithSnapshot,
} from './projection';
import { decimalRevision, type SessionEvent, type SessionPage } from './types';

const events = syntheticSnapshot.timelines['session-synthetic-001']!;

function page(
  afterCursor: string | null,
  cursor: string,
  values: readonly SessionEvent[],
): SessionPage {
  return {
    sessionId: 'session-synthetic-001',
    afterCursor,
    cursor,
    events: values,
  };
}

test('snapshot, reconnect, and exact duplicate remain deterministic', () => {
  const snapshot = replaceWithSnapshot(events.slice(0, 2));
  expect(snapshot.cursor).toBe('2');
  const resumed = reduceSessionPage(snapshot, page('2', '3', [events[2]!]));
  expect(resumed.events).toHaveLength(3);
  expect(reduceSessionPage(resumed, page('3', '3', [events[2]!]))).toEqual(
    resumed,
  );
});

test('gap and conflicting duplicate require a snapshot resync', () => {
  const first = reduceSessionPage(
    emptyTimelineProjection,
    page(null, '1', [events[0]!]),
  );
  const gapEvent = { ...events[2]!, sequence: decimalRevision('3') };
  expect(
    reduceSessionPage(first, page('1', '3', [gapEvent])).resyncRequired,
  ).toBe(true);

  const conflicting = {
    ...events[0]!,
    kind: 'unknown' as const,
    eventType: 'future',
  };
  expect(
    reduceSessionPage(first, page('1', '1', [conflicting])).resyncRequired,
  ).toBe(true);
});

test('unknown events are retained without being interpreted', () => {
  const unknown: SessionEvent = {
    id: 'future-1',
    cursor: '1',
    sequence: decimalRevision('1'),
    createdAt: '2026-08-25T09:10:00Z',
    provenance: 'authoritative',
    kind: 'unknown',
    eventType: 'future.server.event',
  };
  const projection = reduceSessionPage(
    emptyTimelineProjection,
    page(null, '1', [unknown]),
  );
  expect(projection.events).toEqual([unknown]);
  expect(projection.resyncRequired).toBe(false);
});

test('decimal revisions reject zero, leading zeros, signs, and overflow', () => {
  for (const invalid of ['0', '01', '-1', '+1', '9223372036854775808']) {
    expect(() => decimalRevision(invalid)).toThrow('decimal_revision_invalid');
  }
  expect(decimalRevision('9007199254740993')).toBe('9007199254740993');
});
