// SPDX-License-Identifier: Elastic-2.0
import { createWorkExecution } from './work-execution';
import { MobileLifecycleError, type MobileWorkRequest } from '@automonique/sdk';
function fixture() {
  const data = new Map<string, string>();
  const store = {
    getItem: jest.fn(async (key: string) => data.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  const request = jest.fn(
    async (_request: MobileWorkRequest) =>
      ({
        kind: 'receipt',
        jobId: 'job-a',
        status: 'pending_approval',
        duplicate: false,
      }) as const,
  );
  return { store, request, gateway: { request } };
}
const intent = {
  action: 'dispatch',
  issue_url: 'https://github.com/example/repo/issues/1',
} as const;
test('storage failure prevents any queue mutation', async () => {
  const f = fixture();
  f.store.setItem.mockRejectedValue(new Error('disk'));
  const execution = createWorkExecution(
    'fixture',
    f.store,
    f.gateway,
    () => 'key',
  );
  await expect(execution.submit(intent)).rejects.toThrow('disk');
  expect(f.request).not.toHaveBeenCalled();
});
test('lost response survives remount and retries only the same request key', async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error('network'));
  const first = createWorkExecution('fixture', f.store, f.gateway, () => 'key');
  await expect(first.submit(intent)).rejects.toThrow('network');
  const second = createWorkExecution(
    'fixture',
    f.store,
    f.gateway,
    () => 'another-key',
  );
  await expect(second.submit(intent)).rejects.toThrow('work_request_pending');
  await second.retry();
  expect(f.request.mock.calls.map(([request]) => request)).toEqual([
    { ...intent, idempotency_key: 'key' },
    { ...intent, idempotency_key: 'key' },
  ]);
  expect(await second.read()).toBeNull();
});
test('server and credential storage scopes remain isolated', async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error('network'));
  const first = createWorkExecution(
    'server-a:credential-a',
    f.store,
    f.gateway,
    () => 'key',
  );
  await expect(first.submit(intent)).rejects.toThrow('network');
  const foreign = createWorkExecution(
    'server-b:credential-b',
    f.store,
    f.gateway,
    () => 'foreign-key',
  );
  expect(await foreign.read()).toBeNull();
  await expect(foreign.retry()).rejects.toThrow('work_request_missing');
  expect(f.request).toHaveBeenCalledTimes(1);
});
test('an aborted generation never sends a mutation', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  const execution = createWorkExecution(
    'fixture',
    f.store,
    f.gateway,
    () => 'key',
  );
  await expect(execution.submit(intent, controller.signal)).rejects.toThrow(
    'work_request_aborted',
  );
  expect(f.request).not.toHaveBeenCalled();
});

test('a verified first-attempt refusal unlocks the queue without retrying', async () => {
  const f = fixture();
  const refusal = new MobileLifecycleError(409, 'mobile_work_not_applied');
  f.request.mockRejectedValueOnce(refusal);
  const execution = createWorkExecution(
    'fixture',
    f.store,
    f.gateway,
    () => 'key',
  );
  await expect(execution.submit(intent)).rejects.toBe(refusal);
  expect(await execution.read()).toBeNull();
  expect(f.request).toHaveBeenCalledTimes(1);
  await execution.submit(intent);
  expect(f.request).toHaveBeenCalledTimes(2);
});
test('a refusal during recovery cannot erase an earlier uncertain outcome', async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error('network'));
  const execution = createWorkExecution(
    'fixture',
    f.store,
    f.gateway,
    () => 'key',
  );
  await expect(execution.submit(intent)).rejects.toThrow('network');
  f.request.mockRejectedValueOnce(
    new MobileLifecycleError(409, 'mobile_work_not_applied'),
  );
  await expect(execution.retry()).rejects.toThrow('mobile_work_not_applied');
  expect(await execution.read()).toEqual({ ...intent, idempotency_key: 'key' });
  await expect(execution.submit(intent)).rejects.toThrow(
    'work_request_pending',
  );
});
test.each([
  new MobileLifecycleError(409, 'mobile_work_refused'),
  new MobileLifecycleError(503, 'mobile_work_outcome_unknown'),
  { status: 409, category: 'mobile_work_not_applied' },
])(
  'unknown or unverified refusals preserve the pending request',
  async (error) => {
    const f = fixture();
    f.request.mockRejectedValueOnce(error);
    const execution = createWorkExecution(
      'fixture',
      f.store,
      f.gateway,
      () => 'key',
    );
    await expect(execution.submit(intent)).rejects.toBe(error);
    expect(await execution.read()).toEqual({
      ...intent,
      idempotency_key: 'key',
    });
  },
);
