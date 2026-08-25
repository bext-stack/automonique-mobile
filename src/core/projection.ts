// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision, type SessionEvent, type SessionPage } from './types';

export interface TimelineProjection {
  readonly cursor: string | null;
  readonly sequence: ReturnType<typeof decimalRevision> | null;
  readonly events: readonly SessionEvent[];
  readonly resyncRequired: boolean;
}

export const emptyTimelineProjection: TimelineProjection = {
  cursor: null,
  sequence: null,
  events: [],
  resyncRequired: false,
};

export function acknowledgedTimelinePrefix(
  events: readonly SessionEvent[],
  cursor: string | null,
  sequence: ReturnType<typeof decimalRevision> | null,
): readonly SessionEvent[] | null {
  if (events.length === 0) return [];
  if (cursor === null || sequence === null) return null;
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let previous: bigint | null = null;
  for (const event of events) {
    const current = BigInt(event.sequence);
    if (
      ids.has(event.id) ||
      cursors.has(event.cursor) ||
      (previous !== null && current !== previous + 1n)
    ) {
      return null;
    }
    ids.add(event.id);
    cursors.add(event.cursor);
    previous = current;
  }
  const acknowledgedIndex = events.findIndex(
    (event) => event.cursor === cursor && event.sequence === sequence,
  );
  if (
    acknowledgedIndex < 0 ||
    events
      .slice(acknowledgedIndex + 1)
      .some((event) => !event.cursor.startsWith('local:'))
  ) {
    return null;
  }
  return events.slice(0, acknowledgedIndex + 1);
}

export function timelineMatchesResume(
  events: readonly SessionEvent[],
  cursor: string | null,
  sequence: ReturnType<typeof decimalRevision> | null,
): boolean {
  return acknowledgedTimelinePrefix(events, cursor, sequence) !== null;
}

function sameEvent(left: SessionEvent, right: SessionEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reduceSessionPage(
  state: TimelineProjection,
  page: SessionPage,
): TimelineProjection {
  if (state.resyncRequired || page.afterCursor !== state.cursor) {
    return { ...state, resyncRequired: true };
  }

  const events = [...state.events];
  let sequence = BigInt(state.sequence ?? '0');
  let admittedNewEvent = false;

  for (const event of page.events) {
    const eventSequence = BigInt(event.sequence);
    if (eventSequence <= sequence) {
      const existing = events.find((candidate) => candidate.id === event.id);
      if (!admittedNewEvent && existing && sameEvent(existing, event)) continue;
      return { ...state, resyncRequired: true };
    }
    if (eventSequence !== sequence + 1n) {
      return { ...state, resyncRequired: true };
    }
    events.push(event);
    sequence = eventSequence;
    admittedNewEvent = true;
  }

  const expectedCursor = admittedNewEvent
    ? page.events.at(-1)?.cursor
    : state.cursor;
  if (page.cursor !== expectedCursor) {
    return { ...state, resyncRequired: true };
  }

  return {
    cursor: page.cursor,
    sequence: events.at(-1)?.sequence ?? state.sequence,
    events,
    resyncRequired: false,
  };
}

export function replaceWithSnapshot(
  events: readonly SessionEvent[],
): TimelineProjection {
  const sorted = [...events].sort((left, right) => {
    const comparison = BigInt(left.sequence) - BigInt(right.sequence);
    return comparison < 0n ? -1 : comparison > 0n ? 1 : 0;
  });
  return {
    cursor: sorted.at(-1)?.cursor ?? null,
    sequence: sorted.at(-1)?.sequence ?? null,
    events: sorted,
    resyncRequired: false,
  };
}

export function nextSequence(
  events: readonly SessionEvent[],
): ReturnType<typeof decimalRevision> {
  return decimalRevision(String(BigInt(events.at(-1)?.sequence ?? '0') + 1n));
}
