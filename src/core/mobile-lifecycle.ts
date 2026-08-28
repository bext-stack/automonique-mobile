// SPDX-License-Identifier: Elastic-2.0

import {
  MobileLifecycleClient,
  MobileLifecycleError,
  type IssuedMobileCredentials,
  type MobileDiscovery,
  type MobilePairingOffer,
} from '@automonique/sdk';

import {
  loadStoredConnection,
  revokeLocalCredential,
  saveIssuedConnection,
  saveWorkspaceAuthorization,
  type ConnectionProfile,
  type ScopedConnection,
} from './credential-store';
import { negotiateMobileProtocolVersion } from './negotiation';
import { createAuthorizedHttpsGateway } from './sdk-gateway';
import type { MobileAutomoniqueGateway } from './types';
import {
  createAuthorizedWorkspaceV2Gateway,
  type WorkspaceV2Gateway,
} from './workspace-v2-gateway';
import {
  admitDelegatedMobileV2Authorization,
  MOBILE_V2_AUTHORIZATION_MEDIA_TYPE,
  mobileV2AuthorizationDigest,
  mobileV2AuthorizationFingerprint,
  mobileV2DelegationFamilyDigest,
} from './mobile-v2-authorization';
import {
  createWorkspaceV2ReceiptStore,
  migrateLegacyWorkspaceV2Receipts,
} from './workspace-v2-receipt-storage';

export type MobileLifecycleState =
  | { readonly phase: 'loading'; readonly profile: null }
  | { readonly phase: 'unpaired'; readonly profile: null }
  | { readonly phase: 'pairing'; readonly profile: null }
  | { readonly phase: 'ready'; readonly profile: ConnectionProfile }
  | { readonly phase: 'refresh_required'; readonly profile: ConnectionProfile }
  | { readonly phase: 'refreshing'; readonly profile: ConnectionProfile }
  | { readonly phase: 'revoking'; readonly profile: ConnectionProfile }
  | {
      readonly phase: 'recovery_required';
      readonly profile: ConnectionProfile | null;
      readonly reason: string;
    };

interface LifecycleClient {
  readonly discovery: MobileDiscovery;
  refresh(
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<IssuedMobileCredentials>;
  revoke(refreshToken: string, signal?: AbortSignal): Promise<unknown>;
  exchangePairing?(
    request: {
      readonly pairing_id: MobilePairingOffer['pairing_id'];
      readonly pairing_token: MobilePairingOffer['pairing_token'];
      readonly server_identity: MobilePairingOffer['server_identity'];
    },
    signal?: AbortSignal,
  ): Promise<IssuedMobileCredentials>;
}

export interface MobileLifecycleDependencies {
  readonly discover?: (
    origin: string,
    fetcher: typeof fetch,
    signal: AbortSignal | undefined,
    expectedServerIdentity: string | undefined,
  ) => Promise<LifecycleClient>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

type Listener = (state: MobileLifecycleState) => void;

const PAIRING_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_MOBILE_V2_AUTHORIZATION_BYTES = 16 * 1024;

async function readWorkspaceAuthorizationResponse(
  response: Response,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[0-9]+$/u.test(declared) ||
      BigInt(declared) > BigInt(MAX_MOBILE_V2_AUTHORIZATION_BYTES))
  ) {
    throw new Error('mobile_v2_authorization_response_too_large');
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('mobile_v2_authorization_response_stream_unavailable');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_MOBILE_V2_AUTHORIZATION_BYTES - length) {
        await reader.cancel().catch(() => undefined);
        throw new Error('mobile_v2_authorization_response_too_large');
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const payload = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(payload);
}

async function fetchWorkspaceAuthorization(
  connection: Pick<
    ScopedConnection,
    'profile' | 'accessToken' | 'authorization'
  >,
  fetcher: typeof fetch,
  now: number,
  signal?: AbortSignal,
) {
  const endpoint = `${connection.profile.origin}/api/mobile/platform-v2/authorization`;
  const response = await fetcher(endpoint, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      accept: MOBILE_V2_AUTHORIZATION_MEDIA_TYPE,
      authorization: `Bearer ${connection.accessToken}`,
    },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  });
  if (
    (typeof response.url === 'string' &&
      response.url !== '' &&
      response.url !== endpoint) ||
    response.headers.get('content-type')?.trim() !==
      MOBILE_V2_AUTHORIZATION_MEDIA_TYPE ||
    !response.headers
      .get('cache-control')
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .includes('no-store')
  ) {
    throw new Error('mobile_v2_authorization_response_invalid');
  }
  const encoded = await readWorkspaceAuthorizationResponse(response);
  if (response.status === 401 || response.status === 404) return undefined;
  if (response.status !== 200 || !response.ok) {
    throw new Error('mobile_v2_authorization_response_refused');
  }
  let document: unknown;
  try {
    document = JSON.parse(encoded);
  } catch {
    throw new Error('mobile_v2_authorization_response_invalid');
  }
  if (
    document === null ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    JSON.stringify(document) !== encoded
  ) {
    throw new Error('mobile_v2_authorization_response_invalid');
  }
  const candidate = document as Readonly<Record<string, unknown>>;
  for (const field of [
    'credential_revision',
    'authorization_revision',
    'principal_generation',
    'issued_at_ms',
    'expires_at_ms',
  ] as const) {
    const value = candidate[field];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error('mobile_v2_authorization_response_invalid');
    }
  }
  return admitDelegatedMobileV2Authorization(
    {
      ...candidate,
      credential_revision: BigInt(candidate.credential_revision as number),
      authorization_revision: BigInt(
        candidate.authorization_revision as number,
      ),
      principal_generation: BigInt(candidate.principal_generation as number),
      issued_at_ms: BigInt(candidate.issued_at_ms as number),
      expires_at_ms: BigInt(candidate.expires_at_ms as number),
    },
    {
      serverIdentity: connection.authorization.server_identity,
      credentialId: connection.authorization.credential_id,
      credentialRevision: connection.authorization.credential_revision,
      authorizationRevision: connection.authorization.authorization_revision,
      expiresAtMs: connection.authorization.expires_at_ms,
      now,
    },
  );
}

