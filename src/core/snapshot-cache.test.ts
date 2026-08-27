// SPDX-License-Identifier: Elastic-2.0

import { syntheticSnapshot } from './fixtures';
import {
  MAX_CACHED_EVENTS,
  MAX_CACHED_SNAPSHOT_BYTES,
  boundMobileSnapshot,
  decodeCachedSnapshot,
  encodeCachedSnapshot,
} from './snapshot-cache';

test('a valid cache round-trip always reopens stale and read only', () => {
  const decoded = decodeCachedSnapshot(encodeCachedSnapshot(syntheticSnapshot));
  expect(decoded.connection).toMatchObject({
    phase: 'stale',
    mutationsAllowed: false,
    label: 'Cached projection — read only',
  });
  expect(decoded.timelines).toEqual(syntheticSnapshot.timelines);
});

test('a follow-up revision fence survives cache admission losslessly', () => {
  const fenced = {
    ...syntheticSnapshot,
    sessions: syntheticSnapshot.sessions.map((session, index) =>
      index === 0
        ? {
            ...session,
            followUpAllowed: false,
            followUpFenceRevision: session.target.revision,
          }
        : session,
    ),
  };

  const decoded = decodeCachedSnapshot(encodeCachedSnapshot(fenced));

  expect(decoded.sessions[0]?.followUpFenceRevision).toBe('12');
  expect(decoded.sessions[0]?.followUpAllowed).toBe(false);
});

test('runtime admission rejects oversized, malformed, and unbounded revisions', () => {
  expect(() =>
    decodeCachedSnapshot('x'.repeat(MAX_CACHED_SNAPSHOT_BYTES + 1)),
  ).toThrow('mobile_snapshot_cache_too_large');
  expect(() => decodeCachedSnapshot('{')).toThrow(
    'mobile_snapshot_cache_invalid',
  );

  const corrupt = JSON.parse(JSON.stringify(syntheticSnapshot));
  corrupt.sessions[0].target.revision = '99999999999999999999';
  expect(() => decodeCachedSnapshot(JSON.stringify(corrupt))).toThrow(
    'decimal_revision_invalid',
  );
});

test('cache admission rejects a hidden timeline gap even when the final cursor matches', () => {
  const corrupt = JSON.parse(JSON.stringify(syntheticSnapshot));
  corrupt.timelines['session-synthetic-001'] = [
    corrupt.timelines['session-synthetic-001'][0],
    corrupt.timelines['session-synthetic-001'][2],
  ];

  expect(() => decodeCachedSnapshot(JSON.stringify(corrupt))).toThrow(
    'mobile_snapshot_cache_invalid',
  );
});

test('cache admission rejects unknown top-level and event fields', () => {
  const topLevel = {
    ...syntheticSnapshot,
    credential: 'must-not-survive',
  };
  expect(() => decodeCachedSnapshot(JSON.stringify(topLevel))).toThrow(
    'mobile_snapshot_cache_invalid',
  );

  const eventExtra = JSON.parse(JSON.stringify(syntheticSnapshot));
  eventExtra.timelines['session-synthetic-001'][0].rawOutput = 'private';
  expect(() => decodeCachedSnapshot(JSON.stringify(eventExtra))).toThrow(
    'mobile_snapshot_cache_invalid',
  );
});

test('cache admission rejects duplicate routed session and approval ids', () => {
  const duplicateSession = {
    ...syntheticSnapshot,
    sessions: [
      ...syntheticSnapshot.sessions,
      {
        ...syntheticSnapshot.sessions[0]!,
        target: {
          ...syntheticSnapshot.sessions[0]!.target,
          revision: '13',
        },
      },
    ],
  };
  expect(() => decodeCachedSnapshot(JSON.stringify(duplicateSession))).toThrow(
    'mobile_snapshot_cache_invalid',
  );

  const duplicateApproval = {
    ...syntheticSnapshot,
    approvals: [
      ...syntheticSnapshot.approvals,
      { ...syntheticSnapshot.approvals[0]!, title: 'Duplicate' },
    ],
  };
  expect(() => decodeCachedSnapshot(JSON.stringify(duplicateApproval))).toThrow(
    'mobile_snapshot_cache_invalid',
  );
});

test('cache bounding deterministically retains only the newest event ceiling', () => {
  const event = syntheticSnapshot.timelines['session-synthetic-001']![0]!;
  const events = Array.from({ length: MAX_CACHED_EVENTS + 10 }, (_, index) => ({
    ...event,
    id: `event-${index}`,
    cursor: String(index + 1),
    sequence: String(index + 1) as typeof event.sequence,
  }));
  const bounded = boundMobileSnapshot({
    ...syntheticSnapshot,
    sessions: syntheticSnapshot.sessions.map((session, index) =>
      index === 0 ? { ...session, lastCursor: String(events.length) } : session,
    ),
    timelines: { 'session-synthetic-001': events },
  });

  expect(bounded.timelines['session-synthetic-001']).toHaveLength(
    MAX_CACHED_EVENTS,
  );
  expect(bounded.timelines['session-synthetic-001']?.[0]?.id).toBe('event-10');
});

test('cache bounding retains the acknowledged anchor before local previews', () => {
  const anchor = syntheticSnapshot.timelines['session-synthetic-001']![0]!;
  const local = Array.from({ length: MAX_CACHED_EVENTS }, (_, index) => ({
    ...anchor,
    id: `local-${index + 2}`,
    cursor: `local:${index + 2}`,
    sequence: String(index + 2) as typeof anchor.sequence,
    provenance: 'synthetic' as const,
  }));
  const snapshot = {
    ...syntheticSnapshot,
    sessions: syntheticSnapshot.sessions.map((session, index) =>
      index === 0 ? { ...session, lastCursor: '1' } : session,
    ),
    timelines: {
      ...syntheticSnapshot.timelines,
      'session-synthetic-001': [anchor, ...local],
    },
  };

  const decoded = decodeCachedSnapshot(encodeCachedSnapshot(snapshot));
  const retained = decoded.timelines['session-synthetic-001']!;
  expect(retained).toHaveLength(MAX_CACHED_EVENTS);
  expect(retained[0]?.cursor).toBe('1');
  expect(retained.at(-1)?.cursor).toBe(`local:${MAX_CACHED_EVENTS}`);
});
