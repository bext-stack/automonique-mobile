// SPDX-License-Identifier: Elastic-2.0

/**
 * Server reads in flight at once while the phone rebuilds its view.
 *
 * The server answers a burst it cannot queue with an immediate `503`, so an
 * all-sessions credential that asked about every conversation at once lost
 * about half of its reads and took the whole reconnect down with them. Four
 * matches the server's own worker count: more buys no parallelism there.
 */
export const BOOTSTRAP_READ_CONCURRENCY = 4;

/** Conversations one phone projects at a time. */
export const MAX_MOBILE_SESSIONS = 100;

/**
 * Map in input order with at most `limit` tasks in flight. The first failure
 * rejects, and no further task is started after it.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
