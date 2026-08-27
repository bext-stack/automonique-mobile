// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  decodeWorkspaceCompanionCache,
  encodeWorkspaceCompanionCache,
} from '@/core/workspace-companion-cache';
import {
  WORKSPACE_FIXTURE_IDENTITY,
  workspaceCompanionFixture,
} from '@/core/workspace-fixtures';

import {
  revokeWorkspaceCatalogCache,
  useWorkspaces,
  WorkspaceProvider,
} from './workspace-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

function Probe() {
  const { catalog, status } = useWorkspaces();
  return (
    <Text testID="workspace-probe">
      {status.phase}:{catalog.servers.length}:
      {catalog.servers[0]?.authorization ?? 'none'}
    </Text>
  );
}

const encoded = encodeWorkspaceCompanionCache({
  schema: 'automonique.mobile-workspace-cache/v1',
  catalog: workspaceCompanionFixture,
  intentDrafts: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(encoded);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
});

test('cold cache remains visible but read-only when no current delegated gateway exists', async () => {
  const view = await render(
    <WorkspaceProvider
      gateway={null}
      generationKey="refresh-required"
      profile={null}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(view.getByText('unavailable:1:cached')).toBeTruthy(),
  );
});

test('credential revocation durably removes only the exact server scope', async () => {
  await revokeWorkspaceCatalogCache(WORKSPACE_FIXTURE_IDENTITY);

  const persisted = jest.mocked(AsyncStorage.setItem).mock.calls[0]?.[1];
  expect(persisted).toEqual(expect.any(String));
  const decoded = decodeWorkspaceCompanionCache(persisted!);
  expect(decoded.catalog.servers).toEqual([]);
  expect(decoded.catalog.serverTombstones[0]?.serverIdentity).toBe(
    WORKSPACE_FIXTURE_IDENTITY,
  );
});
