// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { syntheticSnapshot } from '@/core/fixtures';
import { createMockGateway } from '@/core/mock-gateway';
import { createPendingMutationStore } from '@/core/reconciliation';
import {
  decimalRevision,
  type MobileAutomoniqueGateway,
  type Receipt,
} from '@/core/types';

import { MobileProvider, useMobile } from './mobile-provider';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'provider-key' }));

function Probe() {
  const {
    snapshot,
    projectionReady,
    decideApproval,
    sendFollowUp,
    refreshProjection,
    setConnectionPhase,
    stopRun,
  } = useMobile();
  const session = snapshot.sessions[0];
  const events =
    session === undefined
      ? []
      : (snapshot.timelines[session.target.coordinate.id] ?? []);
  const approval = snapshot.approvals[0];
  return (
    <>
      <Text>{`${snapshot.connection.phase}:${snapshot.connection.mutationsAllowed}`}</Text>
      <Text>{snapshot.connection.label}</Text>
      <Text>{`projection-ready:${projectionReady}`}</Text>
      <Text>{`events:${events.length}`}</Text>
      <Text>{`receipts:${snapshot.receipts.length}`}</Text>
      <Text>{`approvals:${snapshot.approvals.length}`}</Text>
      <Text>{`run:${session?.run?.coordinate.id ?? 'none'}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Test refresh"
        onPress={() => void refreshProjection()}
      >
        <Text>Refresh</Text>
      </Pressable>
      {session && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test follow-up"
          onPress={() =>
            void sendFollowUp(session, 'Continue safely').catch(() => undefined)
          }
        >
          <Text>Follow up</Text>
        </Pressable>
      )}
      {approval && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test approval"
          onPress={() => void decideApproval(approval, 'grant')}
        >
          <Text>Approve</Text>
        </Pressable>
      )}
      {session && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test stop"
          onPress={() => void stopRun(session)}
        >
          <Text>Stop</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Test pause"
        onPress={() => setConnectionPhase('stale')}
      >
        <Text>Pause</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Test resume"
        onPress={() => setConnectionPhase('live')}
      >
        <Text>Resume</Text>
      </Pressable>
    </>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('startup is read only until bootstrap traverses attachment', async () => {
  const base = createMockGateway();
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async bootstrap(signal) {
      await bootstrapGate;
      return base.bootstrap(signal);
    },
  };
  const attach = jest.spyOn(gateway, 'attach');
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );

  expect(view.getByText('stale:false')).toBeTruthy();
  expect(view.getByText('projection-ready:false')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Test resume'));
  expect(view.getByText('stale:false')).toBeTruthy();
  releaseBootstrap();
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  expect(view.getByText('projection-ready:true')).toBeTruthy();
  expect(view.getByText('events:3')).toBeTruthy();
  expect(attach).toHaveBeenCalledTimes(2);

  await fireEvent.press(view.getByLabelText('Test pause'));
  await waitFor(() => expect(view.getByText('stale:false')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Test resume'));
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
});

test('reconnect replaces an expired cursor with a fresh bounded snapshot', async () => {
  const base = createMockGateway();
  let expireResume = false;
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async attach(session, cursor, signal) {
      if (expireResume && cursor !== null) {
        const error = Object.assign(new Error('cursor_expired'), {
          outcome: 'resync_required' as const,
        });
        throw error;
      }
      return base.attach(session, cursor, signal);
    },
  };
  const attach = jest.spyOn(gateway, 'attach');
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  expireResume = true;

  await fireEvent.press(view.getByLabelText('Test refresh'));

  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  expect(view.getByText('events:3')).toBeTruthy();
  expect(attach.mock.calls.some((call) => call[1] !== null)).toBe(true);
  expect(attach.mock.calls.some((call) => call[1] === null)).toBe(true);
});

test('a rejected receipt is visible but never invents a completed event', async () => {
  const base = createMockGateway();
  const rejected: Receipt = {
    id: null,
    idempotencyKey: 'provider-key',
    action: 'follow_up',
    target: {
      authority: 'automonique',
      kind: 'session',
      id: 'session-synthetic-001',
    },
    revision: '12' as Receipt['revision'],
    outcome: 'rejected',
    explanation: 'policy denied',
  };
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    followUp: jest.fn().mockResolvedValue(rejected),
  };
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Test follow-up'));

  await waitFor(() => expect(view.getByText('receipts:1')).toBeTruthy());
  expect(view.getByText('events:3')).toBeTruthy();
  expect(gateway.followUp).toHaveBeenCalledTimes(1);
});

test.each(['accepted', 'unknown'] as const)(
  'a %s follow-up outcome fences the exact revision',
  async (outcome) => {
    const base = createMockGateway();
    const receipt: Receipt = {
      id: null,
      idempotencyKey: 'provider-key',
      action: 'follow_up',
      target: syntheticSnapshot.sessions[0]!.target.coordinate,
      revision: syntheticSnapshot.sessions[0]!.target.revision,
      outcome,
      explanation: 'delivery pending',
    };
    const gateway: MobileAutomoniqueGateway = {
      ...base,
      followUp: jest.fn().mockResolvedValue(receipt),
      reconcile: jest.fn().mockResolvedValue(receipt),
    };
    const view = await render(
      <MobileProvider gateway={gateway}>
        <Probe />
      </MobileProvider>,
    );
    await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());

    await fireEvent.press(view.getByLabelText('Test follow-up'));

    await waitFor(() => expect(view.getByText('stale:false')).toBeTruthy());
    expect(view.getByText('events:3')).toBeTruthy();
    expect(gateway.followUp).toHaveBeenCalledTimes(1);
    expect(gateway.reconcile).toHaveBeenCalledTimes(1);
  },
);

test('a completed receipt advances the exact session projection once', async () => {
  const gateway = createMockGateway();
  const followUp = jest.spyOn(gateway, 'followUp');
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Test follow-up'));

  await waitFor(() => expect(view.getByText('events:4')).toBeTruthy());
  expect(view.getByText('receipts:1')).toBeTruthy();
  expect(view.getByText('stale:false')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('Test follow-up'));

  expect(followUp).toHaveBeenCalledTimes(1);
});

test('follow-up preview never becomes a resume cursor across restart', async () => {
  const first = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(first.getByText('live:true')).toBeTruthy());
  await fireEvent.press(first.getByLabelText('Test follow-up'));
  await waitFor(() => expect(first.getByText('events:4')).toBeTruthy());
  await waitFor(async () => {
    const encoded = await AsyncStorage.getItem(
      'automonique.mobile.snapshot.v1',
    );
    const cached = JSON.parse(encoded!) as {
      receipts: unknown[];
      sessions: { lastCursor: string }[];
      timelines: Record<string, { cursor: string }[]>;
    };
    expect(cached.receipts).toHaveLength(1);
    expect(cached.sessions[0]?.lastCursor).toBe('3');
    expect(cached.timelines['session-synthetic-001']?.at(-1)?.cursor).toBe(
      'local:receipt-provider-key',
    );
  });
  await first.unmount();

  const restarted = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(restarted.getByText('stale:false')).toBeTruthy());
  expect(restarted.getByText('events:3')).toBeTruthy();
  expect(restarted.getByText('receipts:1')).toBeTruthy();
});

test('refresh only lifts a follow-up fence after session revision advances', async () => {
  const base = createMockGateway();
  let revision = decimalRevision('12');
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async bootstrap(signal) {
      const current = await base.bootstrap(signal);
      return {
        ...current,
        sessions: current.sessions.map((session, index) =>
          index === 0
            ? { ...session, target: { ...session.target, revision } }
            : session,
        ),
      };
    },
    async attach(session, cursor, signal) {
      if (
        session.coordinate.id !== 'session-synthetic-001' ||
        session.revision === '12'
      )
        return base.attach(session, cursor, signal);
      return {
        session,
        cursor: null,
        sequence: null,
        async *events() {},
      };
    },
  };
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Test follow-up'));
  await waitFor(() => expect(view.getByText('stale:false')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Test refresh'));
  await waitFor(() => expect(view.getByText('stale:false')).toBeTruthy());

  revision = decimalRevision('13');
  await fireEvent.press(view.getByLabelText('Test refresh'));
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
});

test('a completed approval receipt removes only the exact approval', async () => {
  const view = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Test approval'));

  await waitFor(() => expect(view.getByText('approvals:0')).toBeTruthy());
  expect(view.getByText('receipts:1')).toBeTruthy();
  expect(view.getByText('run:run-synthetic-001')).toBeTruthy();
});

test('a completed stop receipt clears the exact run association', async () => {
  const view = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Test stop'));

  await waitFor(() => expect(view.getByText('run:none')).toBeTruthy());
  expect(view.getByText('receipts:1')).toBeTruthy();
  expect(view.getByText('approvals:1')).toBeTruthy();
});

test('recovered old receipts cannot mutate newer same-coordinate projections', async () => {
  const ownerSession = syntheticSnapshot.sessions[0]!.target;
  const oldRun = syntheticSnapshot.sessions[0]!.run!;
  const oldApproval = syntheticSnapshot.approvals[0]!.target;
  const store = createPendingMutationStore();
  await store.put({
    action: 'stop_run',
    idempotencyKey: 'old-stop',
    session: ownerSession,
    target: oldRun,
  });
  await store.put({
    action: 'decide_approval',
    idempotencyKey: 'old-approval',
    session: ownerSession,
    target: oldApproval,
  });
  const base = createMockGateway();
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async bootstrap(signal) {
      const current = await base.bootstrap(signal);
      return {
        ...current,
        sessions: current.sessions.map((session, index) =>
          index === 0
            ? {
                ...session,
                run: { ...oldRun, revision: decimalRevision('8') },
              }
            : session,
        ),
        approvals: current.approvals.map((approval) => ({
          ...approval,
          target: { ...oldApproval, revision: decimalRevision('4') },
        })),
      };
    },
    async reconcile(request) {
      const approval = request.idempotencyKey === 'old-approval';
      return {
        id: `receipt-${request.idempotencyKey}`,
        idempotencyKey: request.idempotencyKey,
        action: approval ? 'decide_approval' : 'stop_run',
        target: approval ? oldApproval.coordinate : oldRun.coordinate,
        revision: approval ? oldApproval.revision : oldRun.revision,
        outcome: 'completed',
        explanation: null,
      };
    },
  };
  const view = await render(
    <MobileProvider gateway={gateway}>
      <Probe />
    </MobileProvider>,
  );

  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  expect(view.getByText('run:run-synthetic-001')).toBeTruthy();
  expect(view.getByText('approvals:1')).toBeTruthy();
  expect(view.getByText('receipts:2')).toBeTruthy();
});

test('corrupt cached state is removed without suppressing fresh bootstrap', async () => {
  await AsyncStorage.setItem('automonique.mobile.snapshot.v1', '{');
  const view = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );

  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    'automonique.mobile.snapshot.v1',
  );
});

test('cache persistence failure forces the live projection read only', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('disk_full'));
  const view = await render(
    <MobileProvider gateway={createMockGateway()}>
      <Probe />
    </MobileProvider>,
  );

  await waitFor(() => expect(view.getByText('stale:false')).toBeTruthy());
  expect(AsyncStorage.removeItem).toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('Test resume'));
  expect(view.queryByText('live:true')).toBeNull();
});

test('replacing a gateway aborts the previous generation bootstrap', async () => {
  const base = createMockGateway();
  let capturedSignal: AbortSignal | undefined;
  const firstGateway: MobileAutomoniqueGateway = {
    ...base,
    async bootstrap(signal) {
      capturedSignal = signal;
      await new Promise<void>(() => undefined);
      return base.bootstrap(signal);
    },
  };
  const view = await render(
    <MobileProvider gateway={firstGateway} storageScope="scope-one">
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(capturedSignal).toBeDefined());
  await view.rerender(
    <MobileProvider gateway={base} storageScope="scope-two">
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
});

test('unmount aborts an already-started mutation from the replaced generation', async () => {
  const base = createMockGateway();
  let capturedSignal: AbortSignal | undefined;
  const gateway: MobileAutomoniqueGateway = {
    ...base,
    async followUp(_command, signal) {
      capturedSignal = signal;
      return await new Promise<Receipt>(() => undefined);
    },
  };
  const view = await render(
    <MobileProvider gateway={gateway} storageScope="mutation-generation">
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(view.getByText('live:true')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Test follow-up'));
  await waitFor(() => expect(capturedSignal).toBeDefined());

  await view.unmount();

  expect(capturedSignal?.aborted).toBe(true);
});

test('a changed authorization storage scope cannot load the prior projection', async () => {
  const first = await render(
    <MobileProvider
      gateway={createMockGateway()}
      storageScope="auth-revision-1"
    >
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() => expect(first.getByText('events:3')).toBeTruthy());
  await waitFor(async () =>
    expect(
      await AsyncStorage.getItem(
        'automonique.mobile.snapshot.v1.auth-revision-1',
      ),
    ).not.toBeNull(),
  );
  await first.unmount();

  const blocked = createMockGateway();
  blocked.bootstrap = jest.fn(async () => {
    throw new Error('offline');
  });
  const second = await render(
    <MobileProvider gateway={blocked} storageScope="auth-revision-2">
      <Probe />
    </MobileProvider>,
  );
  await waitFor(() =>
    expect(second.getByText('projection-ready:true')).toBeTruthy(),
  );
  expect(second.getByText('events:0')).toBeTruthy();
  expect(second.getByText('receipts:0')).toBeTruthy();
});
