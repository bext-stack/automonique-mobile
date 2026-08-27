// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision } from './types';
import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from './workspace-fixtures';
import {
  MAX_WORKSPACE_REVISION_TOMBSTONES,
  admitWorkspaceAuthorityPreview,
  admitWorkspaceCompanionCatalog,
  admitWorkspaceDeepLink,
  admitWorkspaceIntentRequest,
  bindWorkspaceIntentPreview,
  reduceWorkspaceCompanionCatalog,
  selectScopedServer,
  workspaceMutationAvailability,
  type ServerIdentity,
} from './workspace-companion';

test('admits a bounded server-owned workspace projection', () => {
  const admitted = admitWorkspaceCompanionCatalog(
    JSON.parse(JSON.stringify(workspaceCompanionFixture)),
  );
  const workspace = admitted.servers[0]?.workspaces[0];

  expect(workspace).toMatchObject({
    externalWorkItem: { key: '#34', status: 'open' },
    orchestrationStatus: 'review',
    attempt: { state: 'waiting' },
    unreadAttention: 2,
  });
  expect(workspace?.repository).toEqual({
    label: 'bext-stack/automonique-mobile',
    webUrl: 'https://github.com/bext-stack/automonique-mobile',
  });
});

test('external work status never substitutes for orchestration status', () => {
  const value = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  value.servers[0].workspaces[0].externalWorkItem.status = 'done';
  value.servers[0].workspaces[0].orchestrationStatus = 'running';

  const workspace =
    admitWorkspaceCompanionCatalog(value).servers[0]?.workspaces[0];
  expect(workspace?.externalWorkItem?.status).toBe('done');
  expect(workspace?.orchestrationStatus).toBe('running');
});

test('rejects hidden capabilities, host paths, malformed origins, and scope breaks', () => {
  const credential = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  credential.servers[0].credential = 'secret';
  expect(() => admitWorkspaceCompanionCatalog(credential)).toThrow(
    'workspace_companion_invalid',
  );

  const hostPath = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  hostPath.servers[0].workspaces[0].repository.hostPath = '/srv/customer';
  expect(() => admitWorkspaceCompanionCatalog(hostPath)).toThrow(
    'workspace_companion_invalid',
  );

  const origin = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  origin.servers[0].origin = 'https://operator:password@example.test';
  expect(() => admitWorkspaceCompanionCatalog(origin)).toThrow(
    'workspace_companion_invalid',
  );

  const crossHost = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  crossHost.servers[0].workspaces[0].hostId = 'unscoped-host';
  expect(() => admitWorkspaceCompanionCatalog(crossHost)).toThrow(
    'workspace_companion_invalid',
  );
});

test('server selection uses the exact identity and refuses revocation', () => {
  const unknown = `sha256:${'b'.repeat(64)}` as ServerIdentity;
  expect(() => selectScopedServer(workspaceCompanionFixture, unknown)).toThrow(
    'workspace_server_not_authorized',
  );
  const revoked = {
    ...workspaceCompanionFixture,
    selectedServerIdentity: null,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      authorization: 'revoked' as const,
    })),
  };
  expect(() => selectScopedServer(revoked, WORKSPACE_FIXTURE_IDENTITY)).toThrow(
    'workspace_server_not_authorized',
  );
});

test('deep links bind server, workspace revision and retained session', () => {
  expect(
    admitWorkspaceDeepLink(workspaceCompanionFixture, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'chat',
      sessionId: 'session-34',
      sessionRevision: decimalRevision('9'),
    }),
  ).toEqual({
    pathname: '/workspace/[server]/[workspace]/session/[session]',
    params: {
      server: WORKSPACE_FIXTURE_IDENTITY,
      workspace: 'workspace-34',
      revision: '12',
      destination: 'chat',
      session: 'session-34',
      session_revision: '9',
    },
    readOnly: true,
  });

  expect(() =>
    admitWorkspaceDeepLink(workspaceCompanionFixture, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('11'),
      destination: 'chat',
      sessionId: 'session-34',
      sessionRevision: decimalRevision('9'),
    }),
  ).toThrow('workspace_navigation_not_authorized');

  expect(() =>
    admitWorkspaceDeepLink(workspaceCompanionFixture, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'chat',
      sessionId: 'session-34',
      sessionRevision: decimalRevision('8'),
    }),
  ).toThrow('workspace_navigation_not_authorized');
});

