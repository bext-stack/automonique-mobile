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
  mobileLifecycle,
  type MobileLifecycleState,
} from '@/core/mobile-lifecycle';
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
  readonly refreshCredential: () => Promise<void>;
  readonly revokeCredential: () => Promise<void>;
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
};

/** Production composition root. Mock gateways must be passed explicitly in tests. */
export function ProductionMobileProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<MobileLifecycleState>(() =>
    mobileLifecycle.snapshot(),
  );
  const [generation, setGeneration] =
    useState<GatewayGeneration>(INITIAL_GATEWAY);

  useEffect(() => {
    const unsubscribe = mobileLifecycle.subscribe((next) => {
      setState(next);
      if (next.phase === 'ready' && next.profile !== null) {
        const scope = storageScope(next.profile);
        const key = `ready:${scope}:c${next.profile.credentialRevision}`;
        setGeneration((current) =>
          current.key === key
            ? current
            : {
                key,
                scope,
                gateway: mobileLifecycle.createGateway(),
                workspaceGateway: mobileLifecycle.createWorkspaceGateway(),
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
        });
      }
    });
    void mobileLifecycle.hydrate();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') mobileLifecycle.validateCurrentAuthorization();
    });
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, []);

  return (
    <LifecycleContext.Provider
      value={{
        state,
        refreshCredential: async () => {
          await mobileLifecycle.refresh();
        },
        revokeCredential: async () => {
          const identity = state.profile?.serverIdentity;
          const authorizationRevision = state.profile?.authorizationRevision;
          if (identity !== undefined && authorizationRevision !== undefined) {
            await revokeWorkspaceCatalogCache(identity, authorizationRevision);
          }
          await mobileLifecycle.revoke();
        },
        pair: async (offer) => {
          await mobileLifecycle.pair(offer);
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
          gateway={generation.workspaceGateway}
          generationKey={generation.key}
          profile={state.profile}
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
