// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Pressable, Text } from 'react-native';

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

const mockNotificationGetPermissions = jest.fn();
const mockNotificationRequestPermissions = jest.fn();
const mockNotificationSchedule = jest.fn();
const mockNotificationGetLastResponse = jest.fn();
const mockNotificationClearLastResponse = jest.fn();
const mockNotificationRouterPush = jest.fn();
const mockBuildWorkspaceServerCatalog = jest.fn();
let mockNotificationResponse:
  | ((response: {
      notification: { request: { content: { data: unknown } } };
    }) => void)
  | null = null;
let mockAppStateChange: ((state: string) => void) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockNotificationRouterPush }),
}));
jest.mock('@/core/workspace-v2-catalog', () => {
  const actual = jest.requireActual('@/core/workspace-v2-catalog');
  return {
    ...actual,
    buildWorkspaceServerCatalog: (...args: readonly unknown[]) =>
      mockBuildWorkspaceServerCatalog(...args),
  };
});
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  PermissionStatus: { GRANTED: 'granted' },
  addNotificationResponseReceivedListener: jest.fn(
    (listener: typeof mockNotificationResponse) => {
      mockNotificationResponse = listener;
      return { remove: jest.fn() };
    },
  ),
  getPermissionsAsync: (...args: readonly unknown[]) =>
    mockNotificationGetPermissions(...args),
  getLastNotificationResponseAsync: (...args: readonly unknown[]) =>
    mockNotificationGetLastResponse(...args),
  clearLastNotificationResponseAsync: (...args: readonly unknown[]) =>
    mockNotificationClearLastResponse(...args),
  requestPermissionsAsync: (...args: readonly unknown[]) =>
    mockNotificationRequestPermissions(...args),
  scheduleNotificationAsync: (...args: readonly unknown[]) =>
    mockNotificationSchedule(...args),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

function Probe() {
  const {
    catalog,
    details,
    notificationPermission,
    requestReviewNotificationPermission,
    refresh,
    selectServer,
    serverStatuses,
    status,
  } = useWorkspaces();
  return (
    <>
      <Text testID="workspace-probe">
        {status.phase}:{catalog.servers.length}:
        {catalog.servers[0]?.authorization ?? 'none'}
      </Text>
      <Text testID="notification-permission">{notificationPermission}</Text>
      <Text testID="fanout-probe">
        {
          Object.values(serverStatuses).filter(({ phase }) => phase === 'live')
            .length
        }
        :{details.length}
      </Text>
      <Text testID="selected-server">{catalog.selectedServerIdentity}</Text>
      {catalog.servers[1] !== undefined && (
        <Pressable
          accessibilityLabel="Select second workspace server"
          onPress={() => void selectServer(catalog.servers[1]!.serverIdentity)}
        />
      )}
      <Pressable
        accessibilityLabel="Request review notifications"
        onPress={() => void requestReviewNotificationPermission()}
      />
      <Pressable
        accessibilityLabel="Refresh workspace catalog"
        onPress={() => void refresh()}
      />
    </>
  );
}

function MutationProbe() {
  const {
    pendingWorkspaceMutationReceipts,
    prepareWorkspaceMutation,
    workspaceMutationBusy,
  } = useWorkspaces();
  const request = {
    projectId: 'project-mobile',
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
    externalWorkItem: {
      provider: 'GitHub',
      key: '#34',
      title: 'Add a read-mostly workspace companion',
    },
  } as const;
  return (
    <>
      <Probe />
      <Text testID="mutation-state">
        {workspaceMutationBusy ? 'busy' : 'idle'}:
        {pendingWorkspaceMutationReceipts.length}
      </Text>
      <Pressable
        accessibilityLabel="Prepare exact create attempt"
        onPress={() =>
          void prepareWorkspaceMutation({
            ...request,
            kind: 'create_attempt',
            idempotencyKey: 'mobile-create-34',
          }).catch(() => undefined)
        }
      />
      <Pressable
        accessibilityLabel="Prepare exact resume attempt"
        onPress={() =>
          void prepareWorkspaceMutation({
            ...request,
            kind: 'resume_attempt',
            targetId: 'attempt-34-a',
            idempotencyKey: 'mobile-resume-34',
          }).catch(() => undefined)
        }
      />
      <Pressable
        accessibilityLabel="Prepare exact resume session"
        onPress={() =>
          void prepareWorkspaceMutation({
            ...request,
            kind: 'resume_session',
            targetId: 'work-session-34',
            idempotencyKey: 'mobile-resume-session-34',
          }).catch(() => undefined)
        }
      />
    </>
  );
}

