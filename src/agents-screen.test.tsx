// SPDX-License-Identifier: Elastic-2.0

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AgentsScreen from './app/agents';
import { syntheticSnapshot } from '@/core/fixtures';

const mockUseMobile = jest.fn();
jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => mockUseMobile(),
}));
jest.mock('@/components/connection-banner', () => ({
  ConnectionBanner: () => null,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

const agents = [
  {
    id: 'monique',
    scope: { level: 'infra' },
    name: 'Monique',
    identity: 'Looks after the whole installation.',
    personaRevision: '1',
    personaDigest: 'a'.repeat(64),
  },
  {
    id: 'acme-shop',
    scope: { level: 'site', tenantId: 'tenant-acme', siteId: 'site-shop' },
    name: 'Shop agent',
    identity: 'Looks after one site.',
    personaRevision: '2',
    personaDigest: 'b'.repeat(64),
  },
] as const;

function mobile(agentsGateway: unknown, phase = 'live') {
  return {
    agentsGateway,
    projectionReady: true,
    snapshot: {
      ...syntheticSnapshot,
      connection: { ...syntheticSnapshot.connection, phase },
    },
  };
}

beforeEach(() => jest.clearAllMocks());

it('lists the granted agents with their scope and starts a call to the exact agent', async () => {
  const list = jest.fn(() => Promise.resolve({ revision: '7', agents }));
  mockUseMobile.mockReturnValue(mobile({ list }));
  const screen = await render(<AgentsScreen />);
  await waitFor(() => screen.getByText('Monique'));
  expect(list).toHaveBeenCalledWith({ action: 'list' }, expect.anything());
  screen.getByText('Whole installation');
  // Identifiers are shown as issued, not parsed into a friendlier name.
  screen.getByText('Site · site-shop');
  fireEvent.press(screen.getByLabelText('Call Shop agent'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/agent/[id]',
    params: { id: 'acme-shop', name: 'Shop agent' },
  });
});

it('shows no call control when the phone was not granted agent calls', async () => {
  mockUseMobile.mockReturnValue(mobile(null));
  const screen = await render(<AgentsScreen />);
  screen.getByText(/was not granted agent calls/);
  expect(screen.queryByText('Call')).toBeNull();
});

it('does not ask the server for agents while the connection is not live', async () => {
  const list = jest.fn();
  mockUseMobile.mockReturnValue(mobile({ list }, 'stale'));
  const screen = await render(<AgentsScreen />);
  screen.getByText('Agents are available once the connection is live.');
  expect(list).not.toHaveBeenCalled();
});

it('reports a failed listing without inventing agents', async () => {
  const list = jest.fn(() => Promise.reject(new Error('offline')));
  mockUseMobile.mockReturnValue(mobile({ list }));
  const screen = await render(<AgentsScreen />);
  await waitFor(() => screen.getByText('The agent list could not be loaded.'));
  expect(screen.queryByText('Call')).toBeNull();
});
