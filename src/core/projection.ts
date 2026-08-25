// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision, type SessionEvent, type SessionPage } from './types';

export interface TimelineProjection {
  readonly cursor: string | null;
  readonly events: readonly SessionEvent[];
  readonly resyncRequired: boolean;
}

export const emptyTimelineProjection: TimelineProjection = {
  cursor: null,
  events: [],
  resyncRequired: false,
};

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
  let sequence = BigInt(events.at(-1)?.sequence ?? '0');

  for (const event of page.events) {
    const eventSequence = BigInt(event.sequence);
    if (eventSequence <= sequence) {
      const existing = events.find((candidate) => candidate.id === event.id);
      if (existing && sameEvent(existing, event)) continue;
      return { ...state, resyncRequired: true };
    }
    if (eventSequence !== sequence + 1n) {
      return { ...state, resyncRequired: true };
    }
    events.push(event);
    sequence = eventSequence;
  }

  return { cursor: page.cursor, events, resyncRequired: false };
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
    events: sorted,
    resyncRequired: false,
  };
}

export function nextSequence(
  events: readonly SessionEvent[],
): ReturnType<typeof decimalRevision> {
  return decimalRevision(String(BigInt(events.at(-1)?.sequence ?? '0') + 1n));
}