test('offline cache retains exact chat reads but drops review-backed destination authority', () => {
  const cached = {
    ...workspaceCompanionFixture,
    phase: 'stale' as const,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      authorization: 'cached' as const,
      actions: ['workspace_read' as const],
    })),
  };
  expect(
    admitWorkspaceDeepLink(cached, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'chat',
      sessionId: 'session-34',
      sessionRevision: decimalRevision('9'),
    }),
  ).toMatchObject({ readOnly: true });
  expect(() =>
    admitWorkspaceDeepLink(cached, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'files',
      sessionId: null,
      sessionRevision: null,
    }),
  ).toThrow('workspace_navigation_not_authorized');
});

test('replacement reduction rejects revision rollback and strips live authority', () => {
  const rollback = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  rollback.generatedAt = '2026-08-27T10:01:00Z';
  rollback.servers[0].workspaces[0].revision = '11';

  const result = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    rollback,
  );
  expect(result.resyncRequired).toBe(true);
  expect(result.catalog.phase).toBe('stale');
  expect(result.catalog.servers[0]).toMatchObject({
    authorization: 'cached',
    actions: ['workspace_read'],
  });
});

test('server identity pins tenant and origin across replacements', () => {
  for (const mutate of [
    (server: Record<string, unknown>) => {
      server.origin = 'https://other.example.test';
    },
    (server: Record<string, unknown>) => {
      server.tenantId = 'tenant-other';
    },
  ]) {
    const replacement = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replacement.generatedAt = '2026-08-27T10:01:00Z';
    replacement.servers[0].authorizationRevision = '9';
    mutate(replacement.servers[0]);
    expect(
      reduceWorkspaceCompanionCatalog(workspaceCompanionFixture, replacement)
        .resyncRequired,
    ).toBe(true);
  }
});

test('server omission leaves a durable tombstone and reactivation needs a newer authorization', () => {
  const omitted = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  omitted.generatedAt = '2026-08-27T10:01:00Z';
  omitted.selectedServerIdentity = null;
  omitted.servers = [];
  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    omitted,
  );

  expect(removal.resyncRequired).toBe(false);
  expect(removal.catalog.serverTombstones).toEqual([
    {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      origin: 'https://ops.example.test',
      tenantId: 'tenant-delivery',
      authorizationRevision: '8',
    },
  ]);

  const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  replay.generatedAt = '2026-08-27T10:02:00Z';
  replay.serverTombstones = [];
  expect(
    reduceWorkspaceCompanionCatalog(removal.catalog, replay).resyncRequired,
  ).toBe(true);

  replay.servers[0].authorizationRevision = '9';
  replay.servers[0].workspaces[0].revision = '13';
  replay.servers[0].workspaces[0].attempt.revision = '5';
  replay.servers[0].workspaces[0].sessions[0].revision = '10';
  const reauthorized = reduceWorkspaceCompanionCatalog(removal.catalog, replay);
  expect(reauthorized.resyncRequired).toBe(false);
  expect(reauthorized.catalog.serverTombstones).toEqual([]);
});

test('revocation retains newer nested high-water marks and rejects lower or equal reauthorization', () => {
  const revoked = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  revoked.generatedAt = '2026-08-27T10:01:00Z';
  revoked.selectedServerIdentity = null;
  revoked.servers[0].authorization = 'revoked';
  revoked.servers[0].authorizationRevision = '9';
  revoked.servers[0].workspaces[0].revision = '13';
  revoked.servers[0].workspaces[0].attempt.revision = '5';
  revoked.servers[0].workspaces[0].sessions[0].revision = '10';

  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    revoked,
  );
  expect(removal.resyncRequired).toBe(false);
  expect(removal.catalog.revisionTombstones).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectType: 'workspace',
        objectId: 'workspace-34',
        revision: '13',
      }),
      expect.objectContaining({
        objectType: 'attempt',
        objectId: 'attempt-34-a',
        revision: '5',
      }),
      expect.objectContaining({
        objectType: 'session',
        objectId: 'session-34',
        revision: '10',
      }),
    ]),
  );

  for (const [workspaceRevision, attemptRevision, sessionRevision] of [
    ['12', '5', '10'],
    ['13', '4', '10'],
    ['13', '5', '9'],
    ['13', '5', '10'],
  ]) {
    const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replay.generatedAt = '2026-08-27T10:02:00Z';
    replay.servers[0].authorizationRevision = '10';
    replay.servers[0].workspaces[0].revision = workspaceRevision;
    replay.servers[0].workspaces[0].attempt.revision = attemptRevision;
    replay.servers[0].workspaces[0].sessions[0].revision = sessionRevision;
    expect(
      reduceWorkspaceCompanionCatalog(removal.catalog, replay).resyncRequired,
    ).toBe(true);
  }
});

