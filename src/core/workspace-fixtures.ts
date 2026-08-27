// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision } from './types';
import {
  WORKSPACE_COMPANION_SCHEMA,
  type ServerIdentity,
  type WorkspaceCompanionCatalog,
} from './workspace-companion';

export const WORKSPACE_FIXTURE_IDENTITY =
  `sha256:${'a'.repeat(64)}` as ServerIdentity;

/** Contract fixture only. Production composition roots do not import this file. */
export const workspaceCompanionFixture: WorkspaceCompanionCatalog = {
  schema: WORKSPACE_COMPANION_SCHEMA,
  phase: 'live',
  generatedAt: '2026-08-27T10:00:00Z',
  selectedServerIdentity: WORKSPACE_FIXTURE_IDENTITY,
  serverTombstones: [],
  revisionTombstones: [],
  servers: [
    {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      label: 'Delivery Europe',
      origin: 'https://ops.example.test',
      tenantId: 'tenant-delivery',
      authorization: 'active',
      authorizationRevision: decimalRevision('8'),
      principalGeneration: decimalRevision('3'),
      staleProjectIds: [],
      actions: [
        'workspace_read',
        'workspace_create_preview',
        'workspace_resume_preview',
      ],
      hosts: [
        {
          id: 'host-fr-1',
          label: 'Paris builder',
          state: 'ready',
          freshness: {
            state: 'fresh',
            observedAt: '2026-08-27T09:59:58Z',
          },
        },
      ],
      projects: [
        { id: 'project-mobile', hostIds: ['host-fr-1'], label: 'Mobile' },
      ],
      workspaces: [
        {
          id: 'workspace-34',
          revision: decimalRevision('12'),
          hostId: 'host-fr-1',
          projectId: 'project-mobile',
          title: 'Read-mostly workspace companion',
          externalWorkItem: {
            provider: 'GitHub',
            key: '#34',
            title: 'Add a read-mostly workspace companion',
            status: 'open',
          },
          orchestrationStatus: 'review',
          attempt: {
            id: 'attempt-34-a',
            revision: decimalRevision('4'),
            state: 'waiting',
          },
          sessions: [
            {
              id: 'session-34',
              target: {
                authority: 'automonique',
                kind: 'session',
                id: 'session-34',
              },
              revision: decimalRevision('9'),
              title: 'Implement companion foundation',
              state: 'waiting',
              unreadAttention: 2,
            },
          ],
          repository: {
            label: 'bext-stack/automonique-mobile',
            webUrl: 'https://github.com/bext-stack/automonique-mobile',
          },
          branch: { label: 'feat/workspace-companion-34', state: 'changed' },
          freshness: {
            state: 'fresh',
            observedAt: '2026-08-27T09:59:58Z',
          },
          unreadAttention: 2,
          navigation: [
            { destination: 'chat', revision: decimalRevision('12') },
            { destination: 'files', revision: decimalRevision('12') },
            { destination: 'preview', revision: decimalRevision('12') },
            {
              destination: 'source_control',
              revision: decimalRevision('12'),
            },
          ],
        },
      ],
    },
  ],
};
