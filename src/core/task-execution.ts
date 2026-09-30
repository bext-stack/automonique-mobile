// SPDX-License-Identifier: Elastic-2.0

import { ResourceId, type MobileTaskView } from '@automonique/sdk';
import type { MobileTaskGateway } from './types';

export interface TaskHandle {
  readonly key: string;
  readonly nodeId: string;
  readonly state: 'pending' | 'started' | 'failed';
  readonly sessionId: string | null;
}
export interface TaskStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
const busy = new Set<string>();
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(value);

/** Only receipt coordinates survive a restart. Task text is never queued. */
export function createTaskExecution(
  scope: string,
  storage: TaskStorage,
  gateway: MobileTaskGateway,
  randomKey: () => string,
) {
  const storageKey = `automonique.mobile.task.v1.${scope}`;
  async function read(): Promise<TaskHandle | null> {
    const raw = await storage.getItem(storageKey);
    if (raw === null) return null;
    if (raw.length > 2048) throw new Error('task_record_invalid');
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object')
      throw new Error('task_record_invalid');
    const handle = value as TaskHandle;
    if (
      !validKey(handle.key) ||
      typeof handle.nodeId !== 'string' ||
      !['pending', 'started', 'failed'].includes(handle.state) ||
      (handle.state === 'started'
        ? typeof handle.sessionId !== 'string'
        : handle.sessionId !== null)
    ) {
      throw new Error('task_record_invalid');
    }
    ResourceId(handle.nodeId);
    if (handle.nodeId === 'node/current')
      throw new Error('task_record_invalid');
    if (handle.sessionId !== null) ResourceId(handle.sessionId);
    return {
      key: handle.key,
      nodeId: handle.nodeId,
      state: handle.state,
      sessionId: handle.sessionId,
    };
  }
  async function persist(handle: TaskHandle) {
    await storage.setItem(storageKey, JSON.stringify(handle));
    return handle;
  }
  async function observe(
    handle: TaskHandle,
    view: MobileTaskView,
    submitting: boolean,
  ) {
    if (
      view.state === 'receipt' &&
      view.outcome === 'completed' &&
      view.sessionId !== null
    ) {
      return persist({
        ...handle,
        state: 'started',
        sessionId: view.sessionId,
      });
    }
    if (
      (view.state === 'receipt' || (submitting && view.state === 'refused')) &&
      ['conflict', 'rejected', 'resync_required'].includes(view.outcome)
    ) {
      return persist({ ...handle, state: 'failed' });
    }
    return handle;
  }
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (busy.has(storageKey)) throw new Error('task_operation_in_progress');
    busy.add(storageKey);
    try {
      return await operation();
    } finally {
      busy.delete(storageKey);
    }
  }
  return {
    read,
    submit(text: string, maxBytes: number, signal?: AbortSignal) {
      return exclusive(async () => {
        if (
          !text.trim() ||
          new TextEncoder().encode(text).byteLength > maxBytes
        )
          throw new Error('task_text_invalid');
        if ((await read())?.state === 'pending')
          throw new Error('task_receipt_pending');
        const prepared = await gateway.request({ action: 'prepare' }, signal);
        if (prepared.state !== 'ready') throw new Error('task_unavailable');
        const key = randomKey();
        if (!validKey(key)) throw new Error('task_key_invalid');
        // If this durable write fails, no execution request can leave the device.
        const handle = await persist({
          key,
          nodeId: prepared.nodeId,
          state: 'pending',
          sessionId: null,
        });
        let view: MobileTaskView;
        try {
          if (signal?.aborted) return handle;
          view = await gateway.request(
            {
              action: 'submit',
              node_id: handle.nodeId,
              expected_revision: prepared.revision,
              idempotency_key: key,
              text,
            },
            signal,
          );
        } catch {
          return handle;
        }
        return observe(handle, view, true);
      });
    },
    reconcile(signal?: AbortSignal) {
      return exclusive(async () => {
        const handle = await read();
        if (handle === null || handle.state !== 'pending') return handle;
        let view: MobileTaskView;
        try {
          view = await gateway.request(
            {
              action: 'reconcile',
              node_id: handle.nodeId,
              idempotency_key: handle.key,
            },
            signal,
          );
        } catch {
          return handle;
        }
        return observe(handle, view, false);
      });
    },
  };
}
