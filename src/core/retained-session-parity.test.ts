// SPDX-License-Identifier: Elastic-2.0

import { MobileSessionClient, PlatformClient } from '@automonique/sdk';
import {
  createDeterministicSdkFixture,
  DeterministicPlatformAdapter,
} from '@automonique/sdk/testing';

import {
  executeWithReconciliation,
  type PendingMutationHandle,
  type PendingMutationStore,
} from './reconciliation';
import { createSdkMobileGateway } from './sdk-gateway';
import { decimalRevision } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

function memoryStore(): PendingMutationStore & {
  readonly values: Map<string, PendingMutationHandle>;
} {
  const values = new Map<string, PendingMutationHandle>();
  return {
    values,
    async list() {
      return [...values.values()];
    },
    async put(handle) {
      values.set(handle.idempotencyKey, handle);
    },
    async remove(idempotencyKey) {
      values.delete(idempotencyKey);
    },
  };
}

test('the shared SDK fixture retains independent projection, history, and mutation cursors', () => {
  const fixture = createDeterministicSdkFixture();

  expect(fixture.projection.snapshot.cursor.sequence.toString()).toBe('10');
  expect(fixture.projection.gap.cursor.sequence.toString()).toBe('12');
  expect(fixture.history.unknownEvent.from_cursor.toString()).toBe('20');
  expect(fixture.history.unknownEvent.terminal_cursor.toString()).toBe('21');
  expect(fixture.history.unknownEvent.events).toMatchObject([
    { kind: 'unknown', source: 'adapter_event' },
  ]);
  expect(fixture.mutation.followUp.expectedSessionRevision.toString()).toBe(
    '10',
  );
});

test('an ambiguous shared-fixture follow-up reconciles once without replay or generic authority', async () => {
  const fixture = createDeterministicSdkFixture();
  const adapter = new DeterministicPlatformAdapter(
    fixture.mutation.ambiguousThenReconciled,
  );
  const gateway = createSdkMobileGateway({
    authorization: fixture.authorization,
    client: new PlatformClient(adapter),
    sessionClient: new MobileSessionClient(
      adapter,
      fixture.authorization,
      fixture.serverIdentity,
      () => fixture.now,
    ),
    expectedServerIdentity: fixture.serverIdentity,
    now: fixture.now,
  });
  const session = {
    coordinate: fixture.coordinates.session,
    revision: decimalRevision(
      fixture.mutation.followUp.expectedSessionRevision.toString(),
    ),
  };
  const handle: PendingMutationHandle = {
    action: 'follow_up',
    idempotencyKey: fixture.mutation.followUp.idempotencyKey,
    session,
    target: session,
  };
  const store = memoryStore();
  const operation = jest.fn(() =>
    gateway.followUp({
      session,
      text: fixture.mutation.followUp.text,
      idempotencyKey: fixture.mutation.followUp.idempotencyKey,
    }),
  );

  await expect(
    executeWithReconciliation(gateway, store, handle, operation),
  ).resolves.toMatchObject({
    action: 'follow_up',
    idempotencyKey: fixture.mutation.followUp.idempotencyKey,
    outcome: 'completed',
    target: fixture.coordinates.session,
  });

  expect(operation).toHaveBeenCalledTimes(1);
  expect(adapter.pendingSteps).toBe(0);
  expect(adapter.requests.map((request) => request.method)).toEqual([
    'session_follow_up',
    'get_receipt',
  ]);
  expect(adapter.requests[0]).toMatchObject({
    method: 'session_follow_up',
    request: {
      session: fixture.mutation.followUp.session,
      expected_session_revision:
        fixture.mutation.followUp.expectedSessionRevision,
      idempotency_key: fixture.mutation.followUp.idempotencyKey,
      text: fixture.mutation.followUp.text,
    },
  });
  expect(adapter.requests[1]).toMatchObject({
    method: 'get_receipt',
    request: {
      idempotency_key: fixture.mutation.receiptLookup.idempotencyKey,
    },
  });
  expect(store.values.size).toBe(0);
  expect(Object.keys(gateway).sort()).toEqual(
    [
      'attach',
      'bootstrap',
      'decideApproval',
      'followUp',
      'reconcile',
      'stopRun',
    ].sort(),
  );
  expect(
    adapter.requests.some(
      (request) =>
        request.method === 'execute' || request.method === 'snapshot',
    ),
  ).toBe(false);
});
