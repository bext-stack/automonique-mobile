// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const detail = {
  serverIdentity: WORKSPACE_FIXTURE_IDENTITY,
  workspaceId: 'workspace-34',
  workspaceRevision: '12',
  lineageAvailable: true,
  review: {
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
      },
    ],
    pullRequestState: 'open',
    pullRequestId: '34',
    reviewDecision: 'changes_requested',
    deliveryState: 'not_started',
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
      omittedWorkspaceCount: 0,
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
  });
  mockUseWorkspaces.mockReturnValue(workspaceValue());
  mockRouteParams = {};
});

test('discovery keeps external and orchestration status separate and labels partial coverage', async () => {
  const view = await render(<WorkspacesScreen />);
  expect(view.getByText('Orchestration: review')).toBeTruthy();
  expect(view.getByText('External: GitHub #34 · open')).toBeTruthy();
  expect(view.getByText(/Partial detail coverage/)).toBeTruthy();
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
      schema: 'automonique.mobile-workspace-drafts/v1',
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
