// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import WorkspacesScreen from './app/(tabs)/workspaces';
import AttentionScreen from './app/(tabs)/attention';
import WorkspaceDetailScreen from './app/workspace/[server]/[workspace]';
import ExactWorkspaceSessionLink from './app/workspace/[server]/[workspace]/session/[session]';
import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from './core/workspace-fixtures';

let mockRouteParams: Record<string, string> = {};
const mockUseWorkspaces = jest.fn();
const mockUseMobile = jest.fn();
const mockUseMobileLifecycle = jest.fn();
const mockRedirect = jest.fn();
const mockRouterPush = jest.fn();
let mockLinkHrefs: readonly unknown[] = [];

jest.mock('expo-router', () => ({
  Link: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: unknown;
  }) => {
    mockLinkHrefs = [...mockLinkHrefs, href];
    return children;
  },
  Redirect: ({ href }: { readonly href: unknown }) => {
    mockRedirect(href);
    return null;
  },
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => ({ push: mockRouterPush }),
}));
jest.mock('@/providers/workspace-provider', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));
jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => mockUseMobile(),
}));
jest.mock('@/providers/production-mobile-provider', () => ({
  useMobileLifecycle: () => mockUseMobileLifecycle(),
}));
jest.mock('@/theme/palette', () => ({
  usePalette: () => ({
    accent: '#070',
    accentText: '#fff',
    background: '#fff',
    border: '#ddd',
    surface: '#fff',
    surfaceMuted: '#eee',
    text: '#000',
    textMuted: '#666',
    warning: '#850',
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

const reviewSnapshot = {
  schema: 'automonique.platform/review/v2',
  platform_version: 2n,
  revision: 7n,
  workspace: { kind: 'user_workspace', id: 'workspace-34' },
  attention: {
    reason: 'approval_required',
    source_revision: 3n,
    state: 'needs_you',
    unread: 2n,
  },
  attention_events: [
    {
      id: 'attention-approval-1',
      origin: {
        authority: { kind: 'review', id: 'review-local' },
        id: null,
        kind: 'review',
        revision: 3n,
      },
      reason: 'approval_required',
      unread: 2n,
    },
  ],
  files: [
    {
      id: 'file-1',
      path: 'src/typed.ts',
      change: 'modified',
      conflict: 'none',
      worktree: 'unstaged',
      preview: {
        byte_size: 20n,
        height: null,
        kind: 'text',
        media_type: 'text/plain',
        sanitized: true,
        width: null,
      },
      hunks: [
        {
          id: 'hunk-1',
          old_start: 1n,
          old_lines: 1n,
          new_start: 1n,
          new_lines: 1n,
          preview: '-old\n+new',
        },
      ],
    },
  ],
  checks: [],
  comments: [],
  proposals: [],
  review: {
    authority: { kind: 'review', id: 'review-local' },
    decision: 'changes_requested',
    freshness: {
      observed_at_ms: 1n,
      observed_revision: 3n,
      state: 'fresh',
    },
  },
  pull_request: {
    authority: { kind: 'pull_request', id: 'pr-local' },
    freshness: {
      observed_at_ms: 1n,
      observed_revision: 1n,
      state: 'fresh',
    },
    head_revision: 'abc',
    id: '34',
    readiness: 'ready',
    state: 'open',
  },
  delivery: {
    authority: { kind: 'delivery', id: 'delivery-local' },
    freshness: {
      observed_at_ms: 1n,
      observed_revision: 1n,
      state: 'fresh',
    },
    id: null,
    state: 'not_delivered',
  },
};

const detail = {
  serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
  workspaceId: 'workspace-34',
  workspaceRevision: '12',
  lineageAvailable: true,
  lineage: null,
  sessionBindings: [],
  review: {
    snapshot: reviewSnapshot,
    revision: '7',
    attentionState: 'needs_you',
    unread: 2,
    files: [
      {
        id: 'file-1',
        path: 'src/typed.ts',
        change: 'modified',
        worktree: 'unstaged',
        conflict: 'none',
        previewKind: 'text',
        sanitized: true,
        hunks: [
          {
            id: 'hunk-1',
            oldStart: '1',
            oldLines: '1',
            newStart: '1',
            newLines: '1',
            preview: '-old\n+new',
          },
        ],
      },
    ],
    pullRequestState: 'open',
    pullRequestId: '34',
    reviewDecision: 'changes_requested',
    deliveryState: 'not_started',
    attentionReason: 'approval_required',
    comments: [],
    checks: [],
    proposals: [],
    reviewAuthority: reviewSnapshot.review.authority,
    reviewFreshness: reviewSnapshot.review.freshness,
    pullRequest: reviewSnapshot.pull_request,
    delivery: reviewSnapshot.delivery,
  },
};

function workspaceValue() {
  const server = workspaceCompanionFixture.servers[0]!;
  const workspace = server.workspaces[0]!;
  return {
    catalog: workspaceCompanionFixture,
    status: {
      phase: 'live',
      coverage: 'partial',
      message: 'Current inventory with bounded detail reads',
      omittedDetailCount: 1,
      omittedProjectCount: 0,
      omittedHostCount: 0,
      omittedWorkspaceCount: 0,
      omittedSessionCount: 0,
      failedProjectCount: 0,
      failedDetailCount: 1,
    },
    serverStatuses: {
      [server.serverIdentity]: {
        phase: 'live',
        coverage: 'partial',
        message: 'Current inventory with bounded detail reads',
        omittedDetailCount: 1,
        omittedProjectCount: 0,
        omittedHostCount: 0,
        omittedWorkspaceCount: 0,
        omittedSessionCount: 0,
        failedProjectCount: 0,
        failedDetailCount: 1,
      },
    },
    details: [detail],
    workspaceMutationBusy: false,
    pendingWorkspaceMutationReceipts: [],
    prepareWorkspaceMutation: jest.fn(),
    confirmWorkspaceMutation: jest.fn(),
    reconcileWorkspaceMutation: jest.fn(),
    refresh: jest.fn(),
    selectServer: jest.fn(),
    findServer: (identity: string) =>
      identity === WORKSPACE_FIXTURE_IDENTITY ? server : null,
    findWorkspace: (identity: string, id: string) =>
      identity === WORKSPACE_FIXTURE_IDENTITY && id === workspace.id
        ? workspace
        : null,
    findDetail: (identity: string, id: string) =>
      identity === WORKSPACE_FIXTURE_IDENTITY && id === workspace.id
        ? detail
        : null,
  };
}

function mutationLifecycle() {
  const server = workspaceCompanionFixture.servers[0]!;
  return {
    state: {
      phase: 'ready',
      profile: { serverIdentity: server.serverIdentity },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: server.serverIdentity,
        tenantId: server.tenantId,
        authorizationRevision: 8n,
        principalGeneration: 3n,
        delegationId: 'delegation-mobile',
        expiresAtMs: BigInt(Date.now() + 60_000),
        projectRoots: ['project-mobile'],
        actions: ['prepare_mutation', 'get_mutation_receipt'],
      },
      reviewEffectKinds: [],
    },
  };
}

function preparedMutation() {
  const emptyAuthority = {
    credentials: [],
    filesystem: [],
    models: [],
    network: [],
    providers: [],
    tools: [],
  };
  return {
    project: 'project-mobile',
    previewDigest: `sha256:${'1'.repeat(64)}`,
    preview: {
      proposal: {
        intent: { kind: 'create_attempt_workspace' },
      },
      inherited_authority: emptyAuthority,
      effective_authority: emptyAuthority,
      resulting: { label: 'GitHub #34', lifecycle: 'planned' },
      preview: { revision: 13n },
      approval: 'required',
      expires_at_ms: BigInt(Date.now() + 60_000),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLinkHrefs = [];
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
  mockUseMobile.mockReturnValue({
    snapshot: {
      connection: {
        phase: 'live',
        label: 'Live',
        mutationsAllowed: false,
        synthetic: false,
        allowedActions: [],
        limits: { maxPageEvents: 10, maxFollowUpBytes: 100 },
      },
      sessions: [
        {
          target: {
            coordinate: {
              authority: 'automonique',
              kind: 'session',
              id: 'session-34',
            },
            revision: '9',
          },
        },
      ],
    },
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: null,
  });
  mockUseWorkspaces.mockReturnValue(workspaceValue());
  mockRouteParams = {};
});

test('review route shows bounded sanitized hunks and keeps unsupported mutations explicitly disabled', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValue(new Error('storage unavailable'));
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const withReview = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review', revision: workspace.revision },
    ],
  };
  const catalog = {
    ...base.catalog,
    servers: [
      {
        ...server,
        workspaces: [withReview],
      },
    ],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog,
    reviewBusy: false,
    reviewReceipts: [],
    pendingReviewReceipts: [],
    executeReviewAction: jest.fn(),
    reconcileReviewAction: jest.fn(),
    findWorkspace: () => withReview,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        actions: ['get_review'],
      },
      reviewEffectKinds: [],
    },
  });
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
    destination: 'review',
    review_revision: '7',
    file: 'file-1',
    hunk: 'hunk-1',
  };
  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(view.getByLabelText(/Sanitized diff preview/)).toBeTruthy(),
  );
  expect(view.getByText('-old\n+new')).toBeTruthy();
  expect(view.getByLabelText(/Approve review, unavailable/)).toBeDisabled();
  expect(view.getByLabelText(/Batch send comments/)).toBeDisabled();
  await waitFor(() =>
    expect(
      view.getByText(/Local draft persistence failed · not ready to send/),
    ).toBeTruthy(),
  );
  expect(view.getByText(/local drafts are not sent to an agent/)).toBeTruthy();
});

