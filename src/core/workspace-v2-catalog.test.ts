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
import {
  MAX_WORKSPACES,
  MAX_WORKSPACE_HOSTS,
  MAX_WORKSPACE_PROJECTS,
  MAX_WORKSPACE_SESSIONS,
  WORKSPACE_COMPANION_SCHEMA,
  admitWorkspaceCompanionCatalog,
  type ScopedServerProfile,
} from './workspace-companion';
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
      reason: 'review_requested',
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
      state: 'not_delivered',
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

function boundedProjectRecords(
  projectId: string,
  options: {
    readonly hostCount?: number;
    readonly sessionCount?: number;
  } = {},
): readonly WorkContextRecord[] {
  const hostCount = options.hostCount ?? 1;
  const records: WorkContextRecord[] = [
    record({ kind: 'project', id: projectId } as never, projectId),
  ];
  for (let index = 0; index < hostCount; index += 1) {
    records.push(
      record(
        { kind: 'host_setup', id: `${projectId}-host-${index}` } as never,
        `Host ${index}`,
        [
          {
            kind: 'host_setup_project',
            target: { kind: 'project', id: projectId } as never,
          },
        ],
      ),
    );
  }
  if (options.sessionCount === undefined) return records;
  records.push(
    record(
      { kind: 'checkout', id: `${projectId}-checkout` } as never,
      'Checkout',
      [
        {
          kind: 'checkout_project',
          target: { kind: 'project', id: projectId } as never,
        },
        {
          kind: 'checkout_host_setup',
          target: {
            kind: 'host_setup',
            id: `${projectId}-host-0`,
          } as never,
        },
      ],
    ),
    record(
      { kind: 'user_workspace', id: `${projectId}-workspace` } as never,
      'Workspace',
      [
        {
          kind: 'user_workspace_project',
          target: { kind: 'project', id: projectId } as never,
        },
        {
          kind: 'user_workspace_checkout',
          target: {
            kind: 'checkout',
            id: `${projectId}-checkout`,
          } as never,
        },
      ],
    ),
    record(
      { kind: 'attempt_workspace', id: `${projectId}-attempt` } as never,
      'Attempt',
      [
        {
          kind: 'attempt_user_workspace',
          target: {
            kind: 'user_workspace',
            id: `${projectId}-workspace`,
          } as never,
        },
      ],
    ),
  );
  for (let index = 0; index < options.sessionCount; index += 1) {
    records.push(
      record(
        { kind: 'session', id: `${projectId}-work-session-${index}` } as never,
        `Session ${index}`,
        [
          {
            kind: 'session_attempt_workspace',
            target: {
              kind: 'attempt_workspace',
              id: `${projectId}-attempt`,
            } as never,
          },
          {
            kind: 'session_platform_session',
            target: {
              kind: 'platform_session',
              resource: {
                authority: 'automonique',
                kind: 'session',
                id: `${projectId}-retained-${index}`,
              },
            } as never,
          },
        ],
      ),
    );
  }
  return records;
}

function boundedGateway(
  projectRoots: readonly string[],
  records: (project: string) => readonly WorkContextRecord[],
): { readonly gateway: WorkspaceV2Gateway; readonly loadProject: jest.Mock } {
  const loadProject = jest.fn(async (project: string) => records(project));
  const gateway = {
    authorizationScope: {
      serverIdentity,
      tenantId: 'tenant-1',
      authorizationRevision: 9n,
      principalGeneration: 4n,
      delegationId: 'delegation-1',
      expiresAtMs: 9_999_999_999_999n,
      projectRoots,
      actions: ['query_work_contexts'],
    },
    negotiate: jest.fn(async () => undefined),
    loadProject,
    loadLineage: jest.fn(),
    loadReview: jest.fn(),
  } as unknown as WorkspaceV2Gateway;
  return { gateway, loadProject };
}

