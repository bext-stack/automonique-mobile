// SPDX-License-Identifier: Elastic-2.0

import {
  loadCredentialRegistry,
  selectCredentialRegistryMutationSlot,
  type ConnectionProfile,
} from './credential-store';
import {
  MobileFleetLifecycleCoordinator,
  type MobileFleetState,
} from './mobile-fleet-lifecycle';
import {
  MobileLifecycleCoordinator,
  type MobileLifecycleDependencies,
  type MobileLifecycleState,
} from './mobile-lifecycle';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

jest.mock('./credential-store', () => ({
  addCredentialRegistryConnection: jest.fn(),
  loadCredentialRegistry: jest.fn(),
  revokeCredentialRegistrySlot: jest.fn(),
  rotateCredentialRegistryConnection: jest.fn(),
  saveCredentialRegistryWorkspaceAuthorization: jest.fn(),
  selectCredentialRegistryMutationSlot: jest.fn(),
}));

const loadRegistry = jest.mocked(loadCredentialRegistry);
const selectRegistry = jest.mocked(selectCredentialRegistryMutationSlot);

function profile(index: number): ConnectionProfile {
  return {
    origin: `https://ops-${index}.example.test`,
    platformEndpoint: `https://ops-${index}.example.test/api/platform`,
    serverIdentity: `sha256:${String(index).repeat(64)}`,
    credentialId: `credential-${index}`,
    actor: `operator-${index}`,
    issuedAtMs: '1',
    accessExpiresAtMs: '9999999999999',
    authorizationRevision: '1',
    credentialRevision: '1',
    actions: ['attach'],
    sessionScope: [`session-${index}`],
    maxPageEvents: 100,
    maxFollowUpBytes: 4096,
  };
}

function registry(slotIds: readonly string[], selected = slotIds[0] ?? null) {
  return {
    kind: 'ready' as const,
    registry: {
      selectedMutationSlotId: selected,
      malformedSlotIds: [],
      slots: slotIds.map((slotId) => ({ slotId, state: {} as never })),
    },
  };
}

class FakeLifecycle {
  readonly gateway = {
    bootstrap: jest.fn(),
    attach: jest.fn(),
    followUp: jest.fn(),
    decideApproval: jest.fn(),
    stopRun: jest.fn(),
    reconcile: jest.fn(),
  };
  readonly refresh = jest.fn(async () => ({}));
  readonly revoke = jest.fn(async () => undefined);
  readonly invalidateGateways = jest.fn(() => this.state);
  private readonly listeners = new Set<(state: MobileLifecycleState) => void>();
  private state: MobileLifecycleState;
  readonly workspaceGateway = {
    authorizationScope: {
      serverIdentity: '',
      tenantId: 'tenant',
      authorizationRevision: 1n,
      principalGeneration: 1n,
      delegationId: 'delegation',
      expiresAtMs: 9_999_999_999_999n,
      projectRoots: ['project'],
      actions: ['query_work_contexts'],
    },
    reviewEffectKinds: [],
    negotiate: jest.fn(),
    loadProject: jest.fn(),
    loadLineage: jest.fn(),
    loadReview: jest.fn(),
    executeReviewAction: jest.fn(),
    pendingReviewReceipts: jest.fn(),
    reconcileReviewAction: jest.fn(),
    prepareMutation: jest.fn(),
    confirmMutation: jest.fn(),
    pendingMutationReceipts: jest.fn(),
    reconcileMutation: jest.fn(),
    submitWorkspaceIntent: jest.fn(),
    getWorkspaceIntent: jest.fn(),
    cancelWorkspaceIntent: jest.fn(),
  };

  constructor(
    index: number,
    private readonly hydrateOperation: () => Promise<void>,
  ) {
    this.state = { phase: 'ready', profile: profile(index) };
    this.workspaceGateway.authorizationScope.serverIdentity =
      this.state.profile!.serverIdentity;
  }

  snapshot() {
    return this.state;
  }