function MutationResultProbe() {
  const { confirmWorkspaceMutation, reconcileWorkspaceMutation } =
    useWorkspaces();
  const [result, setResult] = useState('none');
  return (
    <>
      <Probe />
      <Text testID="authoritative-mutation-result">{result}</Text>
      <Pressable
        accessibilityLabel="Confirm prepared workspace mutation"
        onPress={() =>
          void confirmWorkspaceMutation(
            { project: 'project-mobile' } as never,
            'grant',
          ).then((value) =>
            setResult(
              value.kind === 'submitted'
                ? `${value.kind}:${value.receipt.outcome}`
                : value.kind,
            ),
          )
        }
      />
      <Pressable
        accessibilityLabel="Reconcile durable workspace mutation"
        onPress={() =>
          void reconcileWorkspaceMutation('mobile-pending-34').then((value) =>
            setResult(`${value.kind}:${value.receipt.outcome}`),
          )
        }
      />
    </>
  );
}

const encoded = encodeWorkspaceCompanionCache({
  schema: 'automonique.mobile-workspace-cache/v2',
  catalog: workspaceCompanionFixture,
  intentDrafts: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationResponse = null;
  mockAppStateChange = null;
  mockNotificationGetPermissions.mockResolvedValue({
    status: 'undetermined',
    canAskAgain: true,
  });
  mockNotificationRequestPermissions.mockResolvedValue({
    status: 'granted',
    canAskAgain: false,
  });
  mockNotificationSchedule.mockResolvedValue('notification-1');
  mockNotificationGetLastResponse.mockResolvedValue(null);
  mockNotificationClearLastResponse.mockResolvedValue(undefined);
  mockBuildWorkspaceServerCatalog.mockReset();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      mockAppStateChange = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(encoded);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test.each(['expired', 'recovery-required'])(
  '%s credentials preserve cold cache navigation without a gateway',
  async (generationKey) => {
    const view = await render(
      <WorkspaceProvider
        gateway={null}
        generationKey={generationKey}
        profile={null}
        readOnlyServers={[]}
      >
        <Probe />
      </WorkspaceProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('unavailable:1:cached')).toBeTruthy(),
    );
  },
);

function catalogBuild(
  server: (typeof workspaceCompanionFixture.servers)[number],
) {
  return {
    profile: { ...server, authorization: 'active' as const },
    details: server.workspaces.map((workspace) => ({
      serverIdentity: server.serverIdentity,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      lineageAvailable: false,
      attention: null,
      lineage: null,
      sessionBindings: [],
      review: null,
    })),
    coverage: 'complete' as const,
    omittedDetailCount: 0,
    omittedProjectCount: 0,
    omittedHostCount: 0,
    omittedWorkspaceCount: 0,
    omittedSessionCount: 0,
    failedProjectCount: 0,
    failedDetailCount: 0,
    successfulProjectIds: server.projects.map((project) => project.id),
    failedProjectIds: [],
  };
}

test('two ready Platform v2 slots fan out independently and select the exact slot', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const first = workspaceCompanionFixture.servers[0]!;
  const secondIdentity =
    `sha256:${'b'.repeat(64)}` as typeof first.serverIdentity;
  const second = {
    ...first,
    serverIdentity: secondIdentity,
    origin: 'https://second.example.test',
    tenantId: 'tenant-second',
    label: 'Second server',
    authorizationRevision: '9' as typeof first.authorizationRevision,
    workspaces: first.workspaces.map((workspace) => ({
      ...workspace,
      id: `${workspace.id}-second`,
      title: `${workspace.title} second`,
    })),
  };
  mockBuildWorkspaceServerCatalog.mockImplementation(
    ({ origin }: { readonly origin: string }) =>
      Promise.resolve(catalogBuild(origin === second.origin ? second : first)),
  );
  const selectMutationServer = jest.fn().mockResolvedValue(undefined);
  const readOnlyServers = [
    {
      slotId: 'slot-first',
      profile: { origin: first.origin },
      gateway: {
        authorizationScope: { serverIdentity: first.serverIdentity },
      },
    },
    {
      slotId: 'slot-second',
      profile: { origin: second.origin },
      gateway: {
        authorizationScope: { serverIdentity: second.serverIdentity },
      },
    },
  ] as never;
  const selectedGateway = {
    authorizationScope: {
      serverIdentity: second.serverIdentity,
      actions: [],
    },
    reviewEffectKinds: [],
  } as never;

  const view = await render(
    <WorkspaceProvider
      gateway={selectedGateway}
      generationKey="two-ready-slots"
      profile={{ origin: second.origin } as never}
      readOnlyServers={readOnlyServers}
      selectMutationServer={selectMutationServer}
    >
      <Probe />
    </WorkspaceProvider>,
  );

  await waitFor(() => expect(view.getByText('live:2:active')).toBeTruthy());
  expect(view.getByTestId('fanout-probe')).toHaveTextContent('2:2');
  expect(view.getByTestId('selected-server')).toHaveTextContent(secondIdentity);
  expect(mockBuildWorkspaceServerCatalog).toHaveBeenCalledTimes(2);
  await act(async () => {
    fireEvent.press(view.getByLabelText('Select second workspace server'));
    await Promise.resolve();
  });
  expect(selectMutationServer).toHaveBeenCalledWith('slot-second');
  const persisted = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1];
  expect(persisted).toEqual(expect.any(String));
  const decoded = decodeWorkspaceCompanionCache(persisted!);
  expect(decoded.catalog.servers).toHaveLength(2);
  expect(
    decoded.catalog.servers.map(({ authorization }) => authorization),
  ).toEqual(['cached', 'cached']);
});