test('unsupported typed review families stay inert with exact adapter categories', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const withReview = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review', revision: workspace.revision },
    ],
  };
  const unsupportedSnapshot = {
    ...detail.review.snapshot,
    comments: [
      {
        actor: 'operator-mobile',
        agent_state: 'not_sent',
        anchor: { file_id: 'file-1', hunk_id: 'hunk-1', line: 1n, side: 'new' },
        body: 'Exact persisted comment',
        id: 'comment-1',
        revision: 4n,
        unread: false,
      },
    ],
    checks: [
      {
        authority: { kind: 'ci', id: 'ci-local' },
        freshness: {
          observed_at_ms: 1n,
          observed_revision: 5n,
          state: 'fresh',
        },
        id: 'check-1',
        required: true,
        state: 'failed',
      },
    ],
  };
  const unsupportedDetail = {
    ...detail,
    review: {
      ...detail.review,
      snapshot: unsupportedSnapshot,
      comments: unsupportedSnapshot.comments,
      checks: unsupportedSnapshot.checks,
    },
  };
  const executeReviewAction = jest.fn();
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: {
      ...base.catalog,
      servers: [{ ...server, workspaces: [withReview] }],
    },
    details: [unsupportedDetail],
    reviewBusy: false,
    reviewReceipts: [],
    pendingReviewReceipts: [],
    executeReviewAction,
    reconcileReviewAction: jest.fn(),
    findWorkspace: () => withReview,
    findDetail: () => unsupportedDetail,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        actions: ['get_review', 'execute_review_action', 'get_review_receipt'],
      },
      reviewEffectKinds: ['add_comment', 'approve_review'],
    },
  });
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: 'review',
    review_revision: detail.review.revision,
  };
  const view = await render(<WorkspaceDetailScreen />);
  expect(view.getByText(/attention\.needs_you · 2 unread/)).toBeTruthy();
  expect(
    view.getByText(/attention_reason\.approval_required · source revision 3/),
  ).toBeTruthy();
  expect(
    view.getByText(
      /review\.changes_requested · freshness\.fresh · source revision 3/,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(
      /check\.failed\.required · freshness\.fresh · source revision 5/,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(
      /pull_request\.open\.ready · freshness\.fresh · source revision 1/,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(
      /delivery\.not_delivered · freshness\.fresh · source revision 1/,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(/preview\.text\.sanitized · source revision 7/),
  ).toBeTruthy();
  const expectations = [
    [
      'Batch send comments to agent',
      'platform_v2_review_agent_adapter_unavailable',
    ],
    [
      'Send comment comment-1 to agent',
      'platform_v2_review_agent_adapter_unavailable',
    ],
    ['Rerun check check-1', 'platform_v2_review_ci_adapter_unavailable'],
    [
      'Open pull request',
      'platform_v2_review_pull_request_adapter_unavailable',
    ],
    [
      'Update pull request',
      'platform_v2_review_pull_request_adapter_unavailable',
    ],
    [
      'Merge pull request',
      'platform_v2_review_pull_request_adapter_unavailable',
    ],
  ] as const;
  for (const [label, category] of expectations) {
    const control = view.getByLabelText(`${label}, unavailable: ${category}`);
    expect(control).toBeDisabled();
    fireEvent.press(control);
  }
  expect(executeReviewAction).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Exact review action confirmation')).toBeNull();
});

test('attention truthfully separates local exact deep links from unavailable push admission', async () => {
  const base = workspaceValue();
  mockUseWorkspaces.mockReturnValue({
    ...base,
    notificationPermission: 'granted',
    requestReviewNotificationPermission: jest.fn(),
  });
  const view = await render(<AttentionScreen />);
  expect(
    view.getByText(
      /OS background push, EAS delivery, and physical-device admission are unavailable/,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(/exact, revalidated workspace coordinates/),
  ).toBeTruthy();
});

test('attention exposes structured parents and admits only exact review and retained-session anchors', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const reviewWorkspace = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review' as const, revision: workspace.revision },
    ],
  };
  const anchoredSnapshot = {
    ...reviewSnapshot,
    attention: {
      reason: 'comment_reply',
      source_revision: 5n,
      state: 'needs_you',
      unread: 1n,
    },
    attention_events: [
      {
        id: 'attention-comment-1',
        origin: {
          authority: reviewSnapshot.review.authority,
          id: 'comment-1',
          kind: 'comment',
          revision: 5n,
        },
        reason: 'comment_reply',
        unread: 1n,
      },
    ],
    comments: [
      {
        actor: 'reviewer',
        agent_state: 'not_sent',
        anchor: {
          file_id: 'file-1',
          hunk_id: 'hunk-1',
          line: 1n,
          side: 'new',
        },
        body: 'Inspect the exact line.',
        id: 'comment-1',
        revision: 5n,
        unread: true,
      },
    ],
  };
  const lineage = {
    workspace: workspace.id,
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'task', id: 'task-34' },
        parent: null,
        origin: {
          workspace: workspace.id,
          attempt: 'attempt-34-a',
          session: null,
          pane: null,
        },
        status: { kind: 'working' },
        revision: 6n,
        latest_useful_message: { text: 'Coordinate the exact change' },
      },
      {
        identity: { kind: 'question', id: 'question-34' },
        parent: { kind: 'task', id: 'task-34' },
        origin: {
          workspace: workspace.id,
          attempt: 'attempt-34-a',
          session: 'work-session-34',
          pane: null,
        },
        status: { kind: 'waiting', reason: 'Inspect exact session' },
        revision: 7n,
        latest_useful_message: { text: 'Inspect exact session' },
      },
    ],
  };
  const structuredDetail = {
    ...detail,
    lineageAvailable: true,
    lineage,
    sessionBindings: [
      {
        workSessionId: 'work-session-34',
        attemptWorkspaceId: 'attempt-34-a',
        retainedSessionId: 'session-34',
      },
    ],
    review: {
      ...detail.review,
      snapshot: anchoredSnapshot,
      attentionReason: 'comment_reply',
      unread: 1,
    },
  };
  const catalog = {
    ...base.catalog,
    servers: [{ ...server, workspaces: [reviewWorkspace] }],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog,
    details: [structuredDetail],
    notificationPermission: 'granted',
    requestReviewNotificationPermission: jest.fn(),
  });

  const view = await render(<AttentionScreen />);

  expect(
    view.getByLabelText(
      'Needs You. comment reply. Review summary. 1 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
    ),
  ).not.toBeDisabled();
  expect(
    view.getByLabelText(
      'Needs You. Inspect exact session. Nested under Coordinate the exact change. 0 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
    ),
  ).not.toBeDisabled();
  expect(
    view.getByText('Nested under Coordinate the exact change'),
  ).toBeTruthy();
  expect(mockLinkHrefs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        pathname: '/workspace/[server]/[workspace]',
        params: expect.objectContaining({ file: 'file-1', hunk: 'hunk-1' }),
      }),
      expect.objectContaining({
        pathname: '/workspace/[server]/[workspace]/session/[session]',
        params: expect.objectContaining({
          session: 'session-34',
          work_session: 'work-session-34',
          tenant: 'tenant-delivery',
          relation_revision: '9',
          session_revision: '9',
          principal_generation: '3',
          authorization_revision: '8',
        }),
      }),
    ]),
  );
  const retainedSessionHref = mockLinkHrefs.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'pathname' in candidate &&
      candidate.pathname ===
        '/workspace/[server]/[workspace]/session/[session]',
  ) as { readonly params: Record<string, string> } | undefined;
  expect(retainedSessionHref).toBeDefined();

  mockRouteParams = retainedSessionHref!.params;
  await render(<ExactWorkspaceSessionLink />);
  expect(mockRedirect).toHaveBeenCalledWith({
    pathname: '/session/[id]',
    params: expect.objectContaining({
      id: 'session-34',
      scope_principal_generation: '3',
      scope_authorization_revision: '8',
    }),
  });

  mockRedirect.mockClear();
  mockRouteParams = {
    ...retainedSessionHref!.params,
    principal_generation: '2',
  };
  const refused = await render(<ExactWorkspaceSessionLink />);
  expect(mockRedirect).not.toHaveBeenCalled();
  expect(refused.getByText('Retained session unavailable')).toBeTruthy();
  expect(
    view.getByLabelText('Enable local review notifications'),
  ).toBeDisabled();
});

