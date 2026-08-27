// SPDX-License-Identifier: Elastic-2.0

import type {
  LineageProjection,
  ReviewSnapshot,
  WorkContextRecord,
} from '@automonique/sdk';

import {
  buildWorkspaceServerCatalog,
  MAX_WORKSPACE_DETAIL_READS,
} from './workspace-v2-catalog';
import type { WorkspaceV2Gateway } from './workspace-v2-gateway';

const serverIdentity = `sha256:${'b'.repeat(64)}`;

function record(
  identity: WorkContextRecord['identity'],
  label: string,
  relations: WorkContextRecord['relations'] = [],
  lifecycle: WorkContextRecord['lifecycle'] = 'active',
  revision = 1n,
): WorkContextRecord {
  return {
    attributes: { checkout: null, host_setup: null },
    identity,
    label,
    lifecycle,
    relations,
    revision,
  } as WorkContextRecord;
}

function graph(index: number): readonly WorkContextRecord[] {
  const suffix = String(index);
  return [
    record(
      { kind: 'checkout', id: `checkout-${suffix}` } as never,
      `Checkout label ${suffix}`,
      [
        {
          kind: 'checkout_project',
          target: { kind: 'project', id: 'project-1' } as never,
        },
        {
          kind: 'checkout_host_setup',
          target: { kind: 'host_setup', id: 'host-1' } as never,
        },
        {
          kind: 'checkout_repository',
          target: {
            kind: 'repository',
            resource: {
              authority: 'github',
              kind: 'repository',
              id: 'repo-coordinate',
            },
          } as never,
        },
      ],
    ),
    record(
      { kind: 'user_workspace', id: `workspace-${suffix}` } as never,
      `Misleading label github #999 done ${suffix}`,
      [
        {
          kind: 'user_workspace_project',
          target: { kind: 'project', id: 'project-1' } as never,
        },
        {
          kind: 'user_workspace_checkout',
          target: { kind: 'checkout', id: `checkout-${suffix}` } as never,
        },
      ],
      'running',
      BigInt(index + 2),
    ),
    record(
      { kind: 'attempt_workspace', id: `attempt-${suffix}` } as never,
      `Attempt ${suffix}`,
      [
        {
          kind: 'attempt_user_workspace',
          target: {
            kind: 'user_workspace',
            id: `workspace-${suffix}`,
          } as never,
        },
      ],
      'hibernated',
      3n,
    ),
    record(
      { kind: 'session', id: `work-session-${suffix}` } as never,
      `Session ${suffix}`,
      [
        {
          kind: 'session_attempt_workspace',
          target: {
            kind: 'attempt_workspace',
            id: `attempt-${suffix}`,
          } as never,
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: {
              authority: 'automonique',
              kind: 'session',
              id: `retained-${suffix}`,
            },
          } as never,
        },
      ],
      'active',
      4n,
    ),
  ];
}

function lineage(index: number): LineageProjection {
  return {
    schema: 'automonique.platform/v2',
    workspace: `workspace-${index}`,
    external_work_items: [
      {
        freshness: {
          observed_at_ms: 2_000n,
          stale_after_ms: 5_000n,
          state: 'fresh',
        },
        identity: {
          authority: 'tracker-1',
          key: `#${index}`,
          provider: 'github',
          scope: 'org/repo',
        },
        latest_useful_message: {
          observed_at_ms: 2_000n,
          text: `Typed task ${index}`,
        },
        moved_to: null,
        origin: {
          attempt: null,
          pane: null,
          session: null,
          workspace: `workspace-${index}`,
        },
        revision: 1n,
        state: 'open',
        workspace: `workspace-${index}`,
      },
    ],
    orchestration: [
      {
        external_work: null,
        freshness: {
          observed_at_ms: 2_100n,
          stale_after_ms: 5_000n,
          state: 'fresh',
        },
        identity: { kind: 'task', id: `task-${index}` },
        latest_useful_message: null,
        origin: {
          attempt: null,
          pane: null,
          session: null,
          workspace: `workspace-${index}`,
        },
        parent: null,
        revision: 1n,
        status: { kind: 'waiting', reason: 'typed wait' },
        workspace: `workspace-${index}`,
      },
    ],
  } as unknown as LineageProjection;
}

function review(index: number): ReviewSnapshot {
  return {
    schema: 'automonique.platform/review/v2',
    platform_version: 2n,
    revision: 7n,
    workspace: { kind: 'user_workspace', id: `workspace-${index}` },
    attention: {
      reason: 'review',
      source_revision: 7n,
      state: 'needs_you',
      unread: 3n,
    },
    attention_events: [],
    files: [
      {
        change: 'modified',
        conflict: 'none',
        hunks: [],
        id: `file-${index}`,
        path: 'src/typed.ts',
        preview: {
          byte_size: 20n,
          height: null,
          kind: 'text',
          media_type: 'text/plain',
          sanitized: true,
          width: null,
        },
        worktree: 'unstaged',
      },
    ],
    checks: [],
    comments: [],
    proposals: [],
    pull_request: {
      authority: { id: 'pr-auth', kind: 'pull_request' },
      freshness: {
        observed_at_ms: 2_000n,
        observed_revision: 1n,
        state: 'fresh',
      },
      head_revision: 'abc',
      id: '34',
      readiness: 'ready',
      state: 'open',
    },
    review: {
      authority: { id: 'review-auth', kind: 'review' },
      decision: 'changes_requested',
      freshness: {
        observed_at_ms: 2_000n,
        observed_revision: 1n,
        state: 'fresh',
      },
    },
    delivery: {
      authority: { id: 'delivery-auth', kind: 'delivery' },
      freshness: {
        observed_at_ms: 2_000n,
        observed_revision: 1n,
        state: 'fresh',
      },
      id: null,
      state: 'not_started',
    },
  } as unknown as ReviewSnapshot;
}

