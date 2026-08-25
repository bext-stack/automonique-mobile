// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import { syntheticSnapshot } from './fixtures';
import {
  createPendingMutationStore,
  executeWithReconciliation,
  recoverPendingReceipts,
  type PendingMutationHandle,
  type PendingMutationStore,
} from './reconciliation';
import type { MobileAutomoniqueGateway, Receipt } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

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

const target = syntheticSnapshot.sessions[0]!.target;
const handle: PendingMutationHandle = {
  action: 'follow_up',
  idempotencyKey: 'reconcile-key',
  session: target,
  target,
};
const completed: Receipt = {
  id: 'receipt-1',
  action: 'follow_up',
  idempotencyKey: handle.idempotencyKey,
  target: target.coordinate,
  revision: target.revision,
  outcome: 'completed',
  explanation: null,
};

function gateway(reconcile: MobileAutomoniqueGateway['reconcile']) {
  return {
    ...({} as MobileAutomoniqueGateway),
    reconcile,
  };
}

test('ambiguous transport failure reconciles by key without replay', async () => {
  const store = memoryStore();
  const operation = jest.fn().mockRejectedValue(new Error('transport_lost'));
  const reconcile = jest.fn().mockResolvedValue(completed);

  await expect(
    executeWithReconciliation(gateway(reconcile), store, handle, operation),
  ).resolves.toEqual(completed);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledWith(handle);
  expect(store.values.size).toBe(0);
});

test('unsettled or unavailable receipts keep a handle but never replay a command', async () => {
  const store = memoryStore();
  await store.put(handle);
  const reconcile = jest.fn().mockRejectedValue(new Error('receipt_unknown'));

  await expect(
    recoverPendingReceipts(gateway(reconcile), store),
  ).resolves.toEqual([]);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(store.values.size).toBe(1);
});

test('transport ambiguity that reconciles to unknown performs one lookup and stays pending', async () => {
  const store = memoryStore();
  const operation = jest.fn().mockRejectedValue(new Error('transport_lost'));
  const unknown = { ...completed, outcome: 'unknown' as const };
  const reconcile = jest.fn().mockResolvedValue(unknown);

  await expect(
    executeWithReconciliation(gateway(reconcile), store, handle, operation),
  ).resolves.toEqual(unknown);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(store.values.size).toBe(1);
});

test.each(['accepted', 'unknown'] as const)(
  '%s responses are reconciled once and remain pending if not settled',
  async (outcome) => {
    const store = memoryStore();
    const unsettled = { ...completed, outcome };
    const operation = jest.fn().mockResolvedValue(unsettled);
    const reconcile = jest.fn().mockResolvedValue(unsettled);

    await expect(
      executeWithReconciliation(gateway(reconcile), store, handle, operation),
    ).resolves.toEqual(unsettled);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(store.values.size).toBe(1);
  },
);

test('an accepted receipt that reconciles to unknown stays pending', async () => {
  const store = memoryStore();
  const accepted = { ...completed, outcome: 'accepted' as const };
  const unknown = { ...completed, outcome: 'unknown' as const };

  await expect(
    executeWithReconciliation(
      gateway(jest.fn().mockResolvedValue(unknown)),
      store,
      handle,
      async () => Promise.resolve(accepted),
    ),
  ).resolves.toEqual(unknown);
  expect(store.values.size).toBe(1);
});

test('restart recovery retains an unknown receipt handle for a later lookup', async () => {
  const store = memoryStore();
  await store.put(handle);
  const unknown = { ...completed, outcome: 'unknown' as const };

  await expect(
    recoverPendingReceipts(
      gateway(jest.fn().mockResolvedValue(unknown)),
      store,
    ),
  ).resolves.toEqual([{ handle, receipt: unknown }]);
  expect(store.values.size).toBe(1);
});

test('bounded reconciliation handles survive store reconstruction without command payloads', async () => {
  const first = createPendingMutationStore();
  await first.put(handle);

  const restored = await createPendingMutationStore().list();

  expect(restored).toEqual([handle]);
  expect(JSON.stringify(restored)).not.toContain('Continue safely');
  await createPendingMutationStore().remove(handle.idempotencyKey);
  await expect(createPendingMutationStore().list()).resolves.toEqual([]);
});

test('stored handles with command payload or unknown fields are refused', async () => {
  await AsyncStorage.setItem(
    'automonique.mobile.pending-reconciliation.v1',
    JSON.stringify([{ ...handle, text: 'must-not-survive' }]),
  );

  await expect(createPendingMutationStore().list()).resolves.toEqual([]);
  await expect(
    createPendingMutationStore().put({
      ...handle,
      target: { ...handle.target, raw: 'private' } as typeof handle.target,
    }),
  ).rejects.toThrow('pending_reconciliation_handle_invalid');
});

test('a receipt for a different target is rejected and the handle remains', async () => {
  const store = memoryStore();
  const mismatch = {
    ...completed,
    target: { ...completed.target, id: 'different-session' },
  };

  await expect(
    executeWithReconciliation(gateway(jest.fn()), store, handle, async () =>
      Promise.resolve(mismatch),
    ),
  ).rejects.toThrow('receipt_reconciliation_mismatch');
  expect(store.values.size).toBe(1);
});
