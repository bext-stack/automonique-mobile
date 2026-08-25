// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { syntheticSnapshot } from '@/core/fixtures';
import { createMockGateway } from '@/core/mock-gateway';
import { nextSequence } from '@/core/projection';
import {
  createPendingMutationStore,
  executeWithReconciliation,
  recoverPendingReceipts,
  type RecoveredReceipt,
} from '@/core/reconciliation';
import {
  decodeCachedSnapshot,
  encodeCachedSnapshot,
} from '@/core/snapshot-cache';
import type {
  ApprovalSummary,
  ConnectionPhase,
  MobileAction,
  MobileAutomoniqueGateway,
  MobileSnapshot,
  Receipt,
  SessionEvent,
  SessionSummary,
  VersionedTarget,
} from '@/core/types';
import { bootstrapVerticalSlice } from '@/core/vertical-slice';

interface MobileContextValue {
  readonly snapshot: MobileSnapshot;
  readonly busyAction: string | null;
  readonly projectionReady: boolean;
  readonly sendFollowUp: (
    session: SessionSummary,
    text: string,
  ) => Promise<Receipt>;
  readonly decideApproval: (
    approval: ApprovalSummary,
    decision: 'grant' | 'deny',
  ) => Promise<Receipt>;
  readonly stopRun: (session: SessionSummary) => Promise<Receipt>;
  readonly refreshProjection: () => Promise<void>;
  readonly setConnectionPhase: (
    phase: Extract<ConnectionPhase, 'live' | 'stale'>,
  ) => void;
}

interface MobileProviderProps extends PropsWithChildren {
  readonly gateway?: MobileAutomoniqueGateway;
}

const MobileContext = createContext<MobileContextValue | null>(null);
const SNAPSHOT_CACHE_KEY = 'automonique.mobile.snapshot.v1';

function initialReadOnlySnapshot(): MobileSnapshot {
  return {
    ...syntheticSnapshot,
    connection: {
      ...syntheticSnapshot.connection,
      phase: 'stale',
      label: 'Initializing projection — read only',
      mutationsAllowed: false,
    },
  };
}

function upsertReceipt(
  receipts: readonly Receipt[],
  receipt: Receipt,
): readonly Receipt[] {
  return [
    ...receipts.filter(
      (candidate) => candidate.idempotencyKey !== receipt.idempotencyKey,
    ),
    receipt,
  ];
}

function applyRecoveredReceipts(
  snapshot: MobileSnapshot,
  recovered: readonly RecoveredReceipt[],
): MobileSnapshot {
  return recovered.reduce((current, { handle, receipt }) => {
    const sameTarget = (candidate: VersionedTarget | null): boolean =>
      candidate !== null &&
      candidate.revision === handle.target.revision &&
      candidate.coordinate.authority === handle.target.coordinate.authority &&
      candidate.coordinate.kind === handle.target.coordinate.kind &&
      candidate.coordinate.id === handle.target.coordinate.id;
    const targetIsCurrent =
      handle.action === 'decide_approval'
        ? current.approvals.some((approval) => sameTarget(approval.target))
        : handle.action === 'stop_run'
          ? current.sessions.some((session) => sameTarget(session.run))
          : current.sessions.some((session) => sameTarget(session.target));
    let next = {
      ...current,
      receipts: upsertReceipt(current.receipts, receipt),
    };
    if (
      receipt.outcome === 'completed' &&
      receipt.action === 'decide_approval'
    ) {
      next = {
        ...next,
        approvals: next.approvals.filter(
          (approval) => !sameTarget(approval.target),
        ),
      };
    }
    if (receipt.outcome === 'completed' && receipt.action === 'stop_run') {
      next = {
        ...next,
        sessions: next.sessions.map((session) =>
          sameTarget(session.run)
            ? {
                ...session,
                state: 'completed',
                followUpAllowed: false,
                run: null,
              }
            : session,
        ),
      };
    }
    if (
      targetIsCurrent &&
      ['conflict', 'resync_required'].includes(receipt.outcome)
    ) {
      next = {
        ...next,
        connection: {
          ...next.connection,
          phase: 'stale',
          label: 'Mutation requires a fresh projection',
          mutationsAllowed: false,
        },
      };
    }
    return next;
  }, snapshot);
}

function recoveredReceipt(
  action: Receipt['action'],
  target: VersionedTarget,
  receipt: Receipt,
): RecoveredReceipt {
  return {
    handle: { action, idempotencyKey: receipt.idempotencyKey, target },
    receipt,
  };
}

function isResyncError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'outcome' in error &&
    (error as Error & { readonly outcome?: unknown }).outcome ===
      'resync_required'
  );
}

