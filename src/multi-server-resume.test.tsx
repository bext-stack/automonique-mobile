// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState, type PropsWithChildren, type ReactNode } from 'react';

import type { LineageProjection, WorkContextRecord } from '@automonique/sdk';

import WorkspacesScreen from './app/(tabs)/workspaces';
import WorkspaceDetailScreen from './app/workspace/[server]/[workspace]';
import ExactWorkspaceSessionLink from './app/workspace/[server]/[workspace]/session/[session]';
import type { ConnectionProfile } from './core/credential-store';
import { decimalRevision, type SessionSummary } from './core/types';
import type { WorkspaceV2Gateway } from './core/workspace-v2-gateway';
import { WorkspaceProvider } from './providers/workspace-provider';

let mockRouteParams: Record<string, string> = {};
const mockRedirect = jest.fn();
const mockRouterPush = jest.fn();
let mockLinkHrefs: readonly unknown[] = [];
let mockSelectedSlotId = 'slot-a';

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

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  PermissionStatus: { GRANTED: 'granted' },
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true }),
  ),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'denied', canAskAgain: false }),
  ),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notification')),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/theme/palette', () => ({
  usePalette: () => ({
    accent: '#070',
    accentText: '#fff',
    background: '#fff',
    border: '#ddd',
    danger: '#a00',
    surface: '#fff',
    surfaceMuted: '#eee',
    text: '#000',
    textMuted: '#666',
    warning: '#850',
  }),
}));

// The production composition root swaps the selected credential profile and
// the retained v1 projection together with the mutation slot. These doubles
// reproduce exactly that binding, so the deep-link scope gate is exercised
// rather than bypassed.
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
      sessions: mockRetainedSessionsFor(mockSelectedSlotId),
    },
  }),
}));
jest.mock('@/providers/production-mobile-provider', () => ({
  useMobileLifecycle: () => ({
    state: {
      phase: 'ready',
      profile: mockServerFor(mockSelectedSlotId).profile,
    },
    workspaceGateway: null,
  }),
}));

interface AuthorizedServer {
  readonly slotId: string;
  readonly identity: string;
  readonly tenantId: string;
  readonly origin: string;
  readonly hostLabel: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly workspaceRevision: bigint;
  readonly workSessionId: string;
  readonly workSessionRevision: bigint;
  readonly retainedSessionId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly authorizationRevision: bigint;
  readonly principalGeneration: bigint;
  readonly profile: ConnectionProfile;
}

function connectionProfile(
  index: string,
  origin: string,
  identity: string,
  authorizationRevision: bigint,
): ConnectionProfile {
  return {
    origin,
    platformEndpoint: `${origin}/api/platform`,
    serverIdentity: identity,
    credentialId: `credential-${index}`,
    actor: `operator-${index}`,
    issuedAtMs: '1',
    accessExpiresAtMs: '9999999999999',
    authorizationRevision: authorizationRevision.toString(),
    credentialRevision: '1',
    actions: ['attach'],
    sessionScope: [],
    maxPageEvents: 100,
    maxFollowUpBytes: 4096,
  };
}

const serverA: AuthorizedServer = {
  slotId: 'slot-a',
  identity: `sha256:${'a'.repeat(64)}`,
  tenantId: 'tenant-paris',
  origin: 'https://ops-a.example.test',
  hostLabel: 'Paris builder',
  projectId: 'project-a',
  workspaceId: 'workspace-a',
  workspaceRevision: 12n,
  workSessionId: 'work-session-a',
  workSessionRevision: 9n,
  retainedSessionId: 'session-a',
  taskKey: '#34',
  taskTitle: 'Add a read-mostly workspace companion',
  authorizationRevision: 8n,
  principalGeneration: 3n,
  profile: connectionProfile(
    'a',
    'https://ops-a.example.test',
    `sha256:${'a'.repeat(64)}`,
    8n,
  ),
};