test('a slot generation switch aborts an in-flight fan-out before publishing it', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const server = workspaceCompanionFixture.servers[0]!;
  let oldAborted = false;
  mockBuildWorkspaceServerCatalog.mockImplementationOnce(
    ({ signal }: { readonly signal: AbortSignal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            oldAborted = signal.aborted;
            reject(new Error('old_slot_aborted'));
          },
          { once: true },
        );
      }),
  );
  const firstRead = [
    {
      slotId: 'slot-old',
      profile: { origin: server.origin },
      gateway: {
        authorizationScope: { serverIdentity: server.serverIdentity },
      },
    },
  ] as never;
  const view = await render(
    <WorkspaceProvider
      gateway={null}
      generationKey="slot-old"
      profile={null}
      readOnlyServers={firstRead}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(mockBuildWorkspaceServerCatalog).toHaveBeenCalledTimes(1),
  );
  mockBuildWorkspaceServerCatalog.mockResolvedValueOnce(catalogBuild(server));
  const nextRead = [
    {
      slotId: 'slot-new',
      profile: { origin: server.origin },
      gateway: {
        authorizationScope: { serverIdentity: server.serverIdentity },
      },
    },
  ] as never;
  await act(async () => {
    view.rerender(
      <WorkspaceProvider
        gateway={null}
        generationKey="slot-new"
        profile={null}
        readOnlyServers={nextRead}
      >
        <Probe />
      </WorkspaceProvider>,
    );
    await Promise.resolve();
  });
  await waitFor(() => expect(oldAborted).toBe(true));
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
});

test('selected full gateway prepares exact create and resume intents while pending receipts stay lookup-only', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const server = workspaceCompanionFixture.servers[0]!;
  mockBuildWorkspaceServerCatalog.mockResolvedValue(catalogBuild(server));
  const prepareMutation = jest
    .fn()
    .mockResolvedValue({ project: 'project-mobile' });
  const pendingHandle = {
    project: 'project-mobile',
    idempotency_key: 'mobile-pending-34',
  };
  const pendingMutationReceipts = jest.fn().mockResolvedValue([pendingHandle]);
  const reconcileMutation = jest.fn();
  const selectedGateway = {
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
    negotiate: jest.fn(),
    loadProject: jest.fn(),
    loadLineage: jest.fn(),
    loadReview: jest.fn(),
    prepareMutation,
    pendingMutationReceipts,
    reconcileMutation,
  };
  const view = await render(
    <WorkspaceProvider
      gateway={selectedGateway as never}
      generationKey="mutation-selected"
      profile={
        {
          origin: server.origin,
          serverIdentity: server.serverIdentity,
        } as never
      }
    >
      <MutationProbe />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
  expect(view.getByTestId('mutation-state')).toHaveTextContent('idle:1');
  expect(reconcileMutation).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(view.getByLabelText('Prepare exact create attempt'));
    await Promise.resolve();
  });
  await waitFor(() => expect(prepareMutation).toHaveBeenCalledTimes(1));
  expect(prepareMutation).toHaveBeenLastCalledWith(
    'project-mobile',
    expect.objectContaining({
      kind: 'create_attempt_workspace',
      label: 'GitHub #34',
      requested_authority: {
        credentials: [],
        filesystem: [],
        models: [],
        network: [],
        providers: [],
        tools: [],
      },
      user_workspace: {
        identity: { kind: 'user_workspace', id: 'workspace-34' },
        revision: 12n,
      },
    }),
    'mobile-create-34',
    expect.any(AbortSignal),
  );
  await act(async () => {
    fireEvent.press(view.getByLabelText('Prepare exact resume attempt'));
    await Promise.resolve();
  });
  await waitFor(() => expect(prepareMutation).toHaveBeenCalledTimes(2));
  expect(prepareMutation).toHaveBeenLastCalledWith(
    'project-mobile',
    {
      kind: 'resume_attempt_workspace',
      requested_authority: {
        credentials: [],
        filesystem: [],
        models: [],
        network: [],
        providers: [],
        tools: [],
      },
      target: {
        identity: { kind: 'attempt_workspace', id: 'attempt-34-a' },
        revision: 4n,
      },
    },
    'mobile-resume-34',
    expect.any(AbortSignal),
  );
  await act(async () => {
    fireEvent.press(view.getByLabelText('Prepare exact resume session'));
    await Promise.resolve();
  });
  await waitFor(() => expect(prepareMutation).toHaveBeenCalledTimes(3));
  expect(prepareMutation).toHaveBeenLastCalledWith(
    'project-mobile',
    {
      kind: 'resume_session',
      requested_authority: {
        credentials: [],
        filesystem: [],
        models: [],
        network: [],
        providers: [],
        tools: [],
      },
      target: {
        identity: { kind: 'session', id: 'work-session-34' },
        revision: 9n,
      },
    },
    'mobile-resume-session-34',
    expect.any(AbortSignal),
  );
  expect(reconcileMutation).not.toHaveBeenCalled();
});