test('attention disables a nested session when the selected live scope is foreign', async () => {
  const base = workspaceValue();
  const lineage = {
    workspace: detail.workspaceId,
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'worker', id: 'worker-34' },
        parent: null,
        origin: {
          workspace: detail.workspaceId,
          attempt: 'attempt-34-a',
          session: 'work-session-34',
          pane: null,
        },
        status: { kind: 'blocked', reason: 'Needs exact retained session' },
        revision: 7n,
        latest_useful_message: { text: 'Needs exact retained session' },
      },
    ],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    details: [
      {
        ...detail,
        lineageAvailable: true,
        lineage,
        sessionBindings: [
          {
            workSessionId: 'work-session-34',
            attemptWorkspaceId: 'attempt-34-a',
            retainedSessionId: 'session-34',
          },
        ],
      },
    ],
    notificationPermission: 'undetermined',
    requestReviewNotificationPermission: jest.fn(),
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: `sha256:${'b'.repeat(64)}` },
    },
    workspaceGateway: null,
  });

  const view = await render(<AttentionScreen />);
  const worker = view.getByLabelText(
    'Blocked. Needs exact retained session. Top-level orchestration. 0 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
  );
  expect(worker).toBeDisabled();
  expect(worker).toHaveProp('accessibilityState', { disabled: true });
  expect(worker).toHaveProp(
    'accessibilityHint',
    'No exact current navigation coordinate is available.',
  );
});