const serverB: AuthorizedServer = {
  slotId: 'slot-b',
  identity: `sha256:${'b'.repeat(64)}`,
  tenantId: 'tenant-barcelona',
  origin: 'https://ops-b.example.test',
  hostLabel: 'Barcelona builder',
  projectId: 'project-b',
  workspaceId: 'workspace-b',
  workspaceRevision: 21n,
  workSessionId: 'work-session-b',
  workSessionRevision: 5n,
  retainedSessionId: 'session-b',
  taskKey: '#166',
  taskTitle: 'Carry the retained provider session across hosts',
  authorizationRevision: 41n,
  principalGeneration: 7n,
  profile: connectionProfile(
    'b',
    'https://ops-b.example.test',
    `sha256:${'b'.repeat(64)}`,
    41n,
  ),
};

const servers = [serverA, serverB];

function mockServerFor(slotId: string): AuthorizedServer {
  const server = servers.find((candidate) => candidate.slotId === slotId);
  if (server === undefined) throw new Error('unknown_test_slot');
  return server;
}

function mockRetainedSessionsFor(slotId: string): readonly SessionSummary[] {
  const server = mockServerFor(slotId);
  return [
    {
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: server.retainedSessionId,
        },
        revision: decimalRevision(server.workSessionRevision.toString()),
      },
      title: 'Retained provider session',
      run: null,
      state: 'waiting',
      attachable: true,
      followUpAllowed: false,
      followUpFenceRevision: null,
      observedAt: '2026-08-29T08:00:00Z',
      lastCursor: 'cursor-1',
    },
  ];
}

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

/** One typed Platform v2 project graph per authorized server. */
function projectRecords(
  server: AuthorizedServer,
): readonly WorkContextRecord[] {
  return [
    record({ kind: 'project', id: server.projectId } as never, 'Delivery'),
    record(
      { kind: 'host_setup', id: `${server.projectId}-host` } as never,
      server.hostLabel,
      [
        {
          kind: 'host_setup_project',
          target: { kind: 'project', id: server.projectId } as never,
        },
      ],
    ),
    record(
      { kind: 'checkout', id: `${server.workspaceId}-checkout` } as never,
      'Checkout',
      [
        {
          kind: 'checkout_project',
          target: { kind: 'project', id: server.projectId } as never,
        },
        {
          kind: 'checkout_host_setup',
          target: {
            kind: 'host_setup',
            id: `${server.projectId}-host`,
          } as never,
        },
        {
          kind: 'checkout_repository',
          target: {
            kind: 'repository',
            resource: {
              authority: 'github',
              kind: 'repository',
              id: `bext-stack/${server.projectId}`,
            },
          } as never,
        },
      ],
    ),
    record(
      { kind: 'user_workspace', id: server.workspaceId } as never,
      `Workspace on ${server.hostLabel}`,
      [
        {
          kind: 'user_workspace_project',
          target: { kind: 'project', id: server.projectId } as never,
        },
        {
          kind: 'user_workspace_checkout',
          target: {
            kind: 'checkout',
            id: `${server.workspaceId}-checkout`,
          } as never,
        },
      ],
      'running',
      server.workspaceRevision,
    ),
    record(
      {
        kind: 'attempt_workspace',
        id: `${server.workspaceId}-attempt`,
      } as never,
      'Attempt',
      [
        {
          kind: 'attempt_user_workspace',
          target: {
            kind: 'user_workspace',
            id: server.workspaceId,
          } as never,
        },
      ],
      'hibernated',
      3n,
    ),
    record(
      { kind: 'session', id: server.workSessionId } as never,
      'Retained provider session',
      [
        {
          kind: 'session_attempt_workspace',
          target: {
            kind: 'attempt_workspace',
            id: `${server.workspaceId}-attempt`,
          } as never,
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: {
              authority: 'automonique',
              kind: 'session',
              id: server.retainedSessionId,
            },
          } as never,
        },
      ],
      'active',
      server.workSessionRevision,
    ),
  ];
}

function lineage(server: AuthorizedServer): LineageProjection {
  return {
    schema: 'automonique.platform/v2',
    workspace: server.workspaceId,
    external_work_items: [
      {
        freshness: {
          observed_at_ms: 2_000n,
          stale_after_ms: 5_000n,
          state: 'fresh',
        },
        identity: {
          authority: 'tracker',
          key: server.taskKey,
          provider: 'github',
          scope: 'bext-stack/automonique',
        },
        latest_useful_message: {
          observed_at_ms: 2_000n,
          text: server.taskTitle,
        },
        moved_to: null,
        origin: {
          attempt: null,
          pane: null,
          session: null,
          workspace: server.workspaceId,
        },
        revision: 1n,
        state: 'open',
        workspace: server.workspaceId,
      },
    ],
    orchestration: [],
  } as unknown as LineageProjection;
}