test('a selected slot generation switch aborts an in-flight workspace mutation', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const server = workspaceCompanionFixture.servers[0]!;
  mockBuildWorkspaceServerCatalog.mockResolvedValue(catalogBuild(server));
  let mutationSignal: AbortSignal | null = null;
  const oldGateway = {
    authorizationScope: {
      serverIdentity: server.serverIdentity,
      tenantId: server.tenantId,
      authorizationRevision: 8n,
      principalGeneration: 3n,
      delegationId: 'delegation-old',
      expiresAtMs: BigInt(Date.now() + 60_000),
      projectRoots: ['project-mobile'],
      actions: ['prepare_mutation'],
    },
    reviewEffectKinds: [],
    negotiate: jest.fn(),
    loadProject: jest.fn(),
    loadLineage: jest.fn(),
    loadReview: jest.fn(),
    prepareMutation: jest.fn(
      (_project, _intent, _key, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          mutationSignal = signal;
          signal.addEventListener(
            'abort',
            () => reject(new Error('old_mutation_aborted')),
            { once: true },
          );
        }),
    ),
  };
  const profile = {
    origin: server.origin,
    serverIdentity: server.serverIdentity,
  } as never;
  const view = await render(
    <WorkspaceProvider
      gateway={oldGateway as never}
      generationKey="mutation-old"
      profile={profile}
    >
      <MutationProbe />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Prepare exact create attempt'));
  await waitFor(() => expect(mutationSignal).not.toBeNull());
  await act(async () => {
    view.rerender(
      <WorkspaceProvider
        gateway={null}
        generationKey="mutation-new"
        profile={null}
        readOnlyServers={[]}
      >
        <MutationProbe />
      </WorkspaceProvider>,
    );
    await Promise.resolve();
  });
  expect(mutationSignal!.aborted).toBe(true);
  await waitFor(() =>
    expect(view.getByTestId('mutation-state')).toHaveTextContent('idle:0'),
  );
});

