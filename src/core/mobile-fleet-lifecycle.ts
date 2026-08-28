// SPDX-License-Identifier: Elastic-2.0

import type {
  IssuedMobileCredentials,
  MobileDiscovery,
  MobilePairingOffer,
} from '@automonique/sdk';

import {
  addCredentialRegistryConnection,
  loadCredentialRegistry,
  revokeCredentialRegistrySlot,
  rotateCredentialRegistryConnection,
  saveCredentialRegistryWorkspaceAuthorization,
  selectCredentialRegistryMutationSlot,
  type ConnectionProfile,
  type CredentialRegistrySlot,
  type ScopedConnection,
  type StoredConnection,
} from './credential-store';
import {
  MobileLifecycleCoordinator,
  type MobileLifecycleCredentialStore,
  type MobileLifecycleDependencies,
  type MobileLifecycleState,
} from './mobile-lifecycle';
import type { MobileAutomoniqueGateway } from './types';
import type {
  ReadOnlyWorkspaceV2Gateway,
  WorkspaceV2Gateway,
} from './workspace-v2-gateway';

const MAX_PARALLEL_SERVER_HYDRATIONS = 2;

export interface MobileFleetServer {
  readonly slotId: string;
  readonly selected: boolean;
  readonly state: MobileLifecycleState;
}

export interface MobileFleetState {
  readonly phase: 'loading' | 'ready' | 'recovery_required';
  readonly authorityGeneration: number;
  readonly selectedMutationSlotId: string | null;
  readonly servers: readonly MobileFleetServer[];
  readonly malformedSlotIds: readonly string[];
  readonly reason?: string;
}

export interface ReadOnlyMobileServerGateway {
  readonly slotId: string;
  readonly bootstrap: MobileAutomoniqueGateway['bootstrap'];
  readonly reconcile: MobileAutomoniqueGateway['reconcile'];
}

export interface ReadOnlyWorkspaceServerGateway {
  readonly slotId: string;
  readonly profile: ConnectionProfile;
  readonly gateway: ReadOnlyWorkspaceV2Gateway;
}

export type ReadOnlyMobileServerDiscovery =
  | {
      readonly slotId: string;
      readonly kind: 'ready';
      readonly snapshot: Awaited<
        ReturnType<MobileAutomoniqueGateway['bootstrap']>
      >;
    }
  | {
      readonly slotId: string;
      readonly kind: 'unavailable';
      readonly reason: string;
    };

type FleetListener = (state: MobileFleetState) => void;

interface MobileFleetDependencies extends MobileLifecycleDependencies {
  readonly createCoordinator?: (
    dependencies: MobileLifecycleDependencies,
  ) => MobileLifecycleCoordinator;
}

function registryStoredSlot(
  slots: readonly CredentialRegistrySlot[],
  slotId: string,
): StoredConnection {
  const slot = slots.find((entry) => entry.slotId === slotId);
  if (slot === undefined) throw new Error('credential_registry_slot_missing');
  return slot.state;
}

/**
 * Owns independent credential lifecycles while exposing mutation authority for
 * exactly one selected slot. Child gateways are never combined.
 */