/**
 * One bounded Platform v2 read projection per authorized server. The delegated
 * scope carries only that server's own tenant, authorization revision, and
 * principal generation, so the resume gate has to agree with the exact host it
 * came from.
 */
function readGateway(server: AuthorizedServer) {
  return {
    authorizationScope: {
      serverIdentity: server.identity,
      tenantId: server.tenantId,
      authorizationRevision: server.authorizationRevision,
      principalGeneration: server.principalGeneration,
      delegationId: `delegation-${server.slotId}`,
      expiresAtMs: BigInt(Date.now() + 600_000),
      projectRoots: [server.projectId],
      actions: ['query_work_contexts', 'get_lineage'],
    },
    negotiate: jest.fn(() => Promise.resolve()),
    loadProject: jest.fn(() => Promise.resolve(projectRecords(server))),
    loadLineage: jest.fn(() => Promise.resolve(lineage(server))),
    loadReview: jest.fn(() => Promise.reject(new Error('review_not_granted'))),
    loadAttentionSourceSnapshot: jest.fn(() =>
      Promise.reject(new Error('attention_not_granted')),
    ),
  };
}

const readGateways = new Map(
  servers.map((server) => [server.slotId, readGateway(server)]),
);

const readOnlyServers = servers.map((server) => ({
  slotId: server.slotId,
  profile: server.profile,
  gateway: readGateways.get(server.slotId)!,
}));

/**
 * The mutation-authority half of the selected slot: the same bounded reads
 * plus the selected identity. No effect, receipt, or preview capability is
 * granted, so nothing here can mutate a sibling server.
 */
function selectedGateway(server: AuthorizedServer): WorkspaceV2Gateway {
  return {
    ...readGateways.get(server.slotId)!,
    reviewEffectKinds: [],
  } as unknown as WorkspaceV2Gateway;
}

function Composition({ children }: PropsWithChildren) {
  const [slotId, setSlotId] = useState(mockSelectedSlotId);
  const server = mockServerFor(slotId);
  return (
    <WorkspaceProvider
      gateway={selectedGateway(server)}
      generationKey={`ready:${slotId}`}
      profile={server.profile}
      readOnlyServers={readOnlyServers as never}
      retainedSessions={mockRetainedSessionsFor(slotId)}
      selectMutationServer={async (next) => {
        // Mirrors the production root: the credential slot, the retained v1
        // projection, and the workspace gateway all move together.
        mockSelectedSlotId = next;
        setSlotId(next);
      }}
    >
      {children}
    </WorkspaceProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLinkHrefs = [];
  mockRouteParams = {};
  mockSelectedSlotId = 'slot-a';
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
});