function expectStrictProfileAdmission(profile: ScopedServerProfile): void {
  expect(() =>
    admitWorkspaceCompanionCatalog({
      schema: WORKSPACE_COMPANION_SCHEMA,
      phase: 'live',
      generatedAt: '2026-08-27T12:00:00.000Z',
      selectedServerIdentity: profile.serverIdentity,
      servers: [profile],
      serverTombstones: [],
      revisionTombstones: [],
    }),
  ).not.toThrow();
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
      { destination: 'review', revision: '2' },
      { destination: 'preview', revision: '2' },
      { destination: 'source_control', revision: '2' },
    ],
  });
  expect(result.details[0]?.review?.semantics).toMatchObject({
    attention: {
      semantic_key: 'attention.needs_you',
      source_revision: 7n,
    },
    review: {
      semantic_key: 'review.changes_requested',
      freshness_key: 'freshness.fresh',
    },
    pull_request: { semantic_key: 'pull_request.open.ready' },
    delivery: { semantic_key: 'delivery.not_delivered' },
    previews: [{ semantic_key: 'preview.text.sanitized' }],
  });
  expect(result.details[0]?.sessionBindings).toEqual([
    {
      workSessionId: 'work-session-0',
      attemptWorkspaceId: 'attempt-0',
      retainedSessionId: 'retained-0',
    },
  ]);
});

test('withholds an incoherent review from detail, attention, and navigation', async () => {
  const { gateway } = fakeGateway(1);
  const baseline = review(0);
  jest.mocked(gateway.loadReview).mockResolvedValue({
    ...baseline,
    attention: { ...baseline.attention, reason: 'complete' },
  });
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });

  expect(result).toMatchObject({ coverage: 'partial', failedDetailCount: 1 });
  expect(result.details[0]?.review).toBeNull();
  expect(result.profile.workspaces[0]).toMatchObject({
    unreadAttention: 0,
    navigation: [{ destination: 'chat', revision: '2' }],
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

test('bounds the indexed inventory and reports workspace omission separately', async () => {
  const { gateway } = fakeGateway(MAX_WORKSPACES + 3);
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });

  expect(result.profile.workspaces).toHaveLength(MAX_WORKSPACES);
  expect(result.omittedWorkspaceCount).toBe(3);
  expect(result.omittedSessionCount).toBe(3);
  expect(result.omittedDetailCount).toBe(
    MAX_WORKSPACES - MAX_WORKSPACE_DETAIL_READS,
  );
  expect(result.coverage).toBe('partial');
});

test.each([MAX_WORKSPACE_PROJECTS, MAX_WORKSPACE_PROJECTS + 1])(
  'bounds %i delegated project roots before loading and reports exact omission',
  async (count) => {
    const roots = Array.from(
      { length: count },
      (_, index) => `project-${index}`,
    );
    const { gateway, loadProject } = boundedGateway(roots, (project) =>
      boundedProjectRecords(project),
    );
    const result = await buildWorkspaceServerCatalog({
      gateway,
      origin: 'https://ops.example.test',
      serverLabel: 'ops.example.test',
    });

    expect(loadProject).toHaveBeenCalledTimes(
      Math.min(count, MAX_WORKSPACE_PROJECTS),
    );
    expect(result.profile.projects).toHaveLength(MAX_WORKSPACE_HOSTS);
    expect(result.omittedProjectCount).toBe(count - MAX_WORKSPACE_HOSTS);
    expect(result.profile.hosts).toHaveLength(MAX_WORKSPACE_HOSTS);
    expect(result.omittedHostCount).toBe(
      Math.min(count, MAX_WORKSPACE_PROJECTS) - MAX_WORKSPACE_HOSTS,
    );
    expectStrictProfileAdmission(result.profile);
  },
);

test.each([MAX_WORKSPACE_HOSTS, MAX_WORKSPACE_HOSTS + 1])(
  'bounds %i hosts coherently and reports exact omission',
  async (hostCount) => {
    const { gateway } = boundedGateway(['project-hosts'], (project) =>
      boundedProjectRecords(project, { hostCount }),
    );
    const result = await buildWorkspaceServerCatalog({
      gateway,
      origin: 'https://ops.example.test',
      serverLabel: 'ops.example.test',
    });

    expect(result.profile.hosts).toHaveLength(
      Math.min(hostCount, MAX_WORKSPACE_HOSTS),
    );
    expect(result.profile.projects[0]?.hostIds).toHaveLength(
      Math.min(hostCount, MAX_WORKSPACE_HOSTS),
    );
    expect(result.omittedHostCount).toBe(
      Math.max(0, hostCount - MAX_WORKSPACE_HOSTS),
    );
    expectStrictProfileAdmission(result.profile);
  },
);