export function MobileProvider({
  children,
  gateway: providedGateway,
}: MobileProviderProps) {
  const [gateway] = useState(() => providedGateway ?? createMockGateway());
  const [pendingStore] = useState(createPendingMutationStore);
  const [snapshot, setSnapshot] = useState<MobileSnapshot>(
    initialReadOnlySnapshot,
  );
  const [cacheReady, setCacheReady] = useState(false);
  const [syntheticReady, setSyntheticReady] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const operationInFlight = useRef(false);

  async function refreshProjection(): Promise<void> {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusyAction('refresh-projection');
    setSyntheticReady(false);
    setSnapshot((current) => ({
      ...current,
      connection: {
        ...current.connection,
        phase: 'reconnecting',
        label: 'Reconnecting and validating projection',
        mutationsAllowed: false,
      },
    }));
    try {
      let fresh: MobileSnapshot;
      try {
        fresh = await bootstrapVerticalSlice(gateway, snapshot);
      } catch (error) {
        if (!isResyncError(error)) throw error;
        fresh = await bootstrapVerticalSlice(gateway);
      }
      if (
        fresh.connection.phase === 'stale' &&
        fresh.connection.label === 'Cursor resynchronization required'
      ) {
        fresh = await bootstrapVerticalSlice(gateway);
      }
      const recovered = await recoverPendingReceipts(gateway, pendingStore);
      const withReceiptHistory = {
        ...fresh,
        receipts: snapshot.receipts.reduce(upsertReceipt, fresh.receipts),
      };
      setSnapshot(applyRecoveredReceipts(withReceiptHistory, recovered));
      setCacheReady(true);
      setSyntheticReady(fresh.connection.synthetic);
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        connection: {
          ...current.connection,
          phase: 'stale',
          label:
            error instanceof Error
              ? `Reconnect failed · ${error.message}`
              : 'Reconnect failed · read only',
          mutationsAllowed: false,
        },
      }));
    } finally {
      setBusyAction(null);
      operationInFlight.current = false;
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      let cachedSnapshot: MobileSnapshot | undefined;
      try {
        const cached = await AsyncStorage.getItem(SNAPSHOT_CACHE_KEY);
        if (cached !== null) {
          cachedSnapshot = decodeCachedSnapshot(cached);
          if (active) setSnapshot(cachedSnapshot);
        }
      } catch {
        await AsyncStorage.removeItem(SNAPSHOT_CACHE_KEY).catch(
          () => undefined,
        );
      }

      try {
        const fresh = await bootstrapVerticalSlice(gateway, cachedSnapshot);
        const recovered = await recoverPendingReceipts(gateway, pendingStore);
        if (active) {
          const withReceiptHistory =
            cachedSnapshot === undefined
              ? fresh
              : {
                  ...fresh,
                  receipts: cachedSnapshot.receipts.reduce(
                    upsertReceipt,
                    fresh.receipts,
                  ),
                };
          setSnapshot(applyRecoveredReceipts(withReceiptHistory, recovered));
          setCacheReady(true);
          setSyntheticReady(fresh.connection.synthetic);
        }
      } catch (error) {
        if (!active) return;
        setSnapshot((current) => ({
          ...current,
          connection: {
            ...current.connection,
            phase: 'stale',
            label:
              error instanceof Error
                ? `Read only · ${error.message}`
                : 'Read only · bootstrap failed',
            mutationsAllowed: false,
          },
        }));
        setCacheReady(true);
        setSyntheticReady(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [gateway, pendingStore]);

  useEffect(() => {
    if (!cacheReady) return;
    let active = true;
    void (async () => {
      try {
        const encoded = encodeCachedSnapshot(snapshot);
        await AsyncStorage.setItem(SNAPSHOT_CACHE_KEY, encoded);
      } catch {
        await AsyncStorage.removeItem(SNAPSHOT_CACHE_KEY).catch(
          () => undefined,
        );
        if (!active) return;
        setSyntheticReady(false);
        setSnapshot((current) =>
          current.connection.phase === 'stale' &&
          !current.connection.mutationsAllowed
            ? current
            : {
                ...current,
                connection: {
                  ...current.connection,
                  phase: 'stale',
                  label: 'Local projection unavailable — read only',
                  mutationsAllowed: false,
                },
              },
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [cacheReady, snapshot]);

  function requireAction(action: MobileAction): void {
    if (
      !snapshot.connection.mutationsAllowed ||
      !snapshot.connection.allowedActions.includes(action)
    ) {
      throw new Error('connection_read_only');
    }
  }

  async function runMutation(
    action: Receipt['action'],
    target: SessionSummary['target'],
    operation: (idempotencyKey: string) => Promise<Receipt>,
  ): Promise<Receipt> {
    if (operationInFlight.current) throw new Error('operation_in_progress');
    operationInFlight.current = true;
    const idempotencyKey = Crypto.randomUUID();
    setBusyAction(idempotencyKey);
    try {
      return await executeWithReconciliation(
        gateway,
        pendingStore,
        { action, idempotencyKey, target },
        () => operation(idempotencyKey),
      );
    } finally {
      setBusyAction(null);
      operationInFlight.current = false;
    }
  }

  async function sendFollowUp(session: SessionSummary, text: string) {
    requireAction('follow_up');
    if (!session.followUpAllowed) throw new Error('follow_up_unauthorized');
    if (
      new TextEncoder().encode(text).byteLength >
      snapshot.connection.limits.maxFollowUpBytes
    ) {
      throw new Error('follow_up_too_large');
    }
    const receipt = await runMutation(
      'follow_up',
      session.target,
      (idempotencyKey) =>
        gateway.followUp({
          session: session.target,
          text,
          idempotencyKey,
        }),
    );
    setSnapshot((current) => {
      let next = applyRecoveredReceipts(current, [
        recoveredReceipt('follow_up', session.target, receipt),
      ]);
      const exactSession = current.sessions.find(
        (candidate) =>
          JSON.stringify(candidate.target) === JSON.stringify(session.target),
      );
      if (receipt.outcome === 'completed' && exactSession !== undefined) {
        const events = current.timelines[session.target.coordinate.id] ?? [];
        const sequence = nextSequence(events);
        const event: SessionEvent = {
          id: `event-${receipt.id ?? receipt.idempotencyKey}`,
          cursor: `local:${receipt.id ?? receipt.idempotencyKey}`,
          sequence,
          createdAt: new Date().toISOString(),
          provenance: current.connection.synthetic ? 'synthetic' : 'preview',
          kind: 'message',
          role: 'user',
          text: text.trim(),
        };
        next = {
          ...next,
          timelines: {
            ...next.timelines,
            [session.target.coordinate.id]: [...events, event],
          },
        };
      }
      return next;
    });
    return receipt;
  }

  async function decideApproval(
    approval: ApprovalSummary,
    decision: 'grant' | 'deny',
  ) {
    requireAction('decide_approval');
    if (
      approval.expiresAt !== null &&
      Date.parse(approval.expiresAt) <= Date.now()
    ) {
      throw new Error('approval_expired');
    }
    const receipt = await runMutation(
      'decide_approval',
      approval.target,
      (idempotencyKey) =>
        gateway.decideApproval({
          approval: approval.target,
          decision,
          idempotencyKey,
        }),
    );
    setSnapshot((current) =>
      applyRecoveredReceipts(current, [
        recoveredReceipt('decide_approval', approval.target, receipt),
      ]),
    );
    return receipt;
  }

  async function stopRun(session: SessionSummary) {
    requireAction('stop_run');
    if (!session.run) throw new Error('session_run_missing');
    const receipt = await runMutation(
      'stop_run',
      session.run,
      (idempotencyKey) =>
        gateway.stopRun({ run: session.run!, idempotencyKey }),
    );
    setSnapshot((current) =>
      applyRecoveredReceipts(current, [
        recoveredReceipt('stop_run', session.run!, receipt),
      ]),
    );
    return receipt;
  }

  function setConnectionPhase(
    phase: Extract<ConnectionPhase, 'live' | 'stale'>,
  ) {
    setSnapshot((current) => {
      if (
        phase === 'stale' &&
        syntheticReady &&
        current.connection.synthetic &&
        current.connection.phase === 'live'
      ) {
        return {
          ...current,
          connection: {
            ...current.connection,
            phase: 'stale',
            label: 'Simulated connectivity loss — read only',
            mutationsAllowed: false,
          },
        };
      }
      if (
        phase === 'live' &&
        syntheticReady &&
        current.connection.synthetic &&
        current.connection.label === 'Simulated connectivity loss — read only'
      ) {
        return {
          ...current,
          connection: {
            ...current.connection,
            phase: 'live',
            label: 'Synthetic development transport',
            mutationsAllowed: true,
          },
        };
      }
      return current;
    });
  }

  return (
    <MobileContext.Provider
      value={{
        snapshot,
        busyAction,
        projectionReady: cacheReady,
        sendFollowUp,
        decideApproval,
        stopRun,
        refreshProjection,
        setConnectionPhase,
      }}
    >
      {children}
    </MobileContext.Provider>
  );
}

export function useMobile(): MobileContextValue {
  const context = use(MobileContext);
  if (!context) throw new Error('MobileProvider is missing');
  return context;
}