test('attention renders and links authoritative lineage when review is unavailable', async () => {
  const base = workspaceValue();
  const lineage = {
    workspace: detail.workspaceId,
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'question', id: 'question-lineage-only' },
        parent: null,
        origin: {
          workspace: detail.workspaceId,
          attempt: 'attempt-34-a',
          session: 'work-session-34',
          pane: null,
        },
        status: { kind: 'waiting', reason: 'Inspect retained context' },
        revision: 8n,
        latest_useful_message: { text: 'Inspect retained context' },
      },
    ],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    details: [
      {
        ...detail,
        lineageAvailable: true,
        lineage,
        sessionBindings: [
          {
            workSessionId: 'work-session-34',
            attemptWorkspaceId: 'attempt-34-a',
            retainedSessionId: 'session-34',
          },
        ],
        review: null,
      },
    ],
    notificationPermission: 'denied',
    requestReviewNotificationPermission: jest.fn(),
  });

  const view = await render(<AttentionScreen />);

  expect(
    view.getByLabelText(
      'Needs You. Inspect retained context. Top-level orchestration. 0 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
    ),
  ).not.toBeDisabled();
  expect(view.getByText(/review revision unavailable/)).toBeTruthy();
  expect(mockLinkHrefs).toContainEqual({
    pathname: '/workspace/[server]/[workspace]/session/[session]',
    params: expect.objectContaining({
      session: 'session-34',
      principal_generation: '3',
      authorization_revision: '8',
    }),
  });
});

test('attention disambiguates identical multi-server nodes and preserves the surviving exact route', async () => {
  const base = workspaceValue();
  const primary = base.catalog.servers[0]!;
  const workspace = primary.workspaces[0]!;
  const reviewWorkspace = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review' as const, revision: workspace.revision },
    ],
  };
  const secondaryIdentity =
    `sha256:${'b'.repeat(64)}` as typeof WORKSPACE_FIXTURE_IDENTITY;
  const primaryServer = { ...primary, workspaces: [reviewWorkspace] };
  const secondaryServer = {
    ...primaryServer,
    serverIdentity: secondaryIdentity,
    label: 'Delivery Americas',
    origin: 'https://ops-us.example.test',
    tenantId: 'tenant-delivery-us',
  };
  const primaryDetail = { ...detail };
  const secondaryDetail = {
    ...detail,
    serverIdentity: secondaryIdentity,
  };
  const twoServerCatalog = {
    ...base.catalog,
    servers: [primaryServer, secondaryServer],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: twoServerCatalog,
    details: [primaryDetail, secondaryDetail],
    notificationPermission: 'denied',
    requestReviewNotificationPermission: jest.fn(),
  });

  const view = await render(<AttentionScreen />);

  const primaryCard = view.getByLabelText(
    'Needs You. approval required. Review summary. 2 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
  );
  const secondaryCard = view.getByLabelText(
    'Needs You. approval required. Review summary. 2 unread. Read-mostly workspace companion. Server Delivery Americas · https://ops-us.example.test.',
  );
  expect(primaryCard).not.toBeDisabled();
  expect(secondaryCard).not.toBeDisabled();
  expect(
    view.getByText(/Delivery Europe · https:\/\/ops\.example\.test/),
  ).toBeTruthy();
  expect(
    view.getByText(/Delivery Americas · https:\/\/ops-us\.example\.test/),
  ).toBeTruthy();
  const reviewHrefs = mockLinkHrefs.filter(
    (
      candidate,
    ): candidate is {
      readonly pathname: string;
      readonly params: Readonly<Record<string, string>>;
    } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'pathname' in candidate &&
      candidate.pathname === '/workspace/[server]/[workspace]',
  );
  expect(reviewHrefs).toHaveLength(2);
  expect(reviewHrefs.map((href) => href.params.server).sort()).toEqual(
    [WORKSPACE_FIXTURE_IDENTITY, secondaryIdentity].sort(),
  );

  mockLinkHrefs = [];
  const remainingCatalog = {
    ...twoServerCatalog,
    selectedServerIdentity: secondaryIdentity,
    servers: [secondaryServer],
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: remainingCatalog,
    details: [secondaryDetail],
    notificationPermission: 'denied',
    requestReviewNotificationPermission: jest.fn(),
  });
  await act(async () => {
    view.rerender(<AttentionScreen />);
    await Promise.resolve();
  });

  expect(
    view.queryByLabelText(
      'Needs You. approval required. Review summary. 2 unread. Read-mostly workspace companion. Server Delivery Europe · https://ops.example.test.',
    ),
  ).toBeNull();
  expect(
    view.getByLabelText(
      'Needs You. approval required. Review summary. 2 unread. Read-mostly workspace companion. Server Delivery Americas · https://ops-us.example.test.',
    ),
  ).not.toBeDisabled();
  expect(mockLinkHrefs).toEqual([
    expect.objectContaining({
      pathname: '/workspace/[server]/[workspace]',
      params: expect.objectContaining({ server: secondaryIdentity }),
    }),
  ]);
});

