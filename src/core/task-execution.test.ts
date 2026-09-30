// SPDX-License-Identifier: Elastic-2.0
import { createTaskExecution, type TaskStorage } from './task-execution';
import type { MobileTaskGateway } from './types';

function setup() {
  const records = new Map<string, string>();
  const storage: TaskStorage = {
    getItem: jest.fn(async (key) => records.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      records.set(key, value);
    }),
  };
  const request = jest.fn<
    ReturnType<MobileTaskGateway['request']>,
    Parameters<MobileTaskGateway['request']>
  >();
  const gateway = { request };
  const create = (scope = 'server:device:a1') =>
    createTaskExecution(scope, storage, gateway, () => 'task-1');
  return { records, storage, request, create };
}
test('lost reply survives restart, never stores instructions, and reconciles without replay', async () => {
  const { records, request, create } = setup();
  request.mockResolvedValueOnce({
    state: 'ready',
    nodeId: 'daemon-1',
    revision: '9007199254740995',
  });
  request.mockImplementationOnce(async () => {
    expect([...records.values()][0]).toContain('pending');
    throw new Error('lost_response');
  });
  expect((await create().submit('private task text', 4096)).state).toBe(
    'pending',
  );
  expect([...records.values()][0]).not.toContain('private task text');
  expect(request.mock.calls[1]?.[0]).toMatchObject({
    action: 'submit',
    expected_revision: '9007199254740995',
  });
  await expect(create().submit('duplicate', 4096)).rejects.toThrow(
    'task_receipt_pending',
  );
  request.mockResolvedValueOnce({
    state: 'receipt',
    outcome: 'completed',
    explanation: null,
    sessionId: 'session-new',
  });
  expect(await create().reconcile()).toMatchObject({
    state: 'started',
    sessionId: 'session-new',
  });
  expect(request.mock.calls.map(([value]) => value.action)).toEqual([
    'prepare',
    'submit',
    'reconcile',
  ]);
  expect(await create('server:other-device:a1').read()).toBeNull();
});
test('unavailable storage prevents submission and malformed recovery never unlocks writing', async () => {
  const { records, storage, request, create } = setup();
  request.mockResolvedValue({
    state: 'ready',
    nodeId: 'daemon-1',
    revision: '1',
  });
  jest.mocked(storage.setItem).mockRejectedValue(new Error('disk_full'));
  await expect(create().submit('work', 4096)).rejects.toThrow('disk_full');
  expect(request.mock.calls.map(([value]) => value.action)).toEqual([
    'prepare',
  ]);
  records.set('automonique.mobile.task.v1.server:device:a1', '{}');
  await expect(create().submit('work', 4096)).rejects.toThrow(
    'task_record_invalid',
  );
  expect(request).toHaveBeenCalledTimes(1);
});
test('unknown receipts and lookup refusals stay pending; confirmed rejection permits a new task', async () => {
  const { request, create } = setup();
  request.mockResolvedValueOnce({
    state: 'ready',
    nodeId: 'daemon-1',
    revision: '1',
  });
  request.mockResolvedValueOnce({ state: 'ambiguous' });
  await create().submit('work', 4096);
  request.mockResolvedValueOnce({
    state: 'refused',
    outcome: 'rejected',
    explanation: 'receipt not found',
  });
  expect((await create().reconcile())?.state).toBe('pending');
  request.mockResolvedValueOnce({
    state: 'receipt',
    outcome: 'rejected',
    explanation: null,
    sessionId: null,
  });
  expect((await create().reconcile())?.state).toBe('failed');
});
test('simultaneous screens cannot submit two tasks for one device', async () => {
  const { request, create } = setup();
  let release!: () => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ state: 'ready', nodeId: 'daemon-1', revision: '1' });
      }),
  );
  request.mockResolvedValueOnce({ state: 'ambiguous' });
  const first = create().submit('work', 4096);
  await Promise.resolve();
  await Promise.resolve();
  await expect(create().submit('other', 4096)).rejects.toThrow(
    'task_operation_in_progress',
  );
  release();
  await first;
});