function fakeGateway(
  count: number,
  actions: readonly ('query_work_contexts' | 'get_lineage' | 'get_review')[] = [
    'query_work_contexts',
    'get_lineage',
    'get_review',
  ],
) {
  const loadLineage = jest.fn(async (_project: string, workspace: string) =>
    lineage(Number(workspace.replace('workspace-', ''))),
  );
  const loadReview = jest.fn(
    async (_project: string, workspace: { readonly id: string }) =>
      review(Number(workspace.id.replace('workspace-', ''))),
  );
  const records = [
    record({ kind: 'project', id: 'project-1' } as never, 'Typed project'),
    record({ kind: 'host_setup', id: 'host-1' } as never, 'Typed host', [
      {
        kind: 'host_setup_project',
        target: { kind: 'project', id: 'project-1' } as never,
      },
    ]),
    record(
      { kind: 'host_setup', id: 'host-2' } as never,
      'Typed idle host',
      [
        {
          kind: 'host_setup_project',
          target: { kind: 'project', id: 'project-1' } as never,
        },
      ],
      'hibernated',
    ),
    ...Array.from({ length: count }, (_, index) => graph(index)).flat(),
  ];
  const gateway = {
    authorizationScope: {
      serverIdentity,
      tenantId: 'tenant-1',
      authorizationRevision: 9n,
      principalGeneration: 4n,
      delegationId: 'delegation-1',
      expiresAtMs: 9_999_999_999_999n,
      projectRoots: ['project-1'],
      actions,
    },
    negotiate: jest.fn(async () => undefined),
    loadProject: jest.fn(async () => records),
    loadLineage,
    loadReview,
  } as unknown as WorkspaceV2Gateway;
  return { gateway, loadLineage, loadReview };
}

test('projects typed relations, lineage status, review attention, and separately granted destinations', async () => {
  const { gateway } = fakeGateway(1);
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
    now: () => 3_000,
  });

  expect(result.coverage).toBe('complete');
  expect(result.profile.projects).toEqual([
    {
      id: 'project-1',
      hostIds: ['host-1', 'host-2'],
      label: 'Typed project',
    },
  ]);
  expect(result.profile.hosts).toEqual([
    expect.objectContaining({ id: 'host-1', state: 'ready' }),
    expect.objectContaining({ id: 'host-2', state: 'offline' }),
  ]);
  expect(result.profile.workspaces[0]).toMatchObject({
    id: 'workspace-0',
    title: 'Misleading label github #999 done 0',
    externalWorkItem: { key: '#0', title: '#0', status: 'open' },
    orchestrationStatus: 'waiting',
    unreadAttention: 3,
    repository: { label: 'repo-coordinate', webUrl: null },
    branch: null,
    sessions: [{ id: 'retained-0', state: 'active', unreadAttention: 3 }],
    navigation: [
      { destination: 'chat', revision: '2' },
      { destination: 'files', revision: '2' },
      { destination: 'preview', revision: '2' },
      { destination: 'source_control', revision: '2' },
    ],
  });
});

test('bounds inventory-wide lineage and review fanout and reports partial coverage', async () => {
  const { gateway, loadLineage, loadReview } = fakeGateway(
    MAX_WORKSPACE_DETAIL_READS + 3,
  );
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });

  expect(result.profile.workspaces).toHaveLength(
    MAX_WORKSPACE_DETAIL_READS + 3,
  );
  expect(loadLineage).toHaveBeenCalledTimes(MAX_WORKSPACE_DETAIL_READS);
  expect(loadReview).toHaveBeenCalledTimes(MAX_WORKSPACE_DETAIL_READS);
  expect(result).toMatchObject({ coverage: 'partial', omittedDetailCount: 3 });
  expect(result.profile.workspaces.at(-1)).toMatchObject({
    externalWorkItem: null,
    unreadAttention: 0,
    navigation: [{ destination: 'chat' }],
  });
});

test('missing detail grants never become inferred navigation authority', async () => {
  const { gateway, loadLineage, loadReview } = fakeGateway(1, [
    'query_work_contexts',
  ] as const);
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });

  expect(loadLineage).not.toHaveBeenCalled();
  expect(loadReview).not.toHaveBeenCalled();
  expect(result.coverage).toBe('partial');
  expect(result.profile.workspaces[0]!.navigation).toEqual([
    { destination: 'chat', revision: '2' },
  ]);
});
