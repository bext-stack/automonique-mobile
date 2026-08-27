// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import WorkspacesScreen from './app/(tabs)/workspaces';
import WorkspaceDetailScreen from './app/workspace/[server]/[workspace]';
import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from './core/workspace-fixtures';

let mockRouteParams: Record<string, string> = {};
const mockUseWorkspaces = jest.fn();

jest.mock('expo-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => children,
  useLocalSearchParams: () => mockRouteParams,
}));
jest.mock('@/providers/workspace-provider', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));
jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => ({
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
  }),
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