test('attention renders idle as idle with no invented source revision', async () => {
  const base = workspaceValue();
  const idleSnapshot = {
    ...detail.review.snapshot,
    attention: {
      reason: null,
      source_revision: null,
      state: 'idle',
      unread: 0n,
    },
  };
  const idleDetail = {
    ...detail,
    review: {
      ...detail.review,
      snapshot: idleSnapshot,
      attentionState: 'idle',
      attentionReason: null,
      unread: 0,
    },
  };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    details: [idleDetail],
    notificationPermission: 'denied',
    requestReviewNotificationPermission: jest.fn(),
  });
  const view = await render(<AttentionScreen />);
  expect(view.getByText('Idle')).toBeTruthy();
  expect(
    view.getByText(/attention\.idle · source revision not applicable/),
  ).toBeTruthy();
  expect(view.queryByText('Done')).toBeNull();
});

test('workspace review refuses a full gateway selected for another server', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const withReview = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review', revision: workspace.revision },
    ],
  };
  const executeReviewAction = jest.fn();
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: {
      ...base.catalog,
      servers: [{ ...server, workspaces: [withReview] }],
    },
    executeReviewAction,
    findWorkspace: () => withReview,
    selectServer: jest.fn().mockResolvedValue(undefined),
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: `sha256:${'f'.repeat(64)}` },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: `sha256:${'f'.repeat(64)}`,
        actions: ['get_review', 'execute_review_action'],
      },
      reviewEffectKinds: ['add_comment', 'approve_review'],
    },
  });
  mockRouteParams = {
    server: server.serverIdentity,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: 'review',
    review_revision: detail.review.revision,
  };

  const view = await render(<WorkspaceDetailScreen />);
  expect(
    view.getByText(
      'This destination is unavailable for the exact current workspace grant and revision.',
    ),
  ).toBeTruthy();
  expect(view.queryByLabelText('Approve review')).toBeNull();
  expect(executeReviewAction).not.toHaveBeenCalled();
});

test('review approval requires an exact preview before one revision-bound mutation', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const withReview = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review', revision: workspace.revision },
    ],
  };
  const executeReviewAction = jest.fn().mockImplementation((options) =>
    Promise.resolve({
      kind: 'ambiguous',
      idempotencyKey: options.idempotencyKey,
      receipt: null,
      projectionRefreshRequired: true,
    }),
  );
  const reconcileReviewAction = jest.fn().mockImplementation((key) =>
    Promise.resolve({
      handle: { idempotency_key: key },
      receipt: {
        schema: 'automonique.platform/review/v1',
        platform_version: 2n,
        receipt_id: 'receipt-mobile-review-test',
        action_id: 'action-mobile-review-test',
        idempotency_key: key,
        actor: 'mobile-actor',
        outcome: 'completed',
        reconciliation: 'final',
        revision: 8n,
        current_revision: null,
      },
      projectionRefreshRequired: true,
    }),
  );
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: {
      ...base.catalog,
      servers: [
        {
          ...server,
          workspaces: [withReview],
        },
      ],
    },
    reviewBusy: false,
    reviewReceipts: [],
    pendingReviewReceipts: [],
    executeReviewAction,
    reconcileReviewAction,
    findWorkspace: () => withReview,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        actions: ['get_review', 'execute_review_action'],
      },
      reviewEffectKinds: ['add_comment', 'approve_review'],
    },
  });
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: 'review',
    review_revision: detail.review.revision,
  };

  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(view.getByLabelText('Approve review')).not.toBeDisabled(),
  );
  fireEvent.press(view.getByLabelText('Approve review'));

  expect(executeReviewAction).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      view.getByLabelText('Exact review action confirmation'),
    ).toBeTruthy(),
  );
  expect(
    view.getByText(
      `Workspace ${workspace.id} · workspace revision ${workspace.revision} · review revision ${detail.review.revision} · action approve review`,
    ),
  ).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm exact review action'));
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(executeReviewAction).toHaveBeenCalledTimes(1));
  expect(executeReviewAction).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      reviewRevision: detail.review.revision,
      authority: reviewSnapshot.review.authority,
      action: {
        kind: 'approve_review',
        payload: { expected_review_revision: 3n },
      },
      idempotencyKey: expect.stringMatching(/^mobile-review-/u),
    }),
  );
  const exactKey = executeReviewAction.mock.calls[0]![0].idempotencyKey;
  await waitFor(() =>
    expect(view.getByLabelText('Reconcile exact review receipt')).toBeTruthy(),
  );
  expect(view.queryByLabelText('Confirm exact review action')).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByLabelText('Reconcile exact review receipt'));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reconcileReviewAction).toHaveBeenCalledWith(exactKey);
  await waitFor(() =>
    expect(
      view.queryByLabelText('Exact review action confirmation'),
    ).toBeNull(),
  );
});