test('a foreign revision tombstone cannot pre-fence an unrelated server', () => {
  const foreignIdentity = `sha256:${'b'.repeat(64)}` as ServerIdentity;
  const replacement = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  replacement.revisionTombstones = [
    {
      objectType: 'workspace',
      serverIdentity: foreignIdentity,
      workspaceId: 'foreign',
      objectId: 'foreign',
      revision: decimalRevision('1'),
    },
  ];

  expect(() => admitWorkspaceCompanionCatalog(replacement)).toThrow(
    'workspace_companion_invalid',
  );
});

test('foreign revision tombstones cannot consume the admitted budget', () => {
  const foreignIdentity = `sha256:${'b'.repeat(64)}` as ServerIdentity;
  const foreignTombstones = Array.from(
    { length: MAX_WORKSPACE_REVISION_TOMBSTONES },
    (_, index) => ({
      objectType: 'workspace' as const,
      serverIdentity: foreignIdentity,
      workspaceId: `foreign-${index}`,
      objectId: `foreign-${index}`,
      revision: decimalRevision('1'),
    }),
  );
  const replacement = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  replacement.generatedAt = '2026-08-27T10:01:00Z';
  replacement.revisionTombstones = foreignTombstones;

  expect(() => admitWorkspaceCompanionCatalog(replacement)).toThrow(
    'workspace_companion_invalid',
  );
  const reduction = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    replacement,
  );
  expect(reduction.resyncRequired).toBe(true);
  expect(reduction.catalog.revisionTombstones).toEqual([]);
});

test('replacement reduction fences attempt and retained-session rollback', () => {
  for (const mutate of [
    (workspace: {
      attempt: { revision: string };
      sessions: { revision: string }[];
    }) => {
      workspace.attempt.revision = '3';
    },
    (workspace: {
      attempt: { revision: string };
      sessions: { revision: string }[];
    }) => {
      workspace.sessions[0]!.revision = '8';
    },
  ]) {
    const replacement = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replacement.generatedAt = '2026-08-27T10:01:00Z';
    mutate(replacement.servers[0].workspaces[0]);
    expect(
      reduceWorkspaceCompanionCatalog(workspaceCompanionFixture, replacement)
        .resyncRequired,
    ).toBe(true);
  }
});

test('workspace omission retains a revision fence across later reintroduction', () => {
  const omitted = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  omitted.generatedAt = '2026-08-27T10:01:00Z';
  omitted.servers[0].workspaces = [];
  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    omitted,
  );
  expect(removal.resyncRequired).toBe(false);
  expect(removal.catalog.revisionTombstones).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectType: 'workspace',
        objectId: 'workspace-34',
        revision: '12',
      }),
    ]),
  );

  for (const revision of ['11', '12']) {
    const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replay.generatedAt = '2026-08-27T10:02:00Z';
    replay.servers[0].workspaces[0].revision = revision;
    expect(
      reduceWorkspaceCompanionCatalog(removal.catalog, replay).resyncRequired,
    ).toBe(true);
  }
});

test('attempt omission retains a revision fence across later reintroduction', () => {
  const omitted = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  omitted.generatedAt = '2026-08-27T10:01:00Z';
  omitted.servers[0].workspaces[0].revision = '13';
  omitted.servers[0].workspaces[0].attempt = null;
  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    omitted,
  );
  expect(removal.resyncRequired).toBe(false);

  for (const revision of ['3', '4']) {
    const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replay.generatedAt = '2026-08-27T10:02:00Z';
    replay.servers[0].workspaces[0].revision = '14';
    replay.servers[0].workspaces[0].attempt.revision = revision;
    expect(
      reduceWorkspaceCompanionCatalog(removal.catalog, replay).resyncRequired,
    ).toBe(true);
  }
});

test('session omission retains a revision fence across later reintroduction', () => {
  const omitted = JSON.parse(JSON.stringify(workspaceCompanionFixture));
  omitted.generatedAt = '2026-08-27T10:01:00Z';
  omitted.servers[0].workspaces[0].revision = '13';
  omitted.servers[0].workspaces[0].sessions = [];
  const removal = reduceWorkspaceCompanionCatalog(
    workspaceCompanionFixture,
    omitted,
  );
  expect(removal.resyncRequired).toBe(false);

  for (const revision of ['8', '9']) {
    const replay = JSON.parse(JSON.stringify(workspaceCompanionFixture));
    replay.generatedAt = '2026-08-27T10:02:00Z';
    replay.servers[0].workspaces[0].revision = '14';
    replay.servers[0].workspaces[0].sessions[0].revision = revision;
    expect(
      reduceWorkspaceCompanionCatalog(removal.catalog, replay).resyncRequired,
    ).toBe(true);
  }
});