function failureReason(error: unknown): string {
  if (error instanceof MobileLifecycleError) return error.category;
  return error instanceof Error ? error.message : 'mobile_lifecycle_failed';
}

function refreshIsRejected(error: unknown): boolean {
  return (
    error instanceof MobileLifecycleError &&
    (error.status === 401 || error.status === 403 || error.status === 410)
  );
}

function gatewayFingerprint(connection: ScopedConnection): string {
  const authorization = connection.authorization;
  return JSON.stringify({
    serverIdentity: authorization.server_identity,
    credentialId: authorization.credential_id,
    credentialRevision: authorization.credential_revision.toString(),
    authorizationRevision: authorization.authorization_revision.toString(),
    actor: authorization.actor,
    actions: authorization.actions,
    sessionScope: authorization.session_scope,
    maxPageEvents: authorization.limits.max_page_events.toString(),
    maxFollowUpBytes: authorization.limits.max_follow_up_bytes.toString(),
    workspaceAuthorization:
      connection.workspaceAuthorization === undefined
        ? null
        : mobileV2AuthorizationFingerprint(connection.workspaceAuthorization),
  });
}

function withoutWorkspaceAuthorization(
  connection: ScopedConnection,
): ScopedConnection {
  const { workspaceAuthorization: _workspaceAuthorization, ...current } =
    connection;
  return current;
}

function workspaceAuthorizationInvalid(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'mobile_v2_authorization_invalid'
  );
}

function admitCurrentWorkspaceAuthorization(
  connection: ScopedConnection,
  now: number,
): void {
  if (connection.workspaceAuthorization === undefined) return;
  admitDelegatedMobileV2Authorization(connection.workspaceAuthorization, {
    serverIdentity: connection.authorization.server_identity,
    credentialId: connection.authorization.credential_id,
    credentialRevision: connection.authorization.credential_revision,
    authorizationRevision: connection.authorization.authorization_revision,
    expiresAtMs: connection.authorization.expires_at_ms,
    now,
  });
}

async function migrateLegacyReceiptCustody(
  connection: ScopedConnection,
): Promise<void> {
  const metadata = connection.workspaceReceiptMigration;
  const authorization = connection.workspaceAuthorization;
  if (metadata === undefined && authorization === undefined) return;
  await migrateLegacyWorkspaceV2Receipts(
    () => mobileV2DelegationFamilyDigest(metadata ?? authorization!),
    () =>
      metadata === undefined
        ? mobileV2AuthorizationDigest(authorization!)
        : Promise.resolve(metadata.authorization_digest),
  );
}

