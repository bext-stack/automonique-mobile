// SPDX-License-Identifier: Elastic-2.0

import {
  createContext,
  use,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import {
  mobileFleetLifecycle,
  type MobileFleetServer,
  type ReadOnlyWorkspaceServerGateway,
} from '@/core/mobile-fleet-lifecycle';
import { type MobileLifecycleState } from '@/core/mobile-lifecycle';
import type { MobileAutomoniqueGateway } from '@/core/types';
import type { WorkspaceV2Gateway } from '@/core/workspace-v2-gateway';
import type { MobilePairingOffer } from '@automonique/sdk';

import { MobileProvider } from './mobile-provider';
import {
  revokeWorkspaceCatalogCache,
  WorkspaceProvider,
} from './workspace-provider';

interface LifecycleContextValue {
  readonly state: MobileLifecycleState;
  readonly servers: readonly MobileFleetServer[];
  readonly selectedMutationSlotId: string | null;
  readonly refreshCredential: () => Promise<void>;
  readonly refreshServer: (slotId: string) => Promise<void>;
  readonly revokeCredential: () => Promise<void>;
  readonly revokeServer: (slotId: string) => Promise<void>;
  readonly selectServer: (slotId: string) => Promise<void>;
  readonly pair: (offer: MobilePairingOffer) => Promise<void>;
  readonly workspaceGateway: WorkspaceV2Gateway | null;
}

const LifecycleContext = createContext<LifecycleContextValue | null>(null);

function unavailableGateway(reason: string): MobileAutomoniqueGateway {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    bootstrap: unavailable,
    attach: unavailable,
    followUp: unavailable,
    decideApproval: unavailable,
    stopRun: unavailable,
    reconcile: unavailable,
  };
}

interface GatewayGeneration {
  readonly key: string;
  readonly scope: string;
  readonly gateway: MobileAutomoniqueGateway;
  readonly workspaceGateway: WorkspaceV2Gateway | null;
  readonly readOnlyWorkspaceServers: readonly ReadOnlyWorkspaceServerGateway[];
}

function storageScope(
  profile: NonNullable<MobileLifecycleState['profile']>,
): string {
  return `${profile.serverIdentity}:${profile.credentialId}:a${profile.authorizationRevision}`;
}

const INITIAL_GATEWAY: GatewayGeneration = {
  key: 'unpaired',
  scope: 'unpaired',
  gateway: unavailableGateway('mobile_pairing_required'),
  workspaceGateway: null,
  readOnlyWorkspaceServers: [],
};

function fleetGenerationKey(
  fleet: ReturnType<typeof mobileFleetLifecycle.snapshot>,
): string {
  return fleet.servers
    .map(({ slotId, state }) =>
      state.profile === null
        ? `${slotId}:${state.phase}`
        : `${slotId}:${state.phase}:${state.profile.serverIdentity}:a${state.profile.authorizationRevision}:c${state.profile.credentialRevision}`,
    )
    .join('|');
}

async function revokeCredentialGeneration(
  state: MobileLifecycleState,
  revoke: () => Promise<void>,
): Promise<void> {
  const identity = state.profile?.serverIdentity;
  const authorizationRevision = state.profile?.authorizationRevision;
  let cleanupResult: Promise<{ readonly error?: unknown }> = Promise.resolve(
    {},
  );
  if (identity !== undefined && authorizationRevision !== undefined) {
    try {
      // This call establishes the generation fence and aborts active workspace
      // operations synchronously, before either durable cleanup or remote
      // credential revocation can yield.
      cleanupResult = revokeWorkspaceCatalogCache(
        identity,
        authorizationRevision,
      ).then(
        () => ({}),
        (error: unknown) => ({ error }),
      );
    } catch (error) {
      cleanupResult = Promise.resolve({ error });
    }
  }
  let lifecycleError: unknown;
  try {
    // Workspace storage failure must never suppress remote-first revocation.
    // The lifecycle publishes `revoking` synchronously and replaces all live
    // gateways before its first remote await.
    await revoke();
  } catch (error) {
    lifecycleError = error;
  }
  const { error: cleanupError } = await cleanupResult;
  if (lifecycleError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [lifecycleError, cleanupError],
      'credential_and_workspace_revoke_failed',
    );
  }
  if (lifecycleError !== undefined) throw lifecycleError;
  if (cleanupError !== undefined) throw cleanupError;
}