test.each([MAX_WORKSPACE_SESSIONS, MAX_WORKSPACE_SESSIONS + 1])(
  'bounds %i retained sessions coherently and reports exact omission',
  async (sessionCount) => {
    const { gateway } = boundedGateway(['project-sessions'], (project) =>
      boundedProjectRecords(project, { sessionCount }),
    );
    const result = await buildWorkspaceServerCatalog({
      gateway,
      origin: 'https://ops.example.test',
      serverLabel: 'ops.example.test',
    });

    expect(result.profile.workspaces[0]?.sessions).toHaveLength(
      Math.min(sessionCount, MAX_WORKSPACE_SESSIONS),
    );
    expect(result.omittedSessionCount).toBe(
      Math.max(0, sessionCount - MAX_WORKSPACE_SESSIONS),
    );
    expectStrictProfileAdmission(result.profile);
  },
);

test('selects the latest attempt linearly and ignores malformed or duplicate retained sessions', async () => {
  const records = [
    ...boundedProjectRecords('project-adversarial', {
      sessionCount: 0,
    }),
  ];
  records.push(
    record(
      { kind: 'attempt_workspace', id: 'attempt-z' } as never,
      'Tie loser',
      [
        {
          kind: 'attempt_user_workspace',
          target: {
            kind: 'user_workspace',
            id: 'project-adversarial-workspace',
          } as never,
        },
      ],
      'active',
      9n,
    ),
    record(
      { kind: 'attempt_workspace', id: 'attempt-a' } as never,
      'Tie winner',
      [
        {
          kind: 'attempt_user_workspace',
          target: {
            kind: 'user_workspace',
            id: 'project-adversarial-workspace',
          } as never,
        },
      ],
      'active',
      9n,
    ),
    record(
      { kind: 'session', id: 'missing-target' } as never,
      'Missing target',
      [
        {
          kind: 'session_attempt_workspace',
          target: { kind: 'attempt_workspace', id: 'attempt-a' } as never,
        },
      ],
    ),
    ...['first', 'duplicate'].map((id) =>
      record({ kind: 'session', id } as never, id, [
        {
          kind: 'session_attempt_workspace',
          target: { kind: 'attempt_workspace', id: 'attempt-a' } as never,
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: {
              authority: 'automonique',
              kind: 'session',
              id: 'retained-once',
            },
          } as never,
        },
      ]),
    ),
  );
  const { gateway } = boundedGateway(['project-adversarial'], () => records);
  const result = await buildWorkspaceServerCatalog({
    gateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });

  expect(result.profile.workspaces[0]).toMatchObject({
    attempt: { id: 'attempt-a', revision: '9' },
    sessions: [{ id: 'retained-once', title: 'first' }],
    navigation: [{ destination: 'chat' }],
  });
  expect(result.omittedSessionCount).toBe(0);
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

test('reports exact successful and failed project scopes for partial merging', async () => {
  const { gateway } = fakeGateway(1);
  const records = await gateway.loadProject('project-1');
  const partialGateway = {
    ...gateway,
    authorizationScope: {
      ...gateway.authorizationScope,
      projectRoots: ['project-1', 'project-2'],
    },
    loadProject: jest.fn(async (project: string) => {
      if (project === 'project-2') throw new Error('temporarily_unavailable');
      return records;
    }),
  } as WorkspaceV2Gateway;

  const result = await buildWorkspaceServerCatalog({
    gateway: partialGateway,
    origin: 'https://ops.example.test',
    serverLabel: 'ops.example.test',
  });
  expect(result).toMatchObject({
    coverage: 'partial',
    successfulProjectIds: ['project-1'],
    failedProjectIds: ['project-2'],
    failedProjectCount: 1,
  });
});
