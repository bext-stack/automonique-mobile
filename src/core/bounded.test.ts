// SPDX-License-Identifier: Elastic-2.0

import { mapBounded } from './bounded';

test('keeps input order and never exceeds the in-flight limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapBounded(
    Array.from({ length: 25 }, (_, index) => index),
    4,
    async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, (value % 3) + 1));
      inFlight -= 1;
      return value * 2;
    },
  );
  expect(results).toEqual(Array.from({ length: 25 }, (_, index) => index * 2));
  expect(peak).toBe(4);
});

test('rejects on the first failure and starts nothing after it', async () => {
  const started: number[] = [];
  await expect(
    mapBounded([0, 1, 2, 3, 4, 5], 2, async (value) => {
      started.push(value);
      await Promise.resolve();
      if (value === 1) throw new Error('boom');
      return value;
    }),
  ).rejects.toThrow('boom');
  expect(started.length).toBeLessThan(6);
});

test('an empty input resolves without calling the task', async () => {
  const task = jest.fn();
  await expect(mapBounded([], 4, task)).resolves.toEqual([]);
  expect(task).not.toHaveBeenCalled();
});
