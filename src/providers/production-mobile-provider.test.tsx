// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect, type PropsWithChildren } from 'react';
import { Text } from 'react-native';

import {
  mobileLifecycle,
  type MobileLifecycleState,
} from '@/core/mobile-lifecycle';
import { registerWorkspaceOperation } from '@/core/workspace-storage';

import {
  ProductionMobileProvider,
  useMobileLifecycle,
} from './production-mobile-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('@/core/mobile-lifecycle', () => ({
  mobileLifecycle: {
    snapshot: jest.fn(),
    subscribe: jest.fn(),
    hydrate: jest.fn(),
    validateCurrentAuthorization: jest.fn(),
    createGateway: jest.fn(),
    createWorkspaceGateway: jest.fn(),
    refresh: jest.fn(),
    revoke: jest.fn(),
    pair: jest.fn(),
  },
}));

jest.mock('./mobile-provider', () => ({
  MobileProvider: ({ children }: PropsWithChildren) => children,
}));

jest.mock('./workspace-provider', () => {
  const actual = jest.requireActual('./workspace-provider');
  return {
    ...actual,
    WorkspaceProvider: ({ children }: PropsWithChildren) => children,
  };
});

const serverIdentity = `sha256:${'2'.repeat(64)}`;
let lifecycleListener: ((state: MobileLifecycleState) => void) | undefined;
let exposedRevoke: (() => Promise<void>) | undefined;
const ready: MobileLifecycleState = {
  phase: 'ready',
  profile: {
    origin: 'https://ops.example.test',
    platformEndpoint: 'https://ops.example.test/platform',
    serverIdentity,
    credentialId: 'credential-1',
    actor: 'operator-1',
    issuedAtMs: '1',
    accessExpiresAtMs: '9999999999999',
    authorizationRevision: '50',
    credentialRevision: '7',
    actions: [],
    sessionScope: [],
    maxPageEvents: 10,
    maxFollowUpBytes: 1024,
  },
};

function Probe() {
  const { state, revokeCredential, workspaceGateway } = useMobileLifecycle();
  useEffect(() => {
    exposedRevoke = revokeCredential;
  }, [revokeCredential]);
  return (
    <Text testID="revoke-state">
      {state.phase}:{workspaceGateway === null ? 'read-only' : 'live'}
    </Text>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValue(new Error('workspace_cleanup_failed'));
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
  jest.mocked(mobileLifecycle.snapshot).mockReturnValue(ready);
  jest.mocked(mobileLifecycle.createGateway).mockReturnValue({} as never);
  jest
    .mocked(mobileLifecycle.createWorkspaceGateway)
    .mockReturnValue({} as never);
  lifecycleListener = undefined;
  exposedRevoke = undefined;
  jest.mocked(mobileLifecycle.subscribe).mockImplementation((next) => {
    lifecycleListener = next;
    next(ready);
    return () => undefined;
  });
  jest.mocked(mobileLifecycle.hydrate).mockResolvedValue(ready);
  jest.mocked(mobileLifecycle.revoke).mockImplementation(async () => {
    lifecycleListener?.({ phase: 'revoking', profile: ready.profile });
    await Promise.resolve();
    lifecycleListener?.({ phase: 'unpaired', profile: null });
  });
});

test('workspace cleanup failure cannot suppress remote revoke or leave live operations', async () => {
  const controller = new AbortController();
  registerWorkspaceOperation(serverIdentity, controller);
  let abortedBeforeRemote = false;
  jest.mocked(mobileLifecycle.revoke).mockImplementation(async () => {
    abortedBeforeRemote = controller.signal.aborted;
    lifecycleListener?.({ phase: 'revoking', profile: ready.profile });
    await Promise.resolve();
    lifecycleListener?.({ phase: 'unpaired', profile: null });
  });

  const view = await render(
    <ProductionMobileProvider>
      <Probe />
    </ProductionMobileProvider>,
  );
  await waitFor(() =>
    expect(view.getByTestId('revoke-state')).toHaveTextContent('ready:live'),
  );
  let failure: unknown;
  await act(async () => {
    try {
      await exposedRevoke!();
    } catch (error) {
      failure = error;
    }
  });

  await waitFor(() =>
    expect(view.getByTestId('revoke-state')).toHaveTextContent(
      'unpaired:read-only',
    ),
  );
  expect(failure).toEqual(new Error('workspace_cleanup_failed'));
  expect(mobileLifecycle.revoke).toHaveBeenCalledTimes(1);
  expect(abortedBeforeRemote).toBe(true);
  expect(controller.signal.aborted).toBe(true);
});

test('remote and workspace cleanup failures are both retained', async () => {
  const controller = new AbortController();
  registerWorkspaceOperation(serverIdentity, controller);
  const remoteFailure = new Error('remote_revoke_failed');
  jest.mocked(mobileLifecycle.revoke).mockRejectedValue(remoteFailure);

  await render(
    <ProductionMobileProvider>
      <Probe />
    </ProductionMobileProvider>,
  );
  await waitFor(() => expect(exposedRevoke).toEqual(expect.any(Function)));
  let failure: unknown;
  await act(async () => {
    try {
      await exposedRevoke!();
    } catch (error) {
      failure = error;
    }
  });

  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([
    remoteFailure,
    new Error('workspace_cleanup_failed'),
  ]);
  expect(mobileLifecycle.revoke).toHaveBeenCalledTimes(1);
  expect(controller.signal.aborted).toBe(true);
});
