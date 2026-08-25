// SPDX-License-Identifier: Elastic-2.0

import {
  acknowledgedTimelinePrefix,
  reduceSessionPage,
  type TimelineProjection,
} from './projection';
import type {
  MobileAutomoniqueGateway,
  MobileSnapshot,
  SessionEvent,
} from './types';

const MAX_MOBILE_SESSIONS = 100;
const MAX_PAGES_PER_ATTACHMENT = 8;

/**
 * Load the initial operator slice through the same gateway and cursor reducer
 * used by a live SDK adapter. Synthetic fixtures do not bypass this path.
 */
export async function bootstrapVerticalSlice(
  gateway: MobileAutomoniqueGateway,
  previous?: MobileSnapshot,
  signal?: AbortSignal,
): Promise<MobileSnapshot> {
  const snapshot = await gateway.bootstrap(signal);
  if (snapshot.sessions.length > MAX_MOBILE_SESSIONS) {
    throw new Error('mobile_session_limit_exceeded');
  }
  const sessionIds = new Set<string>();
  for (const session of snapshot.sessions) {
    if (
      session.target.coordinate.kind !== 'session' ||
      sessionIds.has(session.target.coordinate.id) ||
      (session.run !== null && session.run.coordinate.kind !== 'run')
    ) {
      throw new Error('mobile_session_identity_invalid');
    }
    sessionIds.add(session.target.coordinate.id);
  }
  const approvalIds = new Set<string>();
  for (const approval of snapshot.approvals) {
    if (
      approval.target.coordinate.kind !== 'approval' ||
      approvalIds.has(approval.target.coordinate.id)
    ) {
      throw new Error('mobile_approval_identity_invalid');
    }
    approvalIds.add(approval.target.coordinate.id);
  }

  const timelines: Record<string, readonly SessionEvent[]> = {};
  const cursors = new Map<string, string>();
  let resyncRequired = false;

  if (snapshot.connection.allowedActions.includes('attach')) {
    for (const session of snapshot.sessions) {
      if (!session.attachable) continue;
      const previousSession = previous?.sessions.find(
        (candidate) =>
          JSON.stringify(candidate.target) === JSON.stringify(session.target),
      );
      const previousEvents =
        previousSession === undefined
          ? []
          : (previous?.timelines[session.target.coordinate.id] ?? []);
      const resumeCursor = previousSession?.lastCursor ?? null;
      const attachment = await gateway.attach(
        session.target,
        resumeCursor,
        signal,
      );
      const acknowledgedEvents = acknowledgedTimelinePrefix(
        previousEvents,
        attachment.cursor,
        attachment.sequence,
      );
      let projection: TimelineProjection = {
        cursor: attachment.cursor,
        sequence: attachment.sequence,
        events: acknowledgedEvents ?? previousEvents,
        resyncRequired: acknowledgedEvents === null,
      };
      let pages = 0;
      for await (const page of attachment.events(signal)) {
        pages += 1;
        if (
          pages > MAX_PAGES_PER_ATTACHMENT ||
          page.sessionId !== session.target.coordinate.id ||
          page.events.length > snapshot.connection.limits.maxPageEvents
        ) {
          projection = { ...projection, resyncRequired: true };
          break;
        }
        projection = reduceSessionPage(projection, page);
        if (projection.resyncRequired) break;
      }
      timelines[session.target.coordinate.id] = projection.events;
      if (projection.cursor !== null) {
        cursors.set(session.target.coordinate.id, projection.cursor);
      }
      resyncRequired ||= projection.resyncRequired;
    }
  }

  return {
    ...snapshot,
    connection: resyncRequired
      ? {
          ...snapshot.connection,
          phase: 'stale',
          label: 'Cursor resynchronization required',
          mutationsAllowed: false,
        }
      : snapshot.connection,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      lastCursor:
        cursors.get(session.target.coordinate.id) ?? session.lastCursor,
    })),
    timelines,
  };
}