  subscribe(listener: (state: MobileLifecycleState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async hydrate() {
    await this.hydrateOperation();
    return this.state;
  }

  validateCurrentAuthorization() {
    return this.state;
  }

  createGateway() {
    return this.gateway;
  }

  createWorkspaceGateway() {
    return this.workspaceGateway as never;
  }
}

function fleetWith(
  fakes: readonly FakeLifecycle[],
): MobileFleetLifecycleCoordinator {
  let index = 0;
  return new MobileFleetLifecycleCoordinator({
    now: () => 1_777_000_000_000,
    createCoordinator: (_dependencies: MobileLifecycleDependencies) =>
      fakes[index++]! as unknown as MobileLifecycleCoordinator,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('hydrates ready servers with a two-server bound and exposes read-only projections', async () => {
  let active = 0;
  let maximum = 0;
  const hydrate = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active -= 1;
  };
  const fakes = [
    new FakeLifecycle(1, hydrate),
    new FakeLifecycle(2, hydrate),
    new FakeLifecycle(3, hydrate),
  ];
  loadRegistry.mockResolvedValue(registry(['slot-1', 'slot-2', 'slot-3']));
  const fleet = fleetWith(fakes);

  await expect(fleet.hydrate()).resolves.toMatchObject({
    phase: 'ready',
    selectedMutationSlotId: 'slot-1',
    servers: [
      { slotId: 'slot-1', selected: true },
      { slotId: 'slot-2', selected: false },
      { slotId: 'slot-3', selected: false },
    ],
  });
  expect(maximum).toBe(2);
  const readOnly = fleet.readOnlyGateways();
  expect(readOnly).toHaveLength(3);
  expect(Object.keys(readOnly[1]!)).toEqual([
    'slotId',
    'bootstrap',
    'reconcile',
  ]);
  expect(readOnly[1]).not.toHaveProperty('attach');
  const workspaceReads = fleet.readOnlyWorkspaceGateways();
  expect(workspaceReads).toHaveLength(3);
  expect(Object.keys(workspaceReads[1]!.gateway)).toEqual([
    'authorizationScope',
    'negotiate',
    'loadProject',
    'loadLineage',
    'loadReview',
  ]);
  expect(workspaceReads[1]!.gateway).not.toHaveProperty('prepareMutation');
  expect(workspaceReads[1]!.gateway).not.toHaveProperty('executeReviewAction');
  expect(fleet.createGateway()).toBe(fakes[0]!.gateway);

  active = 0;
  maximum = 0;
  for (const fake of fakes) {
    fake.gateway.bootstrap.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return {} as never;
    });
  }
  await expect(fleet.discoverReadOnlySnapshots()).resolves.toMatchObject([
    { slotId: 'slot-1', kind: 'ready' },
    { slotId: 'slot-2', kind: 'ready' },
    { slotId: 'slot-3', kind: 'ready' },
  ]);
  expect(maximum).toBe(2);
  expect(
    fakes.every(({ gateway }) => gateway.attach.mock.calls.length === 0),
  ).toBe(true);
});

test('selection creates an authority gap and aborts the old exact generation', async () => {
  const fakes = [
    new FakeLifecycle(1, async () => undefined),
    new FakeLifecycle(2, async () => undefined),
  ];
  loadRegistry.mockResolvedValue(registry(['slot-1', 'slot-2']));
  let commitSelection!: () => void;
  selectRegistry.mockImplementation(
    async () =>
      new Promise<void>((resolve) => {
        commitSelection = resolve;
      }),
  );
  const fleet = fleetWith(fakes);
  await fleet.hydrate();
  const states: MobileFleetState[] = [];
  fleet.subscribe((state) => states.push(state));

  const selection = fleet.selectMutationSlot('slot-2');
  await Promise.resolve();
  expect(fakes[0]!.invalidateGateways).toHaveBeenCalledTimes(1);
  expect(fleet.selectedState()).toMatchObject({ phase: 'unpaired' });
  expect(() => fleet.createGateway()).toThrow('mobile_pairing_required');

  commitSelection();
  await selection;
  expect(selectRegistry).toHaveBeenCalledWith('slot-2');
  expect(fakes[1]!.invalidateGateways).toHaveBeenCalledTimes(1);
  expect(fleet.createGateway()).toBe(fakes[1]!.gateway);
  expect(
    states.some(
      ({ selectedMutationSlotId }) => selectedMutationSlotId === null,
    ),
  ).toBe(true);
});

test('selection final-ack failure reloads the durable winner before restoring authority', async () => {
  const fakes = [
    new FakeLifecycle(1, async () => undefined),
    new FakeLifecycle(2, async () => undefined),
  ];
  loadRegistry
    .mockResolvedValueOnce(registry(['slot-1', 'slot-2'], 'slot-1'))
    .mockResolvedValueOnce(registry(['slot-1', 'slot-2'], 'slot-2'));
  selectRegistry.mockRejectedValue(new Error('journal_delete_failed'));
  const fleet = fleetWith(fakes);
  await fleet.hydrate();
  const states: MobileFleetState[] = [];
  fleet.subscribe((state) => states.push(state));

  await expect(fleet.selectMutationSlot('slot-2')).rejects.toThrow(
    'journal_delete_failed',
  );

  expect(loadRegistry).toHaveBeenCalledTimes(2);
  expect(
    states.some(
      ({ phase, selectedMutationSlotId, reason }) =>
        phase === 'recovery_required' &&
        selectedMutationSlotId === null &&
        reason === 'credential_selection_recovery_required',
    ),
  ).toBe(true);
  expect(fakes[0]!.invalidateGateways).toHaveBeenCalledTimes(1);
  expect(fakes[1]!.invalidateGateways).toHaveBeenCalledTimes(1);
  expect(fleet.snapshot()).toMatchObject({
    phase: 'ready',
    selectedMutationSlotId: 'slot-2',
  });
  expect(fleet.createGateway()).toBe(fakes[1]!.gateway);
});

test('refreshes and revokes exact slots without invoking a sibling controller', async () => {
  const fakes = [
    new FakeLifecycle(1, async () => undefined),
    new FakeLifecycle(2, async () => undefined),
  ];
  loadRegistry
    .mockResolvedValueOnce(registry(['slot-1', 'slot-2']))
    .mockResolvedValueOnce(registry(['slot-1'], 'slot-1'));
  const fleet = fleetWith(fakes);
  await fleet.hydrate();

  await fleet.refresh('slot-2');
  expect(fakes[1]!.refresh).toHaveBeenCalledTimes(1);
  expect(fakes[0]!.refresh).not.toHaveBeenCalled();

  await fleet.revoke('slot-2');
  expect(fakes[1]!.revoke).toHaveBeenCalledTimes(1);
  expect(fakes[0]!.revoke).not.toHaveBeenCalled();
  expect(fleet.snapshot()).toMatchObject({
    selectedMutationSlotId: 'slot-1',
    servers: [{ slotId: 'slot-1' }],
  });
});

test('secure registry read failure resolves to a non-authorizing recovery state', async () => {
  loadRegistry.mockRejectedValue(new Error('secure_store_read_failed'));
  const fleet = fleetWith([]);

  await expect(fleet.hydrate()).resolves.toMatchObject({
    phase: 'recovery_required',
    reason: 'secure_store_read_failed',
    selectedMutationSlotId: null,
  });
  expect(fleet.selectedState()).toMatchObject({
    phase: 'recovery_required',
    reason: 'secure_store_read_failed',
  });
  expect(() => fleet.createGateway()).toThrow('mobile_pairing_required');
});