test('a completed comment with failed local cleanup can only retry local cleanup', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const withReview = {
    ...workspace,
    navigation: [
      ...workspace.navigation,
      { destination: 'review', revision: workspace.revision },
    ],
  };
  let completedRemotely = false;
  let cleanupRejected = false;
  const executeReviewAction = jest.fn().mockImplementation((options) => {
    completedRemotely = true;
    return Promise.resolve({
      kind: 'settled',
      idempotencyKey: options.idempotencyKey,
      receipt: {
        idempotency_key: options.idempotencyKey,
        outcome: 'completed',
      },
      projectionRefreshRequired: true,
    });
  });
  const reconcileReviewAction = jest.fn();
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: {
      ...base.catalog,
      servers: [{ ...server, workspaces: [withReview] }],
    },
    reviewBusy: false,
    reviewReceipts: [],
    pendingReviewReceipts: [],
    executeReviewAction,
    reconcileReviewAction,
    findWorkspace: () => withReview,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: {
        serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
        actions: ['get_review', 'execute_review_action'],
      },
      reviewEffectKinds: ['add_comment', 'approve_review'],
    },
  });
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: 'review',
    review_revision: detail.review.revision,
    file: 'file-1',
    hunk: 'hunk-1',
  };
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => {
    const isEmptyReviewDraftWrite =
      key === 'automonique.mobile.review-drafts.v1' &&
      (JSON.parse(value) as { readonly drafts?: readonly unknown[] }).drafts
        ?.length === 0;
    if (completedRemotely && isEmptyReviewDraftWrite && !cleanupRejected) {
      cleanupRejected = true;
      return Promise.reject(new Error('draft clear failed'));
    }
    return Promise.resolve();
  });

  const view = await render(<WorkspaceDetailScreen />);
  const draft = await view.findByLabelText(
    'Comment draft for file-1, hunk hunk-1, new line 1',
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.changeText(draft, 'Please preserve this anchor');
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(view.getByLabelText('Add persisted comment')).not.toBeDisabled(),
  );
  await act(async () => {
    fireEvent.press(view.getByLabelText('Add persisted comment'));
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(view.getByLabelText('Confirm exact review action')).toBeTruthy(),
  );
  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm exact review action'));
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(
      view.getByLabelText('Retry completed review local cleanup'),
    ).toBeTruthy(),
  );
  expect(executeReviewAction).toHaveBeenCalledTimes(1);
  expect(reconcileReviewAction).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Confirm exact review action')).toBeNull();
  expect(view.queryByLabelText('Reconcile exact review receipt')).toBeNull();
  expect(view.getByLabelText('Cancel review action')).toBeDisabled();

  await act(async () => {
    fireEvent.press(
      view.getByLabelText('Retry completed review local cleanup'),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(
      view.queryByLabelText('Exact review action confirmation'),
    ).toBeNull(),
  );
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(executeReviewAction).toHaveBeenCalledTimes(1);
  expect(reconcileReviewAction).not.toHaveBeenCalled();
});
test('discovery keeps external and orchestration status separate and labels partial coverage', async () => {
  const view = await render(<WorkspacesScreen />);
  expect(view.getByText('Orchestration: review')).toBeTruthy();
  expect(view.getByText('External: GitHub #34 · open')).toBeTruthy();
  expect(view.getByText(/Partial coverage/)).toBeTruthy();
  expect(
    view.getByLabelText(
      'Open Read-mostly workspace companion on Paris builder',
    ),
  ).toBeTruthy();
});

test('search spans servers and waits for exact slot selection before navigation', async () => {
  const base = workspaceValue();
  const first = base.catalog.servers[0]!;
  const secondIdentity =
    `sha256:${'c'.repeat(64)}` as typeof first.serverIdentity;
  const secondWorkspace = {
    ...first.workspaces[0]!,
    id: 'workspace-second',
    title: 'Needle on second server',
  };
  const second = {
    ...first,
    serverIdentity: secondIdentity,
    origin: 'https://second.example.test',
    tenantId: 'tenant-second',
    label: 'Second server',
    workspaces: [secondWorkspace],
  };
  const selectServer = jest.fn().mockResolvedValue(undefined);
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: { ...base.catalog, servers: [first, second] },
    selectServer,
  });
  const view = await render(<WorkspacesScreen />);
  expect(view.queryByText(secondWorkspace.title)).toBeNull();
  fireEvent.changeText(
    view.getByLabelText(
      'Search projects, hosts, workspaces, and external tasks',
    ),
    'Needle',
  );
  const result = await view.findByLabelText(
    `Open ${secondWorkspace.title} on ${first.hosts[0]!.label}`,
  );
  await act(async () => {
    fireEvent.press(result);
    await Promise.resolve();
  });
  expect(selectServer).toHaveBeenCalledWith(secondIdentity);
  await waitFor(() =>
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/workspace/[server]/[workspace]',
      params: {
        server: secondIdentity,
        workspace: secondWorkspace.id,
        revision: secondWorkspace.revision,
      },
    }),
  );
  expect(selectServer.mock.invocationCallOrder[0]).toBeLessThan(
    mockRouterPush.mock.invocationCallOrder[0]!,
  );
});

