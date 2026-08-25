// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  use,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { syntheticSnapshot } from '@/core/fixtures';
import { createMockGateway } from '@/core/mock-gateway';
import { nextSequence } from '@/core/projection';
import type {
  ApprovalSummary,
  ConnectionPhase,
  MobileSnapshot,
  Receipt,
  SessionEvent,
  SessionSummary,
} from '@/core/types';

interface MobileContextValue {
  readonly snapshot: MobileSnapshot;
  readonly busyAction: string | null;
  readonly sendFollowUp: (
    session: SessionSummary,
    text: string,
  ) => Promise<Receipt>;
  readonly decideApproval: (
    approval: ApprovalSummary,
    decision: 'grant' | 'deny',
  ) => Promise<Receipt>;
  readonly stopRun: (session: SessionSummary) => Promise<Receipt>;
  readonly setConnectionPhase: (
    phase: Extract<ConnectionPhase, 'live' | 'stale'>,
  ) => void;
}

const MobileContext = createContext<MobileContextValue | null>(null);

const SNAPSHOT_CACHE_KEY = 'automonique.mobile.snapshot.v1';

export function MobileProvider({ children }: PropsWithChildren) {
  const [gateway] = useState(createMockGateway);
  const [snapshot, setSnapshot] = useState<MobileSnapshot>(syntheticSnapshot);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cached = await AsyncStorage.getItem(SNAPSHOT_CACHE_KEY);
        if (cached && active) {
          const parsed = JSON.parse(cached) as MobileSnapshot;
          setSnapshot({
            ...parsed,
            connection: {
              ...parsed.connection,
              phase: 'stale',
              label: 'Cached projection — read only',
              mutationsAllowed: false,
            },
          });
        }
        const fresh = await gateway.bootstrap();
        if (active) setSnapshot(fresh);
      } catch {
        // A cache failure cannot make stale data writable or block the synthetic baseline.
      }
    })();
    return () => {
      active = false;
    };
  }, [gateway]);

  useEffect(() => {
    void AsyncStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  }, [snapshot]);

  async function sendFollowUp(session: SessionSummary, text: string) {
    if (!snapshot.connection.mutationsAllowed)
      throw new Error('connection_read_only');
    const idempotencyKey = Crypto.randomUUID();
    setBusyAction(idempotencyKey);
    try {
      const receipt = await gateway.followUp({
        session: session.target,
        text,
        idempotencyKey,
      });
      setSnapshot((current) => {
        const events = current.timelines[session.target.coordinate.id] ?? [];
        const sequence = nextSequence(events);
        const event: SessionEvent = {
          id: `event-${receipt.id}`,
          cursor: String(sequence),
          sequence,
          createdAt: new Date().toISOString(),
          provenance: 'synthetic',
          kind: 'message',
          role: 'user',
          text: text.trim(),
        };
        return {
          ...current,
          timelines: {
            ...current.timelines,
            [session.target.coordinate.id]: [...events, event],
          },
          receipts: [...current.receipts, receipt],
        };
      });
      return receipt;
    } finally {
      setBusyAction(null);
    }
  }

  async function decideApproval(
    approval: ApprovalSummary,
    decision: 'grant' | 'deny',
  ) {
    if (!snapshot.connection.mutationsAllowed)
      throw new Error('connection_read_only');
    const idempotencyKey = Crypto.randomUUID();
    setBusyAction(idempotencyKey);
    try {
      const receipt = await gateway.decideApproval({
        approval: approval.target,
        decision,
        idempotencyKey,
      });
      setSnapshot((current) => ({
        ...current,
        approvals: current.approvals.filter(
          (candidate) =>
            candidate.target.coordinate.id !== approval.target.coordinate.id,
        ),
        receipts: [...current.receipts, receipt],
      }));
      return receipt;
    } finally {
      setBusyAction(null);
    }
  }

  async function stopRun(session: SessionSummary) {
    if (!snapshot.connection.mutationsAllowed)
      throw new Error('connection_read_only');
    if (!session.run) throw new Error('session_run_missing');
    const idempotencyKey = Crypto.randomUUID();
    setBusyAction(idempotencyKey);
    try {
      const receipt = await gateway.stopRun({
        run: session.run,
        idempotencyKey,
      });
      setSnapshot((current) => ({
        ...current,
        sessions: current.sessions.map((candidate) =>
          candidate.target.coordinate.id === session.target.coordinate.id
            ? { ...candidate, state: 'completed', followUpAllowed: false }
            : candidate,
        ),
        receipts: [...current.receipts, receipt],
      }));
      return receipt;
    } finally {
      setBusyAction(null);
    }
  }

  function setConnectionPhase(
    phase: Extract<ConnectionPhase, 'live' | 'stale'>,
  ) {
    setSnapshot((current) => ({
      ...current,
      connection: {
        ...current.connection,
        phase,
        label:
          phase === 'live'
            ? 'Synthetic development transport'
            : 'Cached synthetic projection — read only',
        mutationsAllowed: phase === 'live',
      },
    }));
  }

  return (
    <MobileContext.Provider
      value={{
        snapshot,
        busyAction,
        sendFollowUp,
        decideApproval,
        stopRun,
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