/**
 * Process-wide owner for the rotating credential generation. It serializes
 * refresh, aborts stale network work on replacement/revocation, and never
 * exposes access or refresh tokens through its observable state.
 */
export class MobileLifecycleCoordinator {
  private readonly discover: NonNullable<
    MobileLifecycleDependencies['discover']
  >;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private state: MobileLifecycleState = { phase: 'loading', profile: null };
  private connection: ScopedConnection | null = null;
  private refreshInFlight: Promise<ScopedConnection> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private replacementPending = 0;
  private generation = 0;
  private activeController: AbortController | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dependencies: MobileLifecycleDependencies = {}) {
    this.discover = dependencies.discover ?? MobileLifecycleClient.discover;
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  snapshot(): MobileLifecycleState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private publish(state: MobileLifecycleState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private publishCredentialState(connection: ScopedConnection): void {
    this.clearExpiryTimer();
    const remaining =
      Number(connection.authorization.expires_at_ms) - this.now();
    if (remaining <= 0) {
      this.publish({
        phase: 'refresh_required',
        profile: connection.profile,
      });
      return;
    }
    this.publish({ phase: 'ready', profile: connection.profile });
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null;
        if (this.connection === connection && this.state.phase === 'ready') {
          this.activeController?.abort();
          this.publish({
            phase: 'refresh_required',
            profile: connection.profile,
          });
        }
      },
      Math.min(remaining, 2_147_483_647),
    );
    const timer = this.expiryTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  /** Revalidate local expiry whenever the app returns to the foreground. */
  validateCurrentAuthorization(): MobileLifecycleState {
    if (this.connection !== null && this.state.phase === 'ready') {
      this.publishCredentialState(this.connection);
    }
    return this.state;
  }

  private replaceGeneration(): {
    readonly generation: number;
    readonly signal: AbortSignal;
  } {
    this.clearExpiryTimer();
    this.activeController?.abort();
    this.activeController = new AbortController();
    this.generation += 1;
    return {
      generation: this.generation,
      signal: this.activeController.signal,
    };
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
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

  private async replacing<T>(operation: () => Promise<T>): Promise<T> {
    this.replacementPending += 1;
    this.activeController?.abort();
    try {
      return await this.exclusive(operation);
    } finally {
      this.replacementPending -= 1;
    }
  }

  async hydrate(): Promise<MobileLifecycleState> {
    return this.replacing(() => this.hydrateExclusive());
  }

  private async hydrateExclusive(): Promise<MobileLifecycleState> {
    const operation = this.replaceGeneration();
    this.publish({ phase: 'loading', profile: null });
    let stored: Awaited<ReturnType<typeof loadStoredConnection>>;
    try {
      stored = await loadStoredConnection(this.now());
    } catch (error) {
      if (this.isCurrent(operation.generation)) {
        this.connection = null;
        this.publish({
          phase: 'recovery_required',
          profile: null,
          reason: failureReason(error),
        });
      }
      return this.state;
    }
    if (!this.isCurrent(operation.generation)) return this.state;
    if (stored === null) {
      this.connection = null;
      this.publish({ phase: 'unpaired', profile: null });
      return this.state;
    }
    let connection = stored.connection;
    try {
      admitCurrentWorkspaceAuthorization(connection, this.now());
    } catch (error) {
      if (!this.isCurrent(operation.generation)) return this.state;
      connection = withoutWorkspaceAuthorization(connection);
      this.connection = connection;
      this.publish({
        phase: 'recovery_required',
        profile: connection.profile,
        reason: failureReason(error),
      });
      return this.state;
    }
    if (
      stored.kind === 'active' &&
      connection.workspaceAuthorization === undefined
    ) {
      try {
        // Reauthorization may rotate or replace the delegation. Preserve the
        // exact old family before accepting its successor.
        await migrateLegacyReceiptCustody(connection);
        if (!this.isCurrent(operation.generation)) return this.state;
        const workspaceAuthorization = await fetchWorkspaceAuthorization(
          connection,
          this.fetcher,
          this.now(),
          operation.signal,
        );
        if (!this.isCurrent(operation.generation)) return this.state;
        connection = await saveWorkspaceAuthorization(
          connection,
          workspaceAuthorization,
          this.now(),
        );
      } catch (error) {
        if (workspaceAuthorizationInvalid(error)) {
          this.connection = connection;
          this.publish({
            phase: 'recovery_required',
            profile: connection.profile,
            reason: failureReason(error),
          });
          return this.state;
        }
        // An offline authorization refresh cannot widen persisted authority.
        // The web bridge reauthorizes the stored generation on every request.
      }
    }
    if (!this.isCurrent(operation.generation)) return this.state;
    this.connection = connection;
    if (stored.kind === 'active') {
      this.publishCredentialState(connection);
    } else {
      this.publish({
        phase: 'refresh_required',
        profile: connection.profile,
      });
    }
    return this.state;
  }

  /** Exchange one strict copy-safe offer without persisting its pairing proof. */
  async pair(offer: MobilePairingOffer): Promise<ConnectionProfile> {
    return this.replacing(() => this.pairExclusive(offer));
  }

  private async pairExclusive(
    offer: MobilePairingOffer,
  ): Promise<ConnectionProfile> {
    if (this.connection !== null) throw new Error('mobile_already_paired');
    if (offer.expires_at_ms <= BigInt(this.now())) {
      throw new Error('mobile_pairing_expired');
    }
    if (offer.expires_at_ms > BigInt(this.now() + PAIRING_LIFETIME_MS)) {
      throw new Error('mobile_pairing_lifetime_invalid');
    }
    const operation = this.replaceGeneration();
    this.publish({ phase: 'pairing', profile: null });
    let exchanged = false;
    try {
      const client = await this.discover(
        offer.origin,
        this.fetcher,
        operation.signal,
        offer.server_identity,
      );
      if (
        client.discovery.pairing_exchange_endpoint !==
          offer.exchange_endpoint ||
        client.exchangePairing === undefined
      ) {
        throw new Error('mobile_pairing_discovery_mismatch');
      }
      // Admission negotiates on the advertised protocol major version. The
      // vendored schema digest is provenance evidence, not an equality gate;
      // see docs/decisions.md.
      negotiateMobileProtocolVersion(client.discovery.supported_versions);
      const issued = await client.exchangePairing(
        {
          pairing_id: offer.pairing_id,
          pairing_token: offer.pairing_token,
          server_identity: offer.server_identity,
        },
        operation.signal,
      );
      exchanged = true;
      let connection = await saveIssuedConnection(
        client.discovery,
        issued,
        this.now(),
      );
      try {
        const workspaceAuthorization = await fetchWorkspaceAuthorization(
          connection,
          this.fetcher,
          this.now(),
          operation.signal,
        );
        connection = await saveWorkspaceAuthorization(
          connection,
          workspaceAuthorization,
          this.now(),
        );
      } catch (error) {
        if (workspaceAuthorizationInvalid(error)) throw error;
        connection = withoutWorkspaceAuthorization(connection);
      }
      if (!this.isCurrent(operation.generation)) {
        throw new Error('mobile_lifecycle_generation_replaced');
      }
      this.connection = connection;
      this.publishCredentialState(connection);
      return connection.profile;
    } catch (error) {
      if (this.isCurrent(operation.generation)) {
        this.connection = null;
        this.publish(
          exchanged
            ? {
                phase: 'recovery_required',
                profile: null,
                reason: 'pairing_commit_uncertain',
              }
            : { phase: 'unpaired', profile: null },
        );
      }
      throw error;
    }
  }

  async accessToken(): Promise<string> {
    if (
      this.replacementPending > 0 ||
      this.state.phase === 'loading' ||
      this.state.phase === 'unpaired' ||
      this.state.phase === 'pairing' ||
      this.state.phase === 'revoking' ||
      this.state.phase === 'recovery_required'
    ) {
      throw new Error('mobile_credential_unavailable');
    }
    if (this.connection === null) throw new Error('mobile_pairing_required');
    if (this.connection.authorization.expires_at_ms > BigInt(this.now())) {
      return this.connection.accessToken;
    }
    return (await this.refresh()).accessToken;
  }

  createGateway(): MobileAutomoniqueGateway {
    if (this.connection === null) throw new Error('mobile_pairing_required');
    const authorization = this.connection.authorization;
    const expectedFingerprint = gatewayFingerprint(this.connection);
    const lifecycleFetcher: typeof fetch = async (input, init) => {
      const response = await this.fetcher(input, init);
      if (
        (response.status === 401 ||
          response.status === 403 ||
          response.status === 410) &&
        this.connection !== null &&
        gatewayFingerprint(this.connection) === expectedFingerprint
      ) {
        this.clearExpiryTimer();
        this.activeController?.abort();
        this.publish({
          phase: 'refresh_required',
          profile: this.connection.profile,
        });
      }
      return response;
    };
    return createAuthorizedHttpsGateway({
      authorization,
      endpoint: this.connection.profile.platformEndpoint,
      expectedServerIdentity: this.connection.profile.serverIdentity,
      fetcher: lifecycleFetcher,
      now: this.now(),
      token: async () => {
        const token = await this.accessToken();
        if (
          this.connection === null ||
          gatewayFingerprint(this.connection) !== expectedFingerprint
        ) {
          throw new Error('gateway_generation_replaced');
        }
        return token;
      },
    });
  }

  /**
   * Construct the generation-scoped Platform v2 companion boundary. Project
   * roots are deliberately not inferred from the v1 session authorization;
   * callers must obtain an exact root from a future server-issued mobile grant.
   */
  createWorkspaceGateway(): WorkspaceV2Gateway | null {
    if (this.connection === null) throw new Error('mobile_pairing_required');
    const connection = this.connection;
    if (connection.workspaceAuthorization === undefined) return null;
    const workspaceAuthorization = admitDelegatedMobileV2Authorization(
      connection.workspaceAuthorization,
      {
        serverIdentity: connection.authorization.server_identity,
        credentialId: connection.authorization.credential_id,
        credentialRevision: connection.authorization.credential_revision,
        authorizationRevision: connection.authorization.authorization_revision,
        expiresAtMs: connection.authorization.expires_at_ms,
        now: this.now(),
      },
    );
    const expectedFingerprint = gatewayFingerprint(connection);
    const generation = this.generation;
    const generationSignal = this.activeController?.signal;
    if (this.state.phase !== 'ready' || generationSignal === undefined) {
      throw new Error('mobile_credential_unavailable');
    }
    const endpoint = new URL(connection.profile.platformEndpoint);
    endpoint.pathname = '/api/platform/v2';
    endpoint.search = '';
    endpoint.hash = '';
    const lifecycleFetcher: typeof fetch = async (input, init) => {
      const response = await this.fetcher(input, init);
      if (
        (response.status === 401 ||
          response.status === 403 ||
          response.status === 410) &&
        this.connection !== null &&
        gatewayFingerprint(this.connection) === expectedFingerprint
      ) {
        this.clearExpiryTimer();
        this.activeController?.abort();
        this.publish({
          phase: 'refresh_required',
          profile: this.connection.profile,
        });
      }
      return response;
    };
    return createAuthorizedWorkspaceV2Gateway({
      authorization: workspaceAuthorization,
      endpoint: endpoint.toString(),
      fetcher: lifecycleFetcher,
      now: this.now,
      operationGuard: {
        signal: generationSignal,
        admit: () => {
          if (
            generationSignal.aborted ||
            this.state.phase !== 'ready' ||
            this.replacementPending > 0 ||
            this.connection !== connection ||
            this.generation !== generation ||
            gatewayFingerprint(connection) !== expectedFingerprint ||
            workspaceAuthorization.expires_at_ms <= BigInt(this.now()) ||
            workspaceAuthorization.expires_at_ms !==
              connection.authorization.expires_at_ms
          ) {
            throw new Error('gateway_generation_replaced');
          }
        },
      },
      receiptStore: createWorkspaceV2ReceiptStore(
        () => mobileV2DelegationFamilyDigest(workspaceAuthorization),
        () => mobileV2AuthorizationDigest(workspaceAuthorization),
      ),
      token: async () => {
        const token = await this.accessToken();
        if (
          this.connection === null ||
          gatewayFingerprint(this.connection) !== expectedFingerprint
        ) {
          throw new Error('gateway_generation_replaced');
        }
        return token;
      },
    });
  }

  async refresh(): Promise<ScopedConnection> {
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const task = this.exclusive(() => this.refreshExclusive());
    this.refreshInFlight = task;
    try {
      return await task;
    } finally {
      if (this.refreshInFlight === task) this.refreshInFlight = null;
    }
  }

  private async refreshExclusive(): Promise<ScopedConnection> {
    if (this.connection === null) throw new Error('mobile_pairing_required');
    const current = this.connection;
    const operation = this.replaceGeneration();
    this.publish({ phase: 'refreshing', profile: current.profile });
    try {
      // The legacy receipt namespace used the complete authorization digest,
      // which changes on rotation. Migrate it while the old secure generation
      // is still admitted and can identify its exact stable delegation family.
      // No unrelated Async Storage keys are enumerated or adopted.
      if (
        current.workspaceReceiptMigration !== undefined ||
        current.workspaceAuthorization !== undefined
      ) {
        await migrateLegacyReceiptCustody(current);
        if (!this.isCurrent(operation.generation)) {
          throw new Error('mobile_lifecycle_generation_replaced');
        }
      }
      const client = await this.discover(
        current.profile.origin,
        this.fetcher,
        operation.signal,
        current.profile.serverIdentity,
      );
      const issued = await client.refresh(
        current.refreshToken,
        operation.signal,
      );
      let rotated: ScopedConnection;
      try {
        rotated = await saveIssuedConnection(
          client.discovery,
          issued,
          this.now(),
          current,
        );
        try {
          const workspaceAuthorization = await fetchWorkspaceAuthorization(
            rotated,
            this.fetcher,
            this.now(),
            operation.signal,
          );
          rotated = await saveWorkspaceAuthorization(
            rotated,
            workspaceAuthorization,
            this.now(),
          );
        } catch (error) {
          if (workspaceAuthorizationInvalid(error)) throw error;
          rotated = withoutWorkspaceAuthorization(rotated);
        }
      } catch (error) {
        // The server consumed the previous refresh token. If the local commit
        // is uncertain, replaying it could revoke the entire successor family.
        await revokeLocalCredential().catch(() => undefined);
        if (this.isCurrent(operation.generation)) {
          this.connection = null;
          this.publish({
            phase: 'recovery_required',
            profile: current.profile,
            reason: 'refresh_commit_uncertain',
          });
        }
        throw error;
      }
      if (!this.isCurrent(operation.generation)) {
        throw new Error('mobile_lifecycle_generation_replaced');
      }
      this.connection = rotated;
      this.publishCredentialState(rotated);
      return rotated;
    } catch (error) {
      if (!this.isCurrent(operation.generation)) throw error;
      if (refreshIsRejected(error)) {
        await revokeLocalCredential().catch(() => undefined);
        this.connection = null;
        this.publish({
          phase: 'recovery_required',
          profile: current.profile,
          reason: failureReason(error),
        });
      } else if (this.connection !== null) {
        this.publish({
          phase: 'refresh_required',
          profile: this.connection.profile,
        });
      }
      throw error;
    }
  }

  /** Revoke remotely first; local deletion never masquerades as server revocation. */
  async revoke(): Promise<void> {
    return this.replacing(() => this.revokeExclusive());
  }

  private async revokeExclusive(): Promise<void> {
    if (this.connection === null) {
      await revokeLocalCredential();
      this.publish({ phase: 'unpaired', profile: null });
      return;
    }
    const current = this.connection;
    const operation = this.replaceGeneration();
    this.publish({ phase: 'revoking', profile: current.profile });
    let remoteRevoked = false;
    try {
      const client = await this.discover(
        current.profile.origin,
        this.fetcher,
        operation.signal,
        current.profile.serverIdentity,
      );
      await client.revoke(current.refreshToken, operation.signal);
      remoteRevoked = true;
      if (!this.isCurrent(operation.generation)) return;
      try {
        await revokeLocalCredential();
        this.connection = null;
        this.publish({ phase: 'unpaired', profile: null });
      } catch (error) {
        this.connection = null;
        this.publish({
          phase: 'recovery_required',
          profile: current.profile,
          reason: 'revoked_local_cleanup_failed',
        });
        throw error;
      }
    } catch (error) {
      if (this.isCurrent(operation.generation) && !remoteRevoked) {
        this.publishCredentialState(current);
      }
      throw error;
    }
  }
}

export const mobileLifecycle = new MobileLifecycleCoordinator();