test('an exact live workspace deep link hands retained-session authority to its slot', async () => {
  const base = workspaceValue();
  const server = base.catalog.servers[0]!;
  const workspace = server.workspaces[0]!;
  const selectServer = jest.fn().mockResolvedValue(undefined);
  mockUseWorkspaces.mockReturnValue({ ...base, selectServer });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: `sha256:${'d'.repeat(64)}` },
    },
    workspaceGateway: null,
  });
  mockRouteParams = {
    server: server.serverIdentity,
    workspace: workspace.id,
    revision: workspace.revision,
  };

  await render(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(selectServer).toHaveBeenCalledWith(server.serverIdentity),
  );
});

test('workspace detail exposes exact retained chat while mutations and terminal stay disabled', async () => {
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
  };
  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());

  expect(view.getByText('External work item')).toBeTruthy();
  expect(view.getByText('External work status: open')).toBeTruthy();
  expect(view.getByText('Orchestration status')).toBeTruthy();
  expect(view.getByText('Branch: feat/workspace-companion-34')).toBeTruthy();
  expect(view.getByLabelText(/Terminal, unavailable/)).toBeDisabled();
  expect(view.getByLabelText(/Create from task, unavailable/)).toBeDisabled();
  expect(view.getByText(/No offline mutation is queued/)).toBeTruthy();
});

test('create from task shows exact selected authority before one explicit confirmation', async () => {
  const base = workspaceValue();
  const prepareWorkspaceMutation = jest
    .fn()
    .mockResolvedValue(preparedMutation());
  const confirmWorkspaceMutation = jest.fn().mockImplementation((prepared) =>
    Promise.resolve({
      kind: 'ambiguous',
      idempotencyKey: 'mobile-create-34',
      projectionRefreshRequired: true,
      prepared,
    }),
  );
  mockUseWorkspaces.mockReturnValue({
    ...base,
    prepareWorkspaceMutation,
    confirmWorkspaceMutation,
  });
  mockUseMobileLifecycle.mockReturnValue(mutationLifecycle());
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
  };
  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(
      view.getByDisplayValue(
        'GitHub #34: Add a read-mostly workspace companion',
      ),
    ).toBeTruthy(),
  );
  await act(async () => {
    fireEvent.press(
      view.getByLabelText('Create attempt from exact external task'),
    );
    await Promise.resolve();
  });
  await waitFor(() => expect(prepareWorkspaceMutation).toHaveBeenCalled());
  expect(prepareWorkspaceMutation).toHaveBeenCalledWith({
    kind: 'create_attempt',
    projectId: 'project-mobile',
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
    externalWorkItem: {
      provider: 'GitHub',
      key: '#34',
      title: 'Add a read-mostly workspace companion',
    },
    idempotencyKey: expect.stringMatching(/^mobile-workspace-/u),
  });
  expect(confirmWorkspaceMutation).not.toHaveBeenCalled();
  expect(view.getByText(`Server · ${WORKSPACE_FIXTURE_IDENTITY}`)).toBeTruthy();
  expect(view.getByText('Project · project-mobile')).toBeTruthy();
  expect(view.getByText('Workspace · workspace-34 revision 12')).toBeTruthy();
  expect(
    view.getByText(
      'External task · GitHub / #34 · Add a read-mostly workspace companion',
    ),
  ).toBeTruthy();
  expect(view.getByText('Preview revision · 13')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm exact workspace change'));
    await Promise.resolve();
  });
  expect(confirmWorkspaceMutation).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(view.getByText(/Only receipt lookup is available/)).toBeTruthy(),
  );
  expect(view.queryByLabelText('Confirm exact workspace change')).toBeNull();
});

test('a stale selected server disables every workspace submission without queuing', async () => {
  const base = workspaceValue();
  const prepareWorkspaceMutation = jest.fn();
  const confirmWorkspaceMutation = jest.fn();
  const reconcileWorkspaceMutation = jest.fn();
  mockUseWorkspaces.mockReturnValue({
    ...base,
    serverStatuses: {
      [WORKSPACE_FIXTURE_IDENTITY]: {
        ...base.serverStatuses[WORKSPACE_FIXTURE_IDENTITY],
        phase: 'stale',
      },
    },
    prepareWorkspaceMutation,
    confirmWorkspaceMutation,
    reconcileWorkspaceMutation,
  });
  mockUseMobileLifecycle.mockReturnValue(mutationLifecycle());
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
  };
  const view = await render(<WorkspaceDetailScreen />);
  expect(view.getByLabelText(/Create from task, unavailable/)).toBeDisabled();
  expect(view.getByLabelText(/Resume workspace, unavailable/)).toBeDisabled();
  expect(view.getByText(/No offline mutation is queued/)).toBeTruthy();
  expect(prepareWorkspaceMutation).not.toHaveBeenCalled();
  expect(confirmWorkspaceMutation).not.toHaveBeenCalled();
  expect(reconcileWorkspaceMutation).not.toHaveBeenCalled();
});

test('reload exposes durable ambiguity as receipt lookup only and renders typed conflict', async () => {
  const base = workspaceValue();
  const prepareWorkspaceMutation = jest.fn();
  const confirmWorkspaceMutation = jest.fn();
  const reconcileWorkspaceMutation = jest.fn().mockResolvedValue({
    kind: 'settled',
    handle: { project: 'project-mobile', idempotency_key: 'mobile-pending-34' },
    receipt: { outcome: 'conflict', resulting_revision: null },
    projectionRefreshRequired: true,
  });
  mockUseWorkspaces.mockReturnValue({
    ...base,
    pendingWorkspaceMutationReceipts: [
      { project: 'project-mobile', idempotency_key: 'mobile-pending-34' },
    ],
    prepareWorkspaceMutation,
    confirmWorkspaceMutation,
    reconcileWorkspaceMutation,
  });
  mockUseMobileLifecycle.mockReturnValue(mutationLifecycle());
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
  };
  const view = await render(<WorkspaceDetailScreen />);
  const lookup = view.getByLabelText(
    'Look up workspace change receipt mobile-pending-34',
  );
  expect(prepareWorkspaceMutation).not.toHaveBeenCalled();
  expect(confirmWorkspaceMutation).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(lookup);
    await Promise.resolve();
  });
  expect(reconcileWorkspaceMutation).toHaveBeenCalledWith('mobile-pending-34');
  expect(prepareWorkspaceMutation).not.toHaveBeenCalled();
  expect(confirmWorkspaceMutation).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(view.getByText('Workspace change conflict.')).toBeTruthy(),
  );
});