export class MobileFleetLifecycleCoordinator {
  private readonly lifecycleDependencies: MobileLifecycleDependencies;
  private readonly createCoordinator: NonNullable<
    MobileFleetDependencies['createCoordinator']
  >;
  private readonly listeners = new Set<FleetListener>();
  private readonly coordinators = new Map<string, MobileLifecycleCoordinator>();
  private readonly unsubscribers = new Map<string, () => void>();
  private selectedMutationSlotId: string | null = null;
  private malformedSlotIds: readonly string[] = [];
  private recoveryReason: string | undefined;
  private authorityGeneration = 0;
  private hydrating = false;
  private state: MobileFleetState = {
    phase: 'loading',
    authorityGeneration: 0,
    selectedMutationSlotId: null,
    servers: [],
    malformedSlotIds: [],
  };
  private operationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: MobileFleetDependencies = {}) {
    const { createCoordinator, ...lifecycleDependencies } = dependencies;
    this.lifecycleDependencies = lifecycleDependencies;
    this.createCoordinator =
      createCoordinator ??
      ((childDependencies) =>
        new MobileLifecycleCoordinator(childDependencies));
  }

  snapshot(): MobileFleetState {
    return this.state;
  }

  selectedState(): MobileLifecycleState {
    if (this.hydrating) return { phase: 'loading', profile: null };
    if (this.recoveryReason !== undefined) {
      return {
        phase: 'recovery_required',
        profile:
          this.selectedMutationSlotId === null
            ? null
            : (this.coordinators.get(this.selectedMutationSlotId)?.snapshot()
                .profile ?? null),
        reason: this.recoveryReason,
      };
    }
    if (this.selectedMutationSlotId === null) {
      return { phase: 'unpaired', profile: null };
    }
    return (
      this.coordinators.get(this.selectedMutationSlotId)?.snapshot() ?? {
        phase: 'recovery_required',
        profile: null,
        reason: 'selected_slot_unavailable',
      }
    );
  }

  subscribe(listener: FleetListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    const servers = [...this.coordinators.entries()].map(
      ([slotId, coordinator]) => ({
        slotId,
        selected: slotId === this.selectedMutationSlotId,
        state: coordinator.snapshot(),
      }),
    );
    this.state = {
      phase: this.hydrating
        ? 'loading'
        : this.recoveryReason === undefined
          ? 'ready'
          : 'recovery_required',
      authorityGeneration: this.authorityGeneration,
      selectedMutationSlotId: this.selectedMutationSlotId,
      servers,
      malformedSlotIds: this.malformedSlotIds,
      ...(this.recoveryReason === undefined
        ? {}
        : { reason: this.recoveryReason }),
    };
    for (const listener of this.listeners) listener(this.state);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private storeFor(slotReference: {
    value: string | null;
  }): MobileLifecycleCredentialStore {
    const requireSlot = (): string => {
      if (slotReference.value === null) {
        throw new Error('credential_registry_slot_missing');
      }
      return slotReference.value;
    };
    return {
      load: async (now) => {
        if (slotReference.value === null) return null;
        const loaded = await loadCredentialRegistry(now);
        if (loaded.kind !== 'ready') {
          throw new Error(`credential_registry_${loaded.reason}`);
        }
        return registryStoredSlot(loaded.registry.slots, slotReference.value);
      },
      saveIssued: async (
        discovery: Pick<
          MobileDiscovery,
          'origin' | 'platform_endpoint' | 'server_identity'
        >,
        issued: IssuedMobileCredentials,
        now: number,
        previous?: ScopedConnection,
      ) => {
        if (previous === undefined) {
          const added = await addCredentialRegistryConnection(
            discovery,
            issued,
            now,
          );
          slotReference.value = added.slotId;
          return added.state.connection;
        }
        return (
          await rotateCredentialRegistryConnection(
            requireSlot(),
            discovery,
            issued,
            now,
          )
        ).state.connection;
      },
      saveWorkspaceAuthorization: async (_connection, value, now) =>
        saveCredentialRegistryWorkspaceAuthorization(requireSlot(), value, now),
      revoke: async () => revokeCredentialRegistrySlot(requireSlot()),
    };
  }

  private attachCoordinator(
    slotId: string,
    existing?: MobileLifecycleCoordinator,
  ): MobileLifecycleCoordinator {
    const current = this.coordinators.get(slotId);
    if (current !== undefined) return current;
    const coordinator =
      existing ??
      this.createCoordinator({
        ...this.lifecycleDependencies,
        credentialStore: this.storeFor({ value: slotId }),
      });
    this.coordinators.set(slotId, coordinator);
    this.unsubscribers.set(
      slotId,
      coordinator.subscribe(() => {
        if (!this.hydrating) this.publish();
      }),
    );
    return coordinator;
  }

  private detachMissingSlots(slotIds: ReadonlySet<string>): void {
    for (const [slotId, coordinator] of this.coordinators) {
      if (slotIds.has(slotId)) continue;
      coordinator.invalidateGateways();
      this.unsubscribers.get(slotId)?.();
      this.unsubscribers.delete(slotId);
      this.coordinators.delete(slotId);
    }
  }

  async hydrate(): Promise<MobileFleetState> {
    return this.exclusive(async () => {
      this.hydrating = true;
      this.authorityGeneration += 1;
      this.recoveryReason = undefined;
      this.publish();
      let loaded: Awaited<ReturnType<typeof loadCredentialRegistry>>;
      try {
        loaded = await loadCredentialRegistry(
          this.lifecycleDependencies.now?.() ?? Date.now(),
        );
      } catch (error) {
        this.hydrating = false;
        this.recoveryReason =
          error instanceof Error
            ? error.message
            : 'credential_registry_load_failed';
        this.publish();
        return this.state;
      }
      this.selectedMutationSlotId = loaded.registry.selectedMutationSlotId;
      this.malformedSlotIds = loaded.registry.malformedSlotIds;
      if (loaded.kind !== 'ready') this.recoveryReason = loaded.reason;
      const slotIds = new Set(
        loaded.registry.slots.map(({ slotId }) => slotId),
      );
      this.detachMissingSlots(slotIds);
      const pending = loaded.registry.slots.map(({ slotId }) =>
        this.attachCoordinator(slotId),
      );
      for (
        let offset = 0;
        offset < pending.length;
        offset += MAX_PARALLEL_SERVER_HYDRATIONS
      ) {
        await Promise.allSettled(
          pending
            .slice(offset, offset + MAX_PARALLEL_SERVER_HYDRATIONS)
            .map((coordinator) => coordinator.hydrate()),
        );
      }
      this.hydrating = false;
      if (
        this.selectedMutationSlotId !== null &&
        !this.coordinators.has(this.selectedMutationSlotId)
      ) {
        this.recoveryReason = 'selected_slot_unavailable';
      }
      this.publish();
      return this.state;
    });
  }

  async pair(offer: MobilePairingOffer): Promise<void> {
    return this.exclusive(async () => {
      const slotReference = { value: null as string | null };
      const coordinator = this.createCoordinator({
        ...this.lifecycleDependencies,
        credentialStore: this.storeFor(slotReference),
      });
      try {
        await coordinator.pair(offer);
      } catch (error) {
        try {
          const loaded = await loadCredentialRegistry(
            this.lifecycleDependencies.now?.() ?? Date.now(),
          );
          const pending: MobileLifecycleCoordinator[] = [];
          for (const { slotId } of loaded.registry.slots) {
            if (slotId === slotReference.value) {
              this.attachCoordinator(slotId, coordinator);
            } else if (!this.coordinators.has(slotId)) {
              pending.push(this.attachCoordinator(slotId));
            }
          }
          for (
            let offset = 0;
            offset < pending.length;
            offset += MAX_PARALLEL_SERVER_HYDRATIONS
          ) {
            await Promise.allSettled(
              pending
                .slice(offset, offset + MAX_PARALLEL_SERVER_HYDRATIONS)
                .map((entry) => entry.hydrate()),
            );
          }
          this.selectedMutationSlotId = loaded.registry.selectedMutationSlotId;
          this.malformedSlotIds = loaded.registry.malformedSlotIds;
          this.recoveryReason =
            loaded.kind === 'ready' ? undefined : loaded.reason;
          this.publish();
        } catch {
          // Preserve the original pairing failure. A later hydration can
          // recover a secure commit whose final acknowledgement was lost.
        }
        throw error;
      }
      const slotId = slotReference.value;
      if (slotId === null) throw new Error('pairing_commit_uncertain');
      this.attachCoordinator(slotId, coordinator);
      const loaded = await loadCredentialRegistry(
        this.lifecycleDependencies.now?.() ?? Date.now(),
      );
      this.selectedMutationSlotId = loaded.registry.selectedMutationSlotId;
      this.malformedSlotIds = loaded.registry.malformedSlotIds;
      this.recoveryReason = loaded.kind === 'ready' ? undefined : loaded.reason;
      this.publish();
    });
  }

  async selectMutationSlot(slotId: string): Promise<void> {
    return this.exclusive(async () => {
      const next = this.coordinators.get(slotId);
      if (next === undefined)
        throw new Error('credential_registry_slot_missing');
      const previousSlotId = this.selectedMutationSlotId;
      const previous =
        previousSlotId === null
          ? undefined
          : this.coordinators.get(previousSlotId);
      previous?.invalidateGateways();
      this.authorityGeneration += 1;
      this.selectedMutationSlotId = null;
      this.publish();
      try {
        await selectCredentialRegistryMutationSlot(slotId);
        next.invalidateGateways();
        this.selectedMutationSlotId = slotId;
        this.recoveryReason = undefined;
        this.publish();
      } catch (error) {
        this.selectedMutationSlotId = null;
        this.recoveryReason = 'credential_selection_recovery_required';
        this.publish();
        try {
          const loaded = await loadCredentialRegistry(
            this.lifecycleDependencies.now?.() ?? Date.now(),
          );
          const durableSlotId = loaded.registry.selectedMutationSlotId;
          const durable =
            durableSlotId === null
              ? undefined
              : this.coordinators.get(durableSlotId);
          durable?.invalidateGateways();
          this.selectedMutationSlotId =
            durableSlotId !== null && durable === undefined
              ? null
              : durableSlotId;
          this.malformedSlotIds = loaded.registry.malformedSlotIds;
          this.recoveryReason =
            loaded.kind !== 'ready'
              ? loaded.reason
              : durableSlotId !== null && durable === undefined
                ? 'selected_slot_unavailable'
                : undefined;
        } catch (recoveryError) {
          this.selectedMutationSlotId = null;
          this.recoveryReason =
            recoveryError instanceof Error
              ? recoveryError.message
              : 'credential_selection_recovery_required';
        }
        this.publish();
        throw error;
      }
    });
  }

  async refresh(slotId = this.selectedMutationSlotId): Promise<void> {
    if (slotId === null) throw new Error('mobile_pairing_required');
    const coordinator = this.coordinators.get(slotId);
    if (coordinator === undefined)
      throw new Error('credential_registry_slot_missing');
    try {
      await coordinator.refresh();
    } catch (error) {
      await this.hydrate();
      throw error;
    }
  }

  async revoke(slotId = this.selectedMutationSlotId): Promise<void> {
    if (slotId === null) throw new Error('mobile_pairing_required');
    return this.exclusive(async () => {
      const coordinator = this.coordinators.get(slotId);
      if (coordinator === undefined)
        throw new Error('credential_registry_slot_missing');
      coordinator.invalidateGateways();
      await coordinator.revoke();
      this.unsubscribers.get(slotId)?.();
      this.unsubscribers.delete(slotId);
      this.coordinators.delete(slotId);
      const loaded = await loadCredentialRegistry(
        this.lifecycleDependencies.now?.() ?? Date.now(),
      );
      this.selectedMutationSlotId = loaded.registry.selectedMutationSlotId;
      this.malformedSlotIds = loaded.registry.malformedSlotIds;
      this.recoveryReason = loaded.kind === 'ready' ? undefined : loaded.reason;
      this.publish();
    });
  }

  validateCurrentAuthorizations(): void {
    for (const coordinator of this.coordinators.values()) {
      coordinator.validateCurrentAuthorization();
    }
  }

  invalidateAllGateways(): void {
    for (const coordinator of this.coordinators.values()) {
      coordinator.invalidateGateways();
    }
    this.authorityGeneration += 1;
    this.publish();
  }

  createGateway(): MobileAutomoniqueGateway {
    if (this.selectedMutationSlotId === null)
      throw new Error('mobile_pairing_required');
    const coordinator = this.coordinators.get(this.selectedMutationSlotId);
    if (coordinator === undefined)
      throw new Error('credential_registry_slot_missing');
    return coordinator.createGateway();
  }

  createWorkspaceGateway(): WorkspaceV2Gateway | null {
    if (this.selectedMutationSlotId === null)
      throw new Error('mobile_pairing_required');
    const coordinator = this.coordinators.get(this.selectedMutationSlotId);
    if (coordinator === undefined)
      throw new Error('credential_registry_slot_missing');
    return coordinator.createWorkspaceGateway();
  }

  /**
   * Project only bounded Platform v2 reads for every ready slot. Full child
   * gateways, receipt stores, commands, and tokens never cross this
   * fan-out boundary.
   */
  readOnlyWorkspaceGateways(): readonly ReadOnlyWorkspaceServerGateway[] {
    const gateways: ReadOnlyWorkspaceServerGateway[] = [];
    for (const [slotId, coordinator] of this.coordinators) {
      const state = coordinator.snapshot();
      if (state.phase !== 'ready' || state.profile === null) continue;
      let gateway: WorkspaceV2Gateway | null;
      try {
        gateway = coordinator.createWorkspaceGateway();
      } catch {
        // One expired or concurrently replaced slot cannot suppress siblings.
        continue;
      }
      if (gateway === null) continue;
      gateways.push({
        slotId,
        profile: state.profile,
        gateway: {
          authorizationScope: gateway.authorizationScope,
          negotiate: gateway.negotiate,
          loadProject: gateway.loadProject,
          loadLineage: gateway.loadLineage,
          loadReview: gateway.loadReview,
        },
      });
    }
    return gateways;
  }

  readOnlyGateways(): readonly ReadOnlyMobileServerGateway[] {
    const gateways: ReadOnlyMobileServerGateway[] = [];
    for (const [slotId, coordinator] of this.coordinators) {
      if (coordinator.snapshot().phase !== 'ready') continue;
      const gateway = coordinator.createGateway();
      gateways.push({
        slotId,
        bootstrap: gateway.bootstrap,
        reconcile: gateway.reconcile,
      });
    }
    return gateways;
  }

  /** Fetch one bounded read-only snapshot per ready slot; never expose commands. */
  async discoverReadOnlySnapshots(
    signal?: AbortSignal,
  ): Promise<readonly ReadOnlyMobileServerDiscovery[]> {
    const gateways = this.readOnlyGateways();
    const discovered: ReadOnlyMobileServerDiscovery[] = [];
    for (
      let offset = 0;
      offset < gateways.length;
      offset += MAX_PARALLEL_SERVER_HYDRATIONS
    ) {
      const batch = await Promise.all(
        gateways
          .slice(offset, offset + MAX_PARALLEL_SERVER_HYDRATIONS)
          .map(async ({ slotId, bootstrap }) => {
            try {
              return {
                slotId,
                kind: 'ready' as const,
                snapshot: await bootstrap(signal),
              };
            } catch (error) {
              return {
                slotId,
                kind: 'unavailable' as const,
                reason:
                  error instanceof Error
                    ? error.message
                    : 'mobile_server_discovery_failed',
              };
            }
          }),
      );
      discovered.push(...batch);
    }
    return discovered;
  }
}

export const mobileFleetLifecycle = new MobileFleetLifecycleCoordinator();