test('workspace visibility never infers terminal authority', () => {
  const withTerminalNavigation = {
    ...workspaceCompanionFixture,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      workspaces: server.workspaces.map((workspace) => ({
        ...workspace,
        navigation: [
          ...workspace.navigation,
          { destination: 'terminal' as const, revision: workspace.revision },
        ],
      })),
    })),
  };
  expect(() =>
    admitWorkspaceDeepLink(withTerminalNavigation, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'terminal',
      sessionId: null,
      sessionRevision: null,
    }),
  ).toThrow('workspace_terminal_not_authorized');
});

test('terminal navigation requires both an exact grant and separate live action', () => {
  const authorized = {
    ...workspaceCompanionFixture,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      actions: [...server.actions, 'terminal_relay' as const],
      workspaces: server.workspaces.map((workspace) => ({
        ...workspace,
        navigation: [
          ...workspace.navigation,
          { destination: 'terminal' as const, revision: workspace.revision },
        ],
      })),
    })),
  };
  expect(
    admitWorkspaceDeepLink(authorized, {
      serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
      workspaceId: 'workspace-34',
      workspaceRevision: decimalRevision('12'),
      destination: 'terminal',
      sessionId: null,
      sessionRevision: null,
    }),
  ).toMatchObject({ readOnly: false });

  expect(() =>
    admitWorkspaceDeepLink(
      { ...authorized, phase: 'stale' },
      {
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        workspaceId: 'workspace-34',
        workspaceRevision: decimalRevision('12'),
        destination: 'terminal',
        sessionId: null,
        sessionRevision: null,
      },
    ),
  ).toThrow('workspace_terminal_not_authorized');
});

test('task-prefilled intents and authority previews are strict data, not execution', () => {
  const request = admitWorkspaceIntentRequest({
    kind: 'create',
    serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
    hostId: 'host-fr-1',
    projectId: 'project-mobile',
    task: { provider: 'GitHub', key: '#34', title: 'Workspace companion' },
    idempotencyKey: 'mobile-workspace-34',
  });
  const preview = admitWorkspaceAuthorityPreview({
    schema: 'automonique.workspace-authority-preview/v1',
    action: 'create',
    serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
    requestIdempotencyKey: 'mobile-workspace-34',
    request,
    authorityRevision: '8',
    summary: ['May create one workspace on Paris builder'],
    expiresAt: '2026-08-27T10:05:00Z',
  });

  expect(request.kind).toBe('create');
  expect(preview.requestIdempotencyKey).toBe(request.idempotencyKey);
  expect(
    bindWorkspaceIntentPreview(
      workspaceCompanionFixture,
      request,
      preview,
      Date.parse('2026-08-27T10:00:00Z'),
    ),
  ).toMatchObject({ executable: false });
  expect(workspaceMutationAvailability()).toEqual({
    enabled: false,
    reason: 'server_project_scope_required',
  });
  expect(() =>
    admitWorkspaceIntentRequest({ ...request, shell: 'git status' }),
  ).toThrow('workspace_companion_invalid');
  if (request.kind !== 'create') throw new Error('expected_create_request');
  expect(() =>
    bindWorkspaceIntentPreview(
      workspaceCompanionFixture,
      {
        ...request,
        task: { ...request.task, title: 'Different exact request' },
      },
      preview,
      Date.parse('2026-08-27T10:00:00Z'),
    ),
  ).toThrow('workspace_intent_preview_not_authorized');
});

test('intent previews bind exact live scope and expiry', () => {
  const request = admitWorkspaceIntentRequest({
    kind: 'resume',
    serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
    sessionId: 'session-34',
    sessionRevision: '9',
    idempotencyKey: 'resume-34',
  });
  const preview = admitWorkspaceAuthorityPreview({
    schema: 'automonique.workspace-authority-preview/v1',
    action: 'resume',
    serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
    requestIdempotencyKey: 'resume-34',
    request,
    authorityRevision: '8',
    summary: ['May resume session-34'],
    expiresAt: '2026-08-27T10:05:00Z',
  });
  expect(
    bindWorkspaceIntentPreview(
      workspaceCompanionFixture,
      request,
      preview,
      Date.parse('2026-08-27T10:00:00Z'),
    ).executable,
  ).toBe(false);
  expect(() =>
    bindWorkspaceIntentPreview(
      workspaceCompanionFixture,
      request,
      preview,
      Date.parse('2026-08-27T10:06:00Z'),
    ),
  ).toThrow('workspace_intent_preview_not_authorized');
});