test('draft loading is keyed so route changes cannot copy text across workspaces', async () => {
  const base = workspaceValue();
  const first = base.catalog.servers[0]!.workspaces[0]!;
  const second = { ...first, id: 'workspace-35', revision: '13' as never };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: {
      ...base.catalog,
      servers: base.catalog.servers.map((server) => ({
        ...server,
        workspaces: [...server.workspaces, second],
      })),
    },
    findWorkspace: (identity: string, id: string) =>
      identity === WORKSPACE_FIXTURE_IDENTITY
        ? id === first.id
          ? first
          : id === second.id
            ? second
            : null
        : null,
  });
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(
    JSON.stringify({
      schema: 'automonique.mobile-workspace-drafts/v2',
      drafts: [
        {
          serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
          authorizationRevision: '8',
          workspaceId: first.id,
          workspaceRevision: first.revision,
          text: 'draft for first workspace',
          updatedAtMs: '1',
        },
        {
          serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
          authorizationRevision: '8',
          workspaceId: second.id,
          workspaceRevision: second.revision,
          text: 'draft for second workspace',
          updatedAtMs: '2',
        },
      ],
    }),
  );
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: first.id,
    revision: first.revision,
  };
  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(
      view.getByLabelText('Workspace task context draft').props.value,
    ).toBe('draft for first workspace'),
  );
  await fireEvent.changeText(
    view.getByLabelText('Workspace task context draft'),
    'edited first workspace',
  );

  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: second.id,
    revision: second.revision,
  };
  await view.rerender(<WorkspaceDetailScreen />);
  await waitFor(() =>
    expect(
      view.getByLabelText('Workspace task context draft').props.value,
    ).toBe('draft for second workspace'),
  );
  expect(view.queryByDisplayValue('edited first workspace')).toBeNull();
});

function exactSessionParams(overrides: Record<string, string> = {}) {
  return {
    server: WORKSPACE_FIXTURE_IDENTITY,
    tenant: 'tenant-delivery',
    workspace: 'workspace-34',
    revision: '12',
    session: 'session-34',
    work_session: 'work-session-34',
    relation_revision: '9',
    session_revision: '9',
    session_authority: 'automonique',
    session_kind: 'session',
    principal_generation: '3',
    authorization_revision: '8',
    ...overrides,
  };
}

test('exact retained chat preserves full scope in the generic session route', async () => {
  mockRouteParams = exactSessionParams();
  await render(<ExactWorkspaceSessionLink />);

  expect(mockRedirect).toHaveBeenCalledWith({
    pathname: '/session/[id]',
    params: expect.objectContaining({
      id: 'session-34',
      scope_server: WORKSPACE_FIXTURE_IDENTITY,
      scope_tenant: 'tenant-delivery',
      scope_relation_revision: '9',
      scope_work_session: 'work-session-34',
      scope_authority: 'automonique',
      scope_kind: 'session',
      scope_session_revision: '9',
      scope_principal_generation: '3',
    }),
  });
});

test('exact retained chat routes a distinct work-session relation to its v1 target', async () => {
  const base = workspaceValue();
  const currentServer = base.catalog.servers[0]!;
  const currentWorkspace = currentServer.workspaces[0]!;
  const retainedSessionId = 'retained-session-34';
  const workSessionId = 'work-session-34';
  const workspace = {
    ...currentWorkspace,
    sessions: currentWorkspace.sessions.map((session) => ({
      ...session,
      id: workSessionId,
      target: { ...session.target, id: retainedSessionId },
    })),
  };
  const server = { ...currentServer, workspaces: [workspace] };
  mockUseWorkspaces.mockReturnValue({
    ...base,
    catalog: { ...base.catalog, servers: [server] },
    findServer: (identity: string) =>
      identity === server.serverIdentity ? server : null,
    findWorkspace: (identity: string, id: string) =>
      identity === server.serverIdentity && id === workspace.id
        ? workspace
        : null,
  });
  mockUseMobile.mockReturnValue({
    snapshot: {
      ...mockUseMobile().snapshot,
      sessions: [
        {
          target: {
            coordinate: {
              authority: 'automonique',
              kind: 'session',
              id: retainedSessionId,
            },
            revision: '9',
          },
        },
      ],
    },
  });
  mockRouteParams = exactSessionParams({
    session: retainedSessionId,
    work_session: workSessionId,
  });

  await render(<ExactWorkspaceSessionLink />);
  expect(mockRedirect).toHaveBeenCalledWith({
    pathname: '/session/[id]',
    params: expect.objectContaining({
      id: retainedSessionId,
      scope_work_session: workSessionId,
    }),
  });
});

test.each([
  ['foreign server', { server: `sha256:${'b'.repeat(64)}` }],
  ['foreign tenant', { tenant: 'tenant-foreign' }],
  ['foreign work session', { work_session: 'work-session-foreign' }],
  ['foreign authority', { session_authority: 'github' }],
  ['stale v1 revision', { session_revision: '8' }],
  ['stale principal generation', { principal_generation: '2' }],
])(
  'exact retained chat refuses %s even when the session id collides',
  async (_name, overrides) => {
    mockRouteParams = exactSessionParams(overrides);
    const view = await render(<ExactWorkspaceSessionLink />);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(view.getByText('Retained session unavailable')).toBeTruthy();
  },
);