test.each([
  [
    'submitted',
    {
      kind: 'submitted',
      idempotencyKey: 'mobile-submit-34',
      receipt: { outcome: 'conflict' },
      projectionRefreshRequired: true,
    },
    'submitted:conflict',
  ],
  [
    'ambiguous',
    {
      kind: 'ambiguous',
      idempotencyKey: 'mobile-submit-34',
      projectionRefreshRequired: true,
    },
    'ambiguous',
  ],
] as const)(
  'failed projection refresh cannot replace an authoritative %s result',
  async (_kind, authoritativeResult, renderedResult) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    const server = workspaceCompanionFixture.servers[0]!;
    mockBuildWorkspaceServerCatalog.mockResolvedValue(catalogBuild(server));
    const confirmMutation = jest.fn().mockResolvedValue(authoritativeResult);
    const gateway = {
      authorizationScope: {
        serverIdentity: server.serverIdentity,
        tenantId: server.tenantId,
        authorizationRevision: 8n,
        principalGeneration: 3n,
        delegationId: 'delegation-submit',
        expiresAtMs: BigInt(Date.now() + 60_000),
        projectRoots: ['project-mobile'],
        actions: [],
      },
      reviewEffectKinds: [],
      negotiate: jest.fn(),
      loadProject: jest.fn(),
      loadLineage: jest.fn(),
      loadReview: jest.fn(),
      confirmMutation,
    };
    const view = await render(
      <WorkspaceProvider
        gateway={gateway as never}
        generationKey="authoritative-submit"
        profile={
          {
            origin: server.origin,
            serverIdentity: server.serverIdentity,
          } as never
        }
      >
        <MutationResultProbe />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
    mockBuildWorkspaceServerCatalog.mockRejectedValue(
      new Error('projection_refresh_failed'),
    );
    await act(async () => {
      fireEvent.press(
        view.getByLabelText('Confirm prepared workspace mutation'),
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        view.getByTestId('authoritative-mutation-result'),
      ).toHaveTextContent(renderedResult),
    );
    expect(confirmMutation).toHaveBeenCalledTimes(1);
  },
);

test('failed projection refresh cannot replace an authoritative settled receipt', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const server = workspaceCompanionFixture.servers[0]!;
  mockBuildWorkspaceServerCatalog.mockResolvedValue(catalogBuild(server));
  const handle = {
    project: 'project-mobile',
    idempotency_key: 'mobile-pending-34',
  };
  const pendingMutationReceipts = jest
    .fn()
    .mockResolvedValueOnce([handle])
    .mockResolvedValue([]);
  const reconcileMutation = jest.fn().mockResolvedValue({
    kind: 'settled',
    handle,
    receipt: { outcome: 'completed' },
    projectionRefreshRequired: true,
  });
  const gateway = {
    authorizationScope: {
      serverIdentity: server.serverIdentity,
      tenantId: server.tenantId,
      authorizationRevision: 8n,
      principalGeneration: 3n,
      delegationId: 'delegation-reconcile',
      expiresAtMs: BigInt(Date.now() + 60_000),
      projectRoots: ['project-mobile'],
      actions: ['get_mutation_receipt'],
    },
    reviewEffectKinds: [],
    negotiate: jest.fn(),
    loadProject: jest.fn(),
    loadLineage: jest.fn(),
    loadReview: jest.fn(),
    pendingMutationReceipts,
    reconcileMutation,
  };
  const view = await render(
    <WorkspaceProvider
      gateway={gateway as never}
      generationKey="authoritative-reconcile"
      profile={
        {
          origin: server.origin,
          serverIdentity: server.serverIdentity,
        } as never
      }
    >
      <MutationResultProbe />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
  mockBuildWorkspaceServerCatalog.mockRejectedValue(
    new Error('projection_refresh_failed'),
  );
  await act(async () => {
    fireEvent.press(
      view.getByLabelText('Reconcile durable workspace mutation'),
    );
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(view.getByTestId('authoritative-mutation-result')).toHaveTextContent(
      'settled:completed',
    ),
  );
  expect(reconcileMutation).toHaveBeenCalledTimes(1);
});

test('credential revocation durably removes only the exact server scope', async () => {
  await revokeWorkspaceCatalogCache(WORKSPACE_FIXTURE_IDENTITY, '8');

  const persisted = jest.mocked(AsyncStorage.setItem).mock.calls[0]?.[1];
  expect(persisted).toEqual(expect.any(String));
  const decoded = decodeWorkspaceCompanionCache(persisted!);
  expect(decoded.catalog.servers).toEqual([]);
  expect(decoded.catalog.serverTombstones[0]?.serverIdentity).toBe(
    WORKSPACE_FIXTURE_IDENTITY,
  );
});

test('notification permission is requested only after an explicit operator gesture', async () => {
  const view = await render(
    <WorkspaceProvider
      gateway={null}
      generationKey="notification-permission"
      profile={null}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(view.getByTestId('notification-permission')).toHaveTextContent(
      'undetermined',
    ),
  );
  expect(mockNotificationRequestPermissions).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(view.getByLabelText('Request review notifications'));
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(mockNotificationRequestPermissions).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(view.getByTestId('notification-permission')).toHaveTextContent(
      'granted',
    ),
  );
});

test('a denied notification permission remains explicit and creates no notification', async () => {
  mockNotificationRequestPermissions.mockResolvedValue({
    status: 'denied',
    canAskAgain: false,
  });
  const view = await render(
    <WorkspaceProvider
      gateway={null}
      generationKey="notification-permission-denied"
      profile={null}
    >
      <Probe />
    </WorkspaceProvider>,
  );

  await act(async () => {
    fireEvent.press(view.getByLabelText('Request review notifications'));
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(view.getByTestId('notification-permission')).toHaveTextContent(
      'denied',
    ),
  );
  expect(mockNotificationRequestPermissions).toHaveBeenCalledTimes(1);
  expect(mockNotificationSchedule).not.toHaveBeenCalled();
  expect(mockNotificationRouterPush).not.toHaveBeenCalled();
});

test('lineage attention notifications stay lookup-only across cold start, delivery, and credential rotation', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  mockNotificationGetPermissions.mockResolvedValue({
    status: 'granted',
    canAskAgain: false,
  });
  const baseServer = workspaceCompanionFixture.servers[0]!;
  const server = {
    ...baseServer,
    authorizationRevision: '9' as typeof baseServer.authorizationRevision,
  };
  const built = catalogBuild(server);
  mockBuildWorkspaceServerCatalog.mockResolvedValue({
    ...built,
    details: [
      {
        ...built.details[0]!,
        lineageAvailable: true,
        attention: null,
        lineage: {
          workspace: 'workspace-34',
          external_work_items: [],
          orchestration: [
            {
              identity: { kind: 'question', id: 'question-notification' },
              parent: null,
              origin: {
                workspace: 'workspace-34',
                attempt: 'attempt-34-a',
                session: 'work-session-34',
                pane: null,
              },
              status: { kind: 'waiting', reason: 'Choose exact action' },
              revision: 11n,
              latest_useful_message: { text: 'Choose exact action' },
            },
          ],
        } as never,
        sessionBindings: [
          {
            workSessionId: 'work-session-34',
            attemptWorkspaceId: 'attempt-34-a',
            retainedSessionId: 'session-34',
          },
        ],
      },
    ],
  });
  const notificationData = {
    kind: 'automonique_session_attention_v1',
    server_identity: server.serverIdentity,
    authorization_revision: server.authorizationRevision,
    principal_generation: server.principalGeneration,
    workspace_id: 'workspace-34',
    workspace_revision: '12',
    node_kind: 'question',
    node_id: 'question-notification',
    node_revision: '11',
  };
  mockNotificationGetLastResponse.mockResolvedValue({
    notification: { request: { content: { data: notificationData } } },
  });
  const retainedSessions = [
    {
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: 'session-34',
        },
        revision: '15',
      },
    },
  ] as never;
  const gateway = {
    authorizationScope: {
      serverIdentity: server.serverIdentity,
      actions: [],
    },
    reviewEffectKinds: [],
  } as never;

  const view = await render(
    <WorkspaceProvider
      gateway={gateway}
      generationKey="lineage-notification"
      profile={{ origin: server.origin } as never}
      retainedSessions={retainedSessions}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
  await waitFor(() =>
    expect(mockNotificationRouterPush).toHaveBeenCalledWith({
      pathname: '/workspace/[server]/[workspace]/session/[session]',
      params: expect.objectContaining({
        server: server.serverIdentity,
        workspace: 'workspace-34',
        session: 'session-34',
        relation_revision: '9',
        session_revision: '15',
        authorization_revision: '9',
        principal_generation: '3',
      }),
    }),
  );

  mockAppStateChange!('background');
  await waitFor(() =>
    expect(mockNotificationSchedule).toHaveBeenCalledTimes(1),
  );
  expect(mockNotificationSchedule).toHaveBeenCalledWith({
    content: {
      title: 'Automonique needs you',
      body: 'Open Automonique to inspect the current bounded request.',
      data: notificationData,
    },
    trigger: null,
  });
  expect(
    JSON.stringify(mockNotificationSchedule.mock.calls[0]![0]),
  ).not.toMatch(/attempt-34|session-34|retained|pathname/iu);
  mockAppStateChange!('background');
  expect(mockNotificationSchedule).toHaveBeenCalledTimes(1);

  mockNotificationResponse!({
    notification: {
      request: {
        content: {
          data: { ...notificationData, authorization_revision: '8' },
        },
      },
    },
  });
  expect(mockNotificationRouterPush).toHaveBeenCalledTimes(1);
});