/** Production composition root. Mock gateways must be passed explicitly in tests. */
export function ProductionMobileProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<MobileLifecycleState>(() =>
    mobileFleetLifecycle.selectedState(),
  );
  const [fleet, setFleet] = useState(() => mobileFleetLifecycle.snapshot());
  const [generation, setGeneration] =
    useState<GatewayGeneration>(INITIAL_GATEWAY);

  useEffect(() => {
    const unsubscribe = mobileFleetLifecycle.subscribe((nextFleet) => {
      setFleet(nextFleet);
      const next = mobileFleetLifecycle.selectedState();
      setState(next);
      const readOnlyWorkspaceServers =
        mobileFleetLifecycle.readOnlyWorkspaceGateways();
      const fleetKey = fleetGenerationKey(nextFleet);
      if (next.phase === 'ready' && next.profile !== null) {
        const scope = storageScope(next.profile);
        const key = `ready:${scope}:c${next.profile.credentialRevision}:f${nextFleet.authorityGeneration}:${fleetKey}`;
        setGeneration((current) =>
          current.key === key
            ? current
            : {
                key,
                scope,
                gateway: mobileFleetLifecycle.createGateway(),
                workspaceGateway: mobileFleetLifecycle.createWorkspaceGateway(),
                readOnlyWorkspaceServers,
              },
        );
      } else if (
        next.phase === 'unpaired' ||
        next.phase === 'recovery_required'
      ) {
        const reason =
          next.phase === 'recovery_required'
            ? next.reason
            : 'mobile_pairing_required';
        const scope =
          next.profile === null ? 'unpaired' : storageScope(next.profile);
        setGeneration({
          key: `${next.phase}:${scope}:${reason}`,
          scope,
          gateway: unavailableGateway(reason),
          workspaceGateway: null,
          readOnlyWorkspaceServers,
        });
      } else if (
        next.phase === 'loading' ||
        next.phase === 'pairing' ||
        next.phase === 'refresh_required' ||
        next.phase === 'refreshing' ||
        next.phase === 'revoking'
      ) {
        const scope =
          next.profile === null ? 'unpaired' : storageScope(next.profile);
        setGeneration({
          key: `${next.phase}:${scope}`,
          scope,
          gateway: unavailableGateway(`mobile_credential_${next.phase}`),
          workspaceGateway: null,
          readOnlyWorkspaceServers,
        });
      }
    });
    void mobileFleetLifecycle.hydrate();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active')
        mobileFleetLifecycle.validateCurrentAuthorizations();
    });
    return () => {
      appState.remove();
      unsubscribe();
      mobileFleetLifecycle.invalidateAllGateways();
    };
  }, []);

  return (
    <LifecycleContext.Provider
      value={{
        state,
        servers: fleet.servers,
        selectedMutationSlotId: fleet.selectedMutationSlotId,
        refreshCredential: async () => {
          await mobileFleetLifecycle.refresh();
        },
        refreshServer: async (slotId) => {
          await mobileFleetLifecycle.refresh(slotId);
        },
        revokeCredential: async () => {
          await revokeCredentialGeneration(state, () =>
            mobileFleetLifecycle.revoke(),
          );
        },
        revokeServer: async (slotId) => {
          const server = fleet.servers.find((entry) => entry.slotId === slotId);
          if (server === undefined)
            throw new Error('credential_registry_slot_missing');
          await revokeCredentialGeneration(server.state, () =>
            mobileFleetLifecycle.revoke(slotId),
          );
        },
        selectServer: async (slotId) => {
          await mobileFleetLifecycle.selectMutationSlot(slotId);
        },
        pair: async (offer) => {
          await mobileFleetLifecycle.pair(offer);
        },
        workspaceGateway: generation.workspaceGateway,
      }}
    >
      <MobileProvider
        key={generation.key}
        gateway={generation.gateway}
        storageScope={generation.scope}
      >
        <WorkspaceProvider
          key={generation.key}
          gateway={generation.workspaceGateway}
          generationKey={generation.key}
          profile={state.profile}
          readOnlyServers={generation.readOnlyWorkspaceServers}
          selectMutationServer={async (slotId) => {
            if (fleet.selectedMutationSlotId === slotId) return;
            await mobileFleetLifecycle.selectMutationSlot(slotId);
          }}
        >
          {children}
        </WorkspaceProvider>
      </MobileProvider>
    </LifecycleContext.Provider>
  );
}

export function useMobileLifecycle(): LifecycleContextValue {
  const context = use(LifecycleContext);
  if (context === null) throw new Error('ProductionMobileProvider is missing');
  return context;
}
