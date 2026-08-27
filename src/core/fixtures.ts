// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision, type MobileSnapshot } from './types';

export const syntheticSnapshot: MobileSnapshot = {
  schema: 'automonique.mobile-snapshot/v1',
  connection: {
    phase: 'live',
    label: 'Synthetic development transport',
    mutationsAllowed: true,
    synthetic: true,
    allowedActions: ['attach', 'follow_up', 'decide_approval', 'stop_run'],
    limits: { maxPageEvents: 128, maxFollowUpBytes: 4096 },
  },
  sessions: [
    {
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: 'session-synthetic-001',
        },
        revision: decimalRevision('12'),
      },
      title: 'Mobile vertical slice',
      run: {
        coordinate: {
          authority: 'automonique',
          kind: 'run',
          id: 'run-synthetic-001',
        },
        revision: decimalRevision('7'),
      },
      state: 'active',
      attachable: true,
      followUpAllowed: true,
      followUpFenceRevision: null,
      observedAt: '2026-08-25T09:00:00Z',
      lastCursor: '3',
    },
    {
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: 'session-synthetic-002',
        },
        revision: decimalRevision('4'),
      },
      title: 'Release review',
      run: null,
      state: 'waiting',
      attachable: true,
      followUpAllowed: false,
      followUpFenceRevision: null,
      observedAt: '2026-08-25T08:42:00Z',
      lastCursor: '1',
    },
  ],
  timelines: {
    'session-synthetic-001': [
      {
        id: 'event-synthetic-001',
        cursor: '1',
        sequence: decimalRevision('1'),
        createdAt: '2026-08-25T08:58:00Z',
        provenance: 'authoritative',
        kind: 'message',
        role: 'user',
        text: 'Create the Automonique mobile client from scratch.',
      },
      {
        id: 'event-synthetic-002',
        cursor: '2',
        sequence: decimalRevision('2'),
        createdAt: '2026-08-25T08:58:06Z',
        provenance: 'authoritative',
        kind: 'tool',
        name: 'repository.create',
        state: 'completed',
        publicText: 'Created the public mobile repository.',
      },
      {
        id: 'event-synthetic-003',
        cursor: '3',
        sequence: decimalRevision('3'),
        createdAt: '2026-08-25T08:59:10Z',
        provenance: 'preview',
        kind: 'message',
        role: 'assistant',
        text: 'The first safe, SDK-owned vertical slice is being assembled.',
      },
    ],
    'session-synthetic-002': [
      {
        id: 'event-synthetic-004',
        cursor: '1',
        sequence: decimalRevision('1'),
        createdAt: '2026-08-25T08:42:00Z',
        provenance: 'authoritative',
        kind: 'run_state',
        state: 'Waiting for an exact approval revision.',
      },
    ],
  },
  approvals: [
    {
      session: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: 'session-synthetic-001',
        },
        revision: decimalRevision('12'),
      },
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'approval',
          id: 'approval-synthetic-001',
        },
        revision: decimalRevision('3'),
      },
      approvalType: 'provider',
      title: 'Publish the preview build',
      detail: 'Allow the provider to upload one synthetic preview artifact.',
      impact:
        'Creates an externally accessible preview artifact. No production deployment.',
      requester: 'provider/session-synthetic-001',
      expiresAt: '2099-08-26T09:00:00Z',
    },
  ],
  receipts: [],
};