test('a task found on a second authorized host resumes its retained session from the phone', async () => {
  const view = await render(
    <Composition>
      <WorkspacesScreen />
    </Composition>,
  );

  // 1. Both authorized hosts are discovered independently, and the first slot
  //    holds mutation authority.
  await waitFor(() =>
    expect(view.getByText('Live workspace inventory')).toBeTruthy(),
  );
  expect(
    view.getByLabelText('ops-a.example.test, active authorization'),
  ).toBeTruthy();
  expect(
    view.getByLabelText('ops-b.example.test, active authorization'),
  ).toBeTruthy();
  expect(
    view.queryByLabelText(
      'Open Workspace on Barcelona builder on Barcelona builder',
    ),
  ).toBeNull();

  // 2. Search reaches the task that lives on the other authorized host.
  await act(async () => {
    fireEvent.changeText(
      view.getByLabelText(
        'Search projects, hosts, workspaces, and external tasks',
      ),
      serverB.taskKey,
    );
    await Promise.resolve();
  });
  const card = view.getByLabelText(
    'Open Workspace on Barcelona builder on Barcelona builder',
  );

  // 3. Opening it moves the mutation slot to the second server.
  await act(async () => {
    fireEvent.press(card);
    await Promise.resolve();
  });
  await waitFor(() => expect(mockSelectedSlotId).toBe('slot-b'));
  expect(mockRouterPush).toHaveBeenCalledWith({
    pathname: '/workspace/[server]/[workspace]',
    params: {
      server: serverB.identity,
      workspace: serverB.workspaceId,
      revision: serverB.workspaceRevision.toString(),
    },
  });

  // 4. The second server's workspace offers its exact retained-session link.
  mockRouteParams = {
    server: serverB.identity,
    workspace: serverB.workspaceId,
    revision: serverB.workspaceRevision.toString(),
  };
  const detail = await render(
    <Composition>
      <WorkspaceDetailScreen />
    </Composition>,
  );
  await waitFor(() =>
    expect(detail.getByText('Workspace on Barcelona builder')).toBeTruthy(),
  );
  const sessionHref = mockLinkHrefs.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'pathname' in candidate &&
      candidate.pathname ===
        '/workspace/[server]/[workspace]/session/[session]',
  ) as { readonly params: Record<string, string> } | undefined;
  expect(sessionHref).toBeDefined();
  expect(sessionHref!.params).toMatchObject({
    server: serverB.identity,
    tenant: serverB.tenantId,
    authorization_revision: serverB.authorizationRevision.toString(),
    principal_generation: serverB.principalGeneration.toString(),
    workspace: serverB.workspaceId,
    revision: serverB.workspaceRevision.toString(),
    session: serverB.retainedSessionId,
    work_session: serverB.workSessionId,
    relation_revision: serverB.workSessionRevision.toString(),
    session_revision: serverB.workSessionRevision.toString(),
  });

  // 5. The deep link resumes the second server's retained session.
  mockRouteParams = sessionHref!.params;
  await render(
    <Composition>
      <ExactWorkspaceSessionLink />
    </Composition>,
  );
  await waitFor(() =>
    expect(mockRedirect).toHaveBeenCalledWith({
      pathname: '/session/[id]',
      params: expect.objectContaining({
        id: serverB.retainedSessionId,
        scope_server: serverB.identity,
        scope_tenant: serverB.tenantId,
        scope_workspace: serverB.workspaceId,
        scope_workspace_revision: serverB.workspaceRevision.toString(),
        scope_work_session: serverB.workSessionId,
        scope_authorization_revision: serverB.authorizationRevision.toString(),
        scope_principal_generation: serverB.principalGeneration.toString(),
      }),
    }),
  );
});

test('the second host refuses its retained session while the first slot still holds authority', async () => {
  mockRouteParams = {
    server: serverB.identity,
    tenant: serverB.tenantId,
    authorization_revision: serverB.authorizationRevision.toString(),
    principal_generation: serverB.principalGeneration.toString(),
    workspace: serverB.workspaceId,
    revision: serverB.workspaceRevision.toString(),
    destination: 'chat',
    session: serverB.retainedSessionId,
    work_session: serverB.workSessionId,
    relation_revision: serverB.workSessionRevision.toString(),
    session_revision: serverB.workSessionRevision.toString(),
    session_authority: 'automonique',
    session_kind: 'session',
  };
  const view = await render(
    <Composition>
      <WorkspacesScreen />
      <ExactWorkspaceSessionLink />
    </Composition>,
  );
  // The catalog is live and already carries the second host, so the refusal
  // can only come from the mutation slot still resting on the first server.
  await waitFor(() =>
    expect(view.getByText('Live workspace inventory')).toBeTruthy(),
  );
  expect(
    view.getByLabelText('ops-b.example.test, active authorization'),
  ).toBeTruthy();
  expect(view.getByText('Retained session unavailable')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
  expect(mockSelectedSlotId).toBe('slot-a');

  // Moving the slot to that host, and nothing else, admits the same link.
  await act(async () => {
    fireEvent.press(
      view.getByLabelText('ops-b.example.test, active authorization'),
    );
    await Promise.resolve();
  });
  await waitFor(() => expect(mockSelectedSlotId).toBe('slot-b'));
  await waitFor(() =>
    expect(mockRedirect).toHaveBeenCalledWith({
      pathname: '/session/[id]',
      params: expect.objectContaining({
        id: serverB.retainedSessionId,
        scope_server: serverB.identity,
      }),
    }),
  );
});
