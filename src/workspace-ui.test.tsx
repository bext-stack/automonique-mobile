// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import WorkspacesScreen from './app/(tabs)/workspaces';
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

jest.mock('expo-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => children,
  Redirect: ({ href }: { readonly href: unknown }) => {
    mockRedirect(href);
    return null;
  },
  useLocalSearchParams: () => mockRouteParams,
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
  files: [],
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
    details: [detail],
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

beforeEach(() => {
  jest.clearAllMocks();
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
    executeReviewAction: jest.fn(),
    findWorkspace: () => withReview,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: { actions: ['get_review'] },
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
  expect(view.getByText(/local drafts are not sent to an agent/)).toBeTruthy();
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
  const executeReviewAction = jest.fn().mockResolvedValue({
    schema: 'automonique.platform/review-action-receipt/v2',
    idempotency_key: 'mobile-review-test',
    actor: 'mobile-actor',
    outcome: 'completed',
    reconciliation: 'final',
    revision: 8n,
    current_revision: null,
  });
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
    executeReviewAction,
    findWorkspace: () => withReview,
  });
  mockUseMobileLifecycle.mockReturnValue({
    state: {
      phase: 'ready',
      profile: { serverIdentity: WORKSPACE_FIXTURE_IDENTITY },
    },
    workspaceGateway: {
      authorizationScope: {
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

test('workspace detail exposes exact retained chat while mutations and terminal stay disabled', async () => {
  mockRouteParams = {
    server: WORKSPACE_FIXTURE_IDENTITY,
    workspace: 'workspace-34',
    revision: '12',
  };
  const view = await render(<WorkspaceDetailScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());

  expect(view.getByText('External task status')).toBeTruthy();
  expect(view.getByText('Orchestration status')).toBeTruthy();
  expect(view.getByText('Branch: feat/workspace-companion-34')).toBeTruthy();
  expect(view.getByLabelText(/Terminal, unavailable/)).toBeDisabled();
  expect(view.getByLabelText(/Create from task, unavailable/)).toBeDisabled();
  expect(view.getByText(/No offline mutation is queued/)).toBeTruthy();
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
    workspace: 'workspace-34',
    revision: '12',
    session: 'session-34',
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
      scope_relation_revision: '9',
      scope_authority: 'automonique',
      scope_kind: 'session',
      scope_session_revision: '9',
      scope_principal_generation: '3',
    }),
  });
});

test.each([
  ['foreign server', { server: `sha256:${'b'.repeat(64)}` }],
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
