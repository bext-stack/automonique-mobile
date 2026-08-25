// SPDX-License-Identifier: Elastic-2.0

import { syntheticSnapshot } from './fixtures';
import { createMockGateway } from './mock-gateway';
import {
  decimalRevision,
  type AttachmentHandle,
  type MobileAutomoniqueGateway,
} from './types';
import { bootstrapVerticalSlice } from './vertical-slice';

test('synthetic bootstrap traverses attach and the cursor reducer', async () => {
  const base = createMockGateway();
  const attach = jest.spyOn(base, 'attach');

  const snapshot = await bootstrapVerticalSlice(base);

  expect(attach).toHaveBeenCalledTimes(
    syntheticSnapshot.sessions.filter((session) => session.attachable).length,
  );
  expect(snapshot.timelines['session-synthetic-001']).toEqual(
    syntheticSnapshot.timelines['session-synthetic-001'],
  );
  expect(snapshot.sessions[0]?.lastCursor).toBe(
    syntheticSnapshot.sessions[0]?.lastCursor,
  );
  expect(snapshot.connection.phase).toBe('live');
});

test('an exact cached projection resumes strictly after its cursor', async () => {
  const gateway = createMockGateway();
  const attach = jest.spyOn(gateway, 'attach');

  const snapshot = await bootstrapVerticalSlice(gateway, syntheticSnapshot);

  expect(attach).toHaveBeenCalledWith(
    syntheticSnapshot.sessions[0]!.target,
    syntheticSnapshot.sessions[0]!.lastCursor,
    undefined,
  );
  expect(snapshot.timelines['session-synthetic-001']).toEqual(
    syntheticSnapshot.timelines['session-synthetic-001'],
  );
  expect(snapshot.connection.phase).toBe('live');
});

test('a cached timeline with a hidden gap cannot resume writable', async () => {
  const gateway = createMockGateway();
  const events = syntheticSnapshot.timelines['session-synthetic-001']!;
  const previous = {
    ...syntheticSnapshot,
    timelines: {
      ...syntheticSnapshot.timelines,
      'session-synthetic-001': [events[0]!, events[2]!],
    },
  };

  const snapshot = await bootstrapVerticalSlice(gateway, previous);

  expect(snapshot.connection).toMatchObject({
    phase: 'stale',
    mutationsAllowed: false,
  });
});

test('duplicate routed session identities are refused before attachment', async () => {
  const base = createMockGateway();
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async bootstrap() {
      return {
        ...syntheticSnapshot,
        sessions: [
          ...syntheticSnapshot.sessions,
          {
            ...syntheticSnapshot.sessions[0]!,
            target: {
              ...syntheticSnapshot.sessions[0]!.target,
              revision: decimalRevision('13'),
            },
          },
        ],
      };
    },
  };

  await expect(bootstrapVerticalSlice(gateway)).rejects.toThrow(
    'mobile_session_identity_invalid',
  );
});

test('a cursor gap makes the whole projection stale and read only', async () => {
  const base = createMockGateway();
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async attach(session) {
      return {
        session,
        cursor: null,
        sequence: null,
        async *events() {
          yield {
            sessionId: session.coordinate.id,
            afterCursor: null,
            cursor: '2',
            events: [
              {
                id: 'gap-2',
                cursor: '2',
                sequence: decimalRevision('2'),
                createdAt: '2026-08-25T00:00:00.000Z',
                provenance: 'authoritative',
                kind: 'unknown',
                eventType: 'resource_update:session',
              },
            ],
          };
        },
      };
    },
  };

  const snapshot = await bootstrapVerticalSlice(gateway);

  expect(snapshot.connection).toMatchObject({
    phase: 'stale',
    mutationsAllowed: false,
  });
  expect(snapshot.timelines['session-synthetic-001']).toEqual([]);
});

test.each([
  {
    name: 'wrong-session page',
    pages: async function* () {
      yield {
        sessionId: 'different-session',
        afterCursor: null,
        cursor: '1',
        events: [],
      };
    },
  },
  {
    name: 'oversized page',
    pages: async function* () {
      yield {
        sessionId: 'session-synthetic-001',
        afterCursor: null,
        cursor: '1',
        events: Array.from(
          { length: syntheticSnapshot.connection.limits.maxPageEvents + 1 },
          () => syntheticSnapshot.timelines['session-synthetic-001']![0]!,
        ),
      };
    },
  },
  {
    name: 'excessive page count',
    pages: async function* () {
      let afterCursor: string | null = null;
      for (let index = 1; index <= 9; index += 1) {
        const cursor = String(index);
        yield {
          sessionId: 'session-synthetic-001',
          afterCursor,
          cursor,
          events: [],
        };
        afterCursor = cursor;
      }
    },
  },
])('$name fails closed', async ({ pages }) => {
  const base = createMockGateway();
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async attach(session, cursor, signal): Promise<AttachmentHandle> {
      if (session.coordinate.id !== 'session-synthetic-001') {
        return base.attach(session, cursor, signal);
      }
      return {
        session,
        cursor: null,
        sequence: null,
        events: pages,
      };
    },
  };

  await expect(bootstrapVerticalSlice(gateway)).resolves.toMatchObject({
    connection: { phase: 'stale', mutationsAllowed: false },
  });
});
