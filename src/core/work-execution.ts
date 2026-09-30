// SPDX-License-Identifier: Elastic-2.0
import {
  MobileLifecycleError,
  type MobileWorkRequest,
  type MobileWorkView,
} from '@automonique/sdk';
import type { MobileAutomoniqueGateway } from './types';

type Mutation = Extract<MobileWorkRequest, { action: 'dispatch' | 'decide' }>;
export type WorkIntent =
  | Omit<Extract<Mutation, { action: 'dispatch' }>, 'idempotency_key'>
  | Omit<Extract<Mutation, { action: 'decide' }>, 'idempotency_key'>;
interface Store {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const active = new Set<string>();
export function isWorkNotApplied(error: unknown): boolean {
  return (
    error instanceof MobileLifecycleError &&
    error.status === 409 &&
    error.category === 'mobile_work_not_applied'
  );
}
export function createWorkExecution(
  scope: string,
  store: Store,
  gateway: NonNullable<MobileAutomoniqueGateway['work']>,
  random: () => string,
) {
  const key = `automonique.mobile.work.v1.${scope}`;
  async function read(): Promise<Mutation | null> {
    const raw = await store.getItem(key);
    if (raw === null) return null;
    if (raw.length > 4096) throw new Error('work_recovery_invalid');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object')
      throw new Error('work_recovery_invalid');
    const row = value as Record<string, unknown>;
    if (
      typeof row.idempotency_key !== 'string' ||
      !/^[A-Za-z0-9-]{1,128}$/.test(row.idempotency_key)
    )
      throw new Error('work_recovery_invalid');
    if (
      row.action === 'dispatch' &&
      Object.keys(row).length === 3 &&
      typeof row.issue_url === 'string' &&
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(
        row.issue_url,
      ) &&
      row.issue_url.length <= 240
    )
      return row as Mutation;
    if (
      row.action === 'decide' &&
      Object.keys(row).length === 6 &&
      typeof row.job_id === 'string' &&
      /^[A-Za-z0-9_-]{1,256}$/.test(row.job_id) &&
      typeof row.source_key === 'string' &&
      row.source_key.length > 0 &&
      row.source_key.length <= 180 &&
      typeof row.reason === 'string' &&
      new TextEncoder().encode(row.reason).length <= 500 &&
      ((row.decision === 'approve' && row.reason === '') ||
        (row.decision === 'reject' && row.reason.trim() !== ''))
    )
      return row as Mutation;
    throw new Error('work_recovery_invalid');
  }
  async function run(
    intent: WorkIntent | null,
    signal?: AbortSignal,
  ): Promise<MobileWorkView> {
    if (active.has(key)) throw new Error('work_request_busy');
    active.add(key);
    try {
      const pending = await read();
      if (intent !== null && pending !== null)
        throw new Error('work_request_pending');
      const request: Mutation | null =
        intent === null ? pending : { ...intent, idempotency_key: random() };
      if (request === null) throw new Error('work_request_missing');
      if (signal?.aborted) throw new Error('work_request_aborted');
      if (intent !== null) await store.setItem(key, JSON.stringify(request));
      if (signal?.aborted) throw new Error('work_request_aborted');
      let result: MobileWorkView;
      try {
        result = await gateway.request(request, signal);
      } catch (error) {
        // A refusal of the first attempt is definitive. A retry may follow an
        // earlier applied-but-unacknowledged write, so preserve its recovery.
        if (intent !== null && isWorkNotApplied(error))
          await store.removeItem(key);
        throw error;
      }
      if (result.kind !== 'receipt') throw new Error('work_receipt_missing');
      await store.removeItem(key);
      return result;
    } finally {
      active.delete(key);
    }
  }
  return {
    read,
    submit: (intent: WorkIntent, signal?: AbortSignal) => run(intent, signal),
    retry: (signal?: AbortSignal) => run(null, signal),
  };
}