test('revoked or unavailable state rejects notification delivery and navigation', async () => {
  mockNotificationGetPermissions.mockResolvedValue({
    status: 'granted',
    canAskAgain: false,
  });
  const view = await render(
    <WorkspaceProvider
      gateway={null}
      generationKey="revoked-notification"
      profile={null}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(view.getByText('unavailable:1:cached')).toBeTruthy(),
  );
  expect(mockNotificationResponse).not.toBeNull();
  expect(mockAppStateChange).not.toBeNull();

  mockNotificationResponse!({
    notification: {
      request: {
        content: {
          data: {
            kind: 'automonique_review_attention_v2',
            server_identity: WORKSPACE_FIXTURE_IDENTITY,
            authorization_revision: '8',
            principal_generation: '3',
            workspace_id: 'workspace-34',
            workspace_revision: '12',
            review_revision: '7',
            file_id: null,
            hunk_id: null,
          },
        },
      },
    },
  });
  mockAppStateChange!('background');

  expect(mockNotificationRouterPush).not.toHaveBeenCalled();
  expect(mockNotificationSchedule).not.toHaveBeenCalled();
});

test('cold-start and already-background refreshes admit and schedule exact notifications', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  mockNotificationGetPermissions.mockResolvedValue({
    status: 'granted',
    canAskAgain: false,
  });
  const baseServer = workspaceCompanionFixture.servers[0]!;
  const liveServer = {
    ...baseServer,
    authorizationRevision: '9' as typeof baseServer.authorizationRevision,
  };
  const baseWorkspace = baseServer.workspaces[0]!;
  const workspace = {
    ...baseWorkspace,
    navigation: [
      ...baseWorkspace.navigation,
      { destination: 'review', revision: baseWorkspace.revision },
    ],
  };
  const snapshot = {
    schema: 'automonique.platform/review/v2',
    platform_version: 2n,
    revision: 7n,
    workspace: { kind: 'user_workspace', id: workspace.id },
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
          authority: { kind: 'review', id: 'review-local' },
          id: 'comment-1',
          kind: 'comment',
          revision: 5n,
        },
        reason: 'comment_reply',
        unread: 1n,
      },
    ],
    files: [
      {
        id: 'file-1',
        path: 'src/exact.ts',
        change: 'modified',
        conflict: 'none',
        worktree: 'unstaged',
        preview: {
          byte_size: 10n,
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
        body: 'Inspect this exact line.',
        id: 'comment-1',
        revision: 5n,
        unread: true,
      },
    ],
    proposals: [],
    review: {
      authority: { kind: 'review', id: 'review-local' },
      decision: 'pending',
      freshness: {
        observed_at_ms: 1n,
        observed_revision: 3n,
        state: 'fresh',
      },
    },
    pull_request: {
      authority: { kind: 'pull_request', id: 'pull-request-local' },
      freshness: {
        observed_at_ms: 1n,
        observed_revision: 1n,
        state: 'fresh',
      },
      head_revision: 'abc',
      id: '35',
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
  const built = {
    profile: { ...liveServer, workspaces: [workspace] },
    details: [
      {
        serverIdentity: liveServer.serverIdentity,
        workspaceId: workspace.id,
        workspaceRevision: workspace.revision,
        lineageAvailable: false,
        attention: null,
        lineage: null,
        sessionBindings: [],
        review: {
          snapshot,
          revision: '7',
          attentionState: 'needs_you',
          unread: 1,
          files: [
            {
              id: 'file-1',
              path: 'src/exact.ts',
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
          pullRequestId: '35',
          reviewDecision: 'pending',
          deliveryState: 'not_delivered',
          attentionReason: 'comment_reply',
          comments: snapshot.comments,
          checks: [],
          proposals: [],
          reviewAuthority: snapshot.review.authority,
          reviewFreshness: snapshot.review.freshness,
          pullRequest: snapshot.pull_request,
          delivery: snapshot.delivery,
        },
      },
    ],
    coverage: 'complete',
    omittedDetailCount: 0,
    omittedProjectCount: 0,
    omittedHostCount: 0,
    omittedWorkspaceCount: 0,
    omittedSessionCount: 0,
    failedProjectCount: 0,
    failedDetailCount: 0,
    successfulProjectIds: [workspace.projectId],
    failedProjectIds: [],
  };
  mockBuildWorkspaceServerCatalog.mockResolvedValue(built);
  const notificationData = {
    kind: 'automonique_review_attention_v2',
    server_identity: liveServer.serverIdentity,
    authorization_revision: liveServer.authorizationRevision,
    principal_generation: liveServer.principalGeneration,
    workspace_id: workspace.id,
    workspace_revision: workspace.revision,
    review_revision: '7',
    file_id: 'file-1',
    hunk_id: 'hunk-1',
  };
  mockNotificationGetLastResponse.mockResolvedValue({
    notification: { request: { content: { data: notificationData } } },
  });
  const pendingHandle = {
    project: workspace.projectId,
    workspace_id: workspace.id,
    action_kind: 'approve_review',
    idempotency_key: 'mobile-review-pending',
  };
  const pendingReviewReceipts = jest
    .fn()
    .mockResolvedValueOnce([pendingHandle])
    .mockResolvedValue([]);
  const reconcileReviewAction = jest.fn().mockResolvedValue({
    handle: pendingHandle,
    receipt: {
      schema: 'automonique.platform/review/v1',
      platform_version: 2n,
      receipt_id: 'receipt-pending',
      action_id: 'action-pending',
      actor: 'mobile-actor',
      idempotency_key: pendingHandle.idempotency_key,
      outcome: 'accepted',
      reconciliation: 'poll_receipt',
      revision: null,
      current_revision: null,
    },
    projectionRefreshRequired: false,
  });
  const gateway = {
    authorizationScope: {
      serverIdentity: liveServer.serverIdentity,
      actions: ['get_review', 'get_review_receipt'],
    },
    reviewEffectKinds: ['approve_review'],
    pendingReviewReceipts,
    reconcileReviewAction,
  };

  const view = await render(
    <WorkspaceProvider
      gateway={gateway as never}
      generationKey="live-notification"
      profile={{ origin: liveServer.origin } as never}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.getByText('live:1:active')).toBeTruthy());
  expect(pendingReviewReceipts).toHaveBeenCalledTimes(2);
  expect(reconcileReviewAction).toHaveBeenCalledWith(
    pendingHandle.idempotency_key,
    expect.any(AbortSignal),
  );
  expect(reconcileReviewAction.mock.invocationCallOrder[0]).toBeLessThan(
    mockBuildWorkspaceServerCatalog.mock.invocationCallOrder[0]!,
  );
  await waitFor(() =>
    expect(mockNotificationRouterPush).toHaveBeenCalledWith({
      pathname: '/workspace/[server]/[workspace]',
      params: {
        server: liveServer.serverIdentity,
        workspace: workspace.id,
        revision: workspace.revision,
        destination: 'review',
        review_revision: '7',
        file: 'file-1',
        hunk: 'hunk-1',
      },
    }),
  );
  expect(mockNotificationClearLastResponse).toHaveBeenCalledTimes(1);
  expect(mockAppStateChange).not.toBeNull();

  mockAppStateChange!('background');

  await waitFor(() =>
    expect(mockNotificationSchedule).toHaveBeenCalledTimes(1),
  );
  expect(mockNotificationSchedule).toHaveBeenCalledWith({
    content: {
      title: 'Automonique needs you',
      body: 'Open Automonique to inspect the current bounded request.',
      data: {
        ...notificationData,
        kind: 'automonique_review_attention_v3',
        check_id: null,
      },
    },
    trigger: null,
  });

  mockAppStateChange!('background');
  expect(mockNotificationSchedule).toHaveBeenCalledTimes(1);

  mockBuildWorkspaceServerCatalog.mockResolvedValue({
    ...built,
    details: built.details.map((detail) => ({
      ...detail,
      review: detail.review && {
        ...detail.review,
        revision: '8',
        snapshot: { ...detail.review.snapshot, revision: 8n },
      },
    })),
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('Refresh workspace catalog'));
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(mockNotificationSchedule).toHaveBeenCalledTimes(2),
  );
  expect(
    mockNotificationSchedule.mock.calls[1]![0].content.data.review_revision,
  ).toBe('8');

  mockNotificationResponse!({
    notification: {
      request: {
        content: {
          data: { ...notificationData, review_revision: '8' },
        },
      },
    },
  });
  expect(mockNotificationRouterPush).toHaveBeenCalledWith({
    pathname: '/workspace/[server]/[workspace]',
    params: {
      server: liveServer.serverIdentity,
      workspace: workspace.id,
      revision: workspace.revision,
      destination: 'review',
      review_revision: '8',
      file: 'file-1',
      hunk: 'hunk-1',
    },
  });

  mockNotificationResponse!({
    notification: {
      request: {
        content: { data: { ...notificationData, review_revision: '6' } },
      },
    },
  });
  expect(mockNotificationRouterPush).toHaveBeenCalledTimes(2);

  await act(async () => {
    view.rerender(
      <WorkspaceProvider
        gateway={null}
        generationKey="revoked-after-live-notification"
        profile={null}
      >
        <Probe />
      </WorkspaceProvider>,
    );
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(view.getByText('unavailable:1:cached')).toBeTruthy(),
  );
  await act(async () => {
    mockNotificationResponse!({
      notification: {
        request: {
          content: { data: { ...notificationData, review_revision: '8' } },
        },
      },
    });
    mockAppStateChange!('inactive');
    mockAppStateChange!('background');
    await Promise.resolve();
  });
  expect(mockNotificationRouterPush).toHaveBeenCalledTimes(2);
  expect(mockNotificationSchedule).toHaveBeenCalledTimes(2);
});
