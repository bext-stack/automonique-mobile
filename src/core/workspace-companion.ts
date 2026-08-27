// SPDX-License-Identifier: Elastic-2.0

import { decimalRevision, type DecimalRevision } from './types';

export const WORKSPACE_COMPANION_SCHEMA =
  'automonique.mobile-workspace-companion/v1' as const;
export const MAX_WORKSPACE_SERVERS = 8;
export const MAX_WORKSPACE_HOSTS = 32;
export const MAX_WORKSPACE_PROJECTS = 100;
export const MAX_WORKSPACES = 200;
export const MAX_WORKSPACE_SESSIONS = 500;
export const MAX_WORKSPACE_UNREAD = 10_000;

export type ServerIdentity = string & { readonly __brand: 'ServerIdentity' };
export type CompanionPhase = 'live' | 'stale';
export type ProfileAuthorization = 'active' | 'cached' | 'revoked';
export type WorkspaceAction =
  | 'workspace_read'
  | 'workspace_create_preview'
  | 'workspace_resume_preview'
  | 'terminal_relay';
export type WorkspaceDestination =
  'chat' | 'files' | 'preview' | 'source_control' | 'terminal';

export interface CompanionFreshness {
  readonly state: 'fresh' | 'delayed' | 'unknown';
  readonly observedAt: string;
}

export interface AuthorizedHost {
  readonly id: string;
  readonly label: string;
  readonly state: 'ready' | 'offline' | 'unknown';
  readonly freshness: CompanionFreshness;
}

export interface AuthorizedProject {
  readonly id: string;
  readonly hostId: string;
  readonly label: string;
}

export interface LinkedExternalWorkItem {
  readonly provider: string;
  readonly key: string;
  readonly title: string;
  readonly status:
    'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled' | 'unknown';
}

export interface WorkspaceSessionReference {
  readonly id: string;
  readonly revision: DecimalRevision;
  readonly title: string;
  readonly state: 'active' | 'waiting' | 'completed' | 'lost' | 'unknown';
  readonly unreadAttention: number;
}

export interface WorkspaceNavigationGrant {
  readonly destination: WorkspaceDestination;
  readonly revision: DecimalRevision;
}

export interface CompanionWorkspace {
  readonly id: string;
  readonly revision: DecimalRevision;
  readonly hostId: string;
  readonly projectId: string;
  readonly title: string;
  readonly externalWorkItem: LinkedExternalWorkItem | null;
  readonly orchestrationStatus:
    | 'idle'
    | 'planned'
    | 'queued'
    | 'running'
    | 'waiting'
    | 'review'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'unknown';
  readonly attempt: {
    readonly id: string;
    readonly revision: DecimalRevision;
    readonly state: 'queued' | 'running' | 'waiting' | 'completed' | 'unknown';
  } | null;
  readonly sessions: readonly WorkspaceSessionReference[];
  readonly repository: {
    readonly label: string;
    readonly webUrl: string | null;
  } | null;
  readonly branch: {
    readonly label: string;
    readonly state: 'clean' | 'changed' | 'conflicted' | 'unknown';
  } | null;
  readonly freshness: CompanionFreshness;
  readonly unreadAttention: number;
  readonly navigation: readonly WorkspaceNavigationGrant[];
}

export interface ScopedServerProfile {
  readonly serverIdentity: ServerIdentity;
  readonly label: string;
  readonly origin: string;
  readonly tenantId: string;
  readonly authorization: ProfileAuthorization;
  readonly authorizationRevision: DecimalRevision;
  readonly actions: readonly WorkspaceAction[];
  readonly hosts: readonly AuthorizedHost[];
  readonly projects: readonly AuthorizedProject[];
  readonly workspaces: readonly CompanionWorkspace[];
}

export interface WorkspaceCompanionCatalog {
  readonly schema: typeof WORKSPACE_COMPANION_SCHEMA;
  readonly phase: CompanionPhase;
  readonly generatedAt: string;
  readonly selectedServerIdentity: ServerIdentity | null;
  readonly servers: readonly ScopedServerProfile[];
}

export interface TaskPrefill {
  readonly provider: string;
  readonly key: string;
  readonly title: string;
}

export type WorkspaceIntentRequest =
  | {
      readonly kind: 'create';
      readonly serverIdentity: ServerIdentity;
      readonly hostId: string;
      readonly projectId: string;
      readonly task: TaskPrefill;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: 'resume';
      readonly serverIdentity: ServerIdentity;
      readonly workspaceId: string;
      readonly workspaceRevision: DecimalRevision;
      readonly sessionId: string;
      readonly idempotencyKey: string;
    };

export interface WorkspaceAuthorityPreview {
  readonly schema: 'automonique.workspace-authority-preview/v1';
  readonly action: 'create' | 'resume';
  readonly serverIdentity: ServerIdentity;
  readonly requestIdempotencyKey: string;
  readonly authorityRevision: DecimalRevision;
  readonly summary: readonly string[];
  readonly expiresAt: string;
}

export interface WorkspaceDeepLinkRequest {
  readonly serverIdentity: ServerIdentity;
  readonly workspaceId: string;
  readonly workspaceRevision: DecimalRevision;
  readonly destination: WorkspaceDestination;
  readonly sessionId: string | null;
}

export interface AdmittedWorkspaceRoute {
  readonly pathname:
    | '/workspace/[server]/[workspace]'
    | '/workspace/[server]/[workspace]/session/[session]';
  readonly params: Readonly<Record<string, string>>;
  readonly readOnly: boolean;
}

export interface AdmittedWorkspaceIntentPreview {
  readonly request: WorkspaceIntentRequest;
  readonly preview: WorkspaceAuthorityPreview;
  readonly executable: false;
}

export interface WorkspaceCatalogReduction {
  readonly catalog: WorkspaceCompanionCatalog;
  readonly resyncRequired: boolean;
}

const ACTIONS: readonly WorkspaceAction[] = [
  'workspace_read',
  'workspace_create_preview',
  'workspace_resume_preview',
  'terminal_relay',
];
const DESTINATIONS: readonly WorkspaceDestination[] = [
  'chat',
  'files',
  'preview',
  'source_control',
  'terminal',
];

function fail(): never {
  throw new Error('workspace_companion_invalid');
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    fail();
  }
}

function string(value: unknown, max = 512): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > max
  ) {
    fail();
  }
  return value;
}

function identity(value: unknown): ServerIdentity {
  const candidate = string(value, 96);
  if (!/^sha256:[a-f0-9]{64}$/.test(candidate)) fail();
  return candidate as ServerIdentity;
}

function timestamp(value: unknown): string {
  const candidate = string(value, 64);
  if (!Number.isFinite(Date.parse(candidate))) fail();
  return candidate;
}

function httpsUrl(value: unknown): string {
  const candidate = string(value, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    fail();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    fail();
  }
  return candidate;
}

function httpsOrigin(value: unknown): string {
  const candidate = httpsUrl(value);
  const parsed = new URL(candidate);
  if (parsed.pathname !== '/' || parsed.search !== '') fail();
  return parsed.origin;
}

function freshness(value: unknown): CompanionFreshness {
  const candidate = object(value);
  keys(candidate, ['state', 'observedAt']);
  if (!['fresh', 'delayed', 'unknown'].includes(String(candidate.state)))
    fail();
  return {
    state: candidate.state as CompanionFreshness['state'],
    observedAt: timestamp(candidate.observedAt),
  };
}

function unread(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < 0 ||
    Number(value) > MAX_WORKSPACE_UNREAD
  )
    fail();
  return Number(value);
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail();
}

function admitWorkspace(value: unknown): CompanionWorkspace {
  const candidate = object(value);
  keys(candidate, [
    'id',
    'revision',
    'hostId',
    'projectId',
    'title',
    'externalWorkItem',
    'orchestrationStatus',
    'attempt',
    'sessions',
    'repository',
    'branch',
    'freshness',
    'unreadAttention',
    'navigation',
  ]);
  const id = string(candidate.id, 256);
  const revision = decimalRevision(string(candidate.revision, 19));
  const hostId = string(candidate.hostId, 256);
  const projectId = string(candidate.projectId, 256);
  const title = string(candidate.title, 4_096);
  let externalWorkItem: LinkedExternalWorkItem | null = null;
  if (candidate.externalWorkItem !== null) {
    const item = object(candidate.externalWorkItem);
    keys(item, ['provider', 'key', 'title', 'status']);
    if (
      ![
        'open',
        'in_progress',
        'blocked',
        'done',
        'cancelled',
        'unknown',
      ].includes(String(item.status))
    )
      fail();
    externalWorkItem = {
      provider: string(item.provider, 128),
      key: string(item.key, 256),
      title: string(item.title, 4_096),
      status: item.status as LinkedExternalWorkItem['status'],
    };
  }
  const orchestrationStates: readonly CompanionWorkspace['orchestrationStatus'][] =
    [
      'idle',
      'planned',
      'queued',
      'running',
      'waiting',
      'review',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
    ];
  if (
    !orchestrationStates.includes(
      candidate.orchestrationStatus as CompanionWorkspace['orchestrationStatus'],
    )
  )
    fail();
  let attempt: CompanionWorkspace['attempt'] = null;
  if (candidate.attempt !== null) {
    const value = object(candidate.attempt);
    keys(value, ['id', 'revision', 'state']);
    if (
      !['queued', 'running', 'waiting', 'completed', 'unknown'].includes(
        String(value.state),
      )
    )
      fail();
    attempt = {
      id: string(value.id, 256),
      revision: decimalRevision(string(value.revision, 19)),
      state: value.state as NonNullable<CompanionWorkspace['attempt']>['state'],
    };
  }
  if (
    !Array.isArray(candidate.sessions) ||
    candidate.sessions.length > MAX_WORKSPACE_SESSIONS
  )
    fail();
  const sessions = candidate.sessions.map(
    (entry): WorkspaceSessionReference => {
      const value = object(entry);
      keys(value, ['id', 'revision', 'title', 'state', 'unreadAttention']);
      if (
        !['active', 'waiting', 'completed', 'lost', 'unknown'].includes(
          String(value.state),
        )
      )
        fail();
      return {
        id: string(value.id, 256),
        revision: decimalRevision(string(value.revision, 19)),
        title: string(value.title, 4_096),
        state: value.state as WorkspaceSessionReference['state'],
        unreadAttention: unread(value.unreadAttention),
      };
    },
  );
  unique(sessions.map((session) => session.id));
  let repository: CompanionWorkspace['repository'] = null;
  if (candidate.repository !== null) {
    const value = object(candidate.repository);
    keys(value, ['label', 'webUrl']);
    repository = {
      label: string(value.label, 512),
      webUrl: value.webUrl === null ? null : httpsUrl(value.webUrl),
    };
  }
  let branch: CompanionWorkspace['branch'] = null;
  if (candidate.branch !== null) {
    const value = object(candidate.branch);
    keys(value, ['label', 'state']);
    if (
      !['clean', 'changed', 'conflicted', 'unknown'].includes(
        String(value.state),
      )
    )
      fail();
    branch = {
      label: string(value.label, 512),
      state: value.state as NonNullable<CompanionWorkspace['branch']>['state'],
    };
  }
  if (
    !Array.isArray(candidate.navigation) ||
    candidate.navigation.length > DESTINATIONS.length
  )
    fail();
  const navigation = candidate.navigation.map(
    (entry): WorkspaceNavigationGrant => {
      const value = object(entry);
      keys(value, ['destination', 'revision']);
      if (!DESTINATIONS.includes(value.destination as WorkspaceDestination))
        fail();
      return {
        destination: value.destination as WorkspaceDestination,
        revision: decimalRevision(string(value.revision, 19)),
      };
    },
  );
  unique(navigation.map((grant) => grant.destination));
  return {
    id,
    revision,
    hostId,
    projectId,
    title,
    externalWorkItem,
    orchestrationStatus:
      candidate.orchestrationStatus as CompanionWorkspace['orchestrationStatus'],
    attempt,
    sessions,
    repository,
    branch,
    freshness: freshness(candidate.freshness),
    unreadAttention: unread(candidate.unreadAttention),
    navigation,
  };
}

function admitServer(value: unknown): ScopedServerProfile {
  const candidate = object(value);
  keys(candidate, [
    'serverIdentity',
    'label',
    'origin',
    'tenantId',
    'authorization',
    'authorizationRevision',
    'actions',
    'hosts',
    'projects',
    'workspaces',
  ]);
  if (
    !['active', 'cached', 'revoked'].includes(String(candidate.authorization))
  )
    fail();
  if (
    !Array.isArray(candidate.actions) ||
    candidate.actions.length > ACTIONS.length
  )
    fail();
  const actions = candidate.actions.map((action) => {
    if (!ACTIONS.includes(action as WorkspaceAction)) fail();
    return action as WorkspaceAction;
  });
  unique(actions);
  if (
    !Array.isArray(candidate.hosts) ||
    candidate.hosts.length > MAX_WORKSPACE_HOSTS
  )
    fail();
  const hosts = candidate.hosts.map((entry): AuthorizedHost => {
    const value = object(entry);
    keys(value, ['id', 'label', 'state', 'freshness']);
    if (!['ready', 'offline', 'unknown'].includes(String(value.state))) fail();
    return {
      id: string(value.id, 256),
      label: string(value.label, 512),
      state: value.state as AuthorizedHost['state'],
      freshness: freshness(value.freshness),
    };
  });
  unique(hosts.map((host) => host.id));
  if (
    !Array.isArray(candidate.projects) ||
    candidate.projects.length > MAX_WORKSPACE_PROJECTS
  )
    fail();
  const projects = candidate.projects.map((entry): AuthorizedProject => {
    const value = object(entry);
    keys(value, ['id', 'hostId', 'label']);
    return {
      id: string(value.id, 256),
      hostId: string(value.hostId, 256),
      label: string(value.label, 512),
    };
  });
  unique(projects.map((project) => project.id));
  if (
    !Array.isArray(candidate.workspaces) ||
    candidate.workspaces.length > MAX_WORKSPACES
  )
    fail();
  const workspaces = candidate.workspaces.map(admitWorkspace);
  unique(workspaces.map((workspace) => workspace.id));
  const hostIds = new Set(hosts.map((host) => host.id));
  const projectsById = new Map(
    projects.map((project) => [project.id, project]),
  );
  for (const project of projects) if (!hostIds.has(project.hostId)) fail();
  for (const workspace of workspaces) {
    const project = projectsById.get(workspace.projectId);
    if (project === undefined || project.hostId !== workspace.hostId) fail();
  }
  return {
    serverIdentity: identity(candidate.serverIdentity),
    label: string(candidate.label, 512),
    origin: httpsOrigin(candidate.origin),
    tenantId: string(candidate.tenantId, 256),
    authorization: candidate.authorization as ProfileAuthorization,
    authorizationRevision: decimalRevision(
      string(candidate.authorizationRevision, 19),
    ),
    actions,
    hosts,
    projects,
    workspaces,
  };
}

export function admitWorkspaceCompanionCatalog(
  value: unknown,
): WorkspaceCompanionCatalog {
  const candidate = object(value);
  keys(candidate, [
    'schema',
    'phase',
    'generatedAt',
    'selectedServerIdentity',
    'servers',
  ]);
  if (
    candidate.schema !== WORKSPACE_COMPANION_SCHEMA ||
    !['live', 'stale'].includes(String(candidate.phase))
  )
    fail();
  if (
    !Array.isArray(candidate.servers) ||
    candidate.servers.length > MAX_WORKSPACE_SERVERS
  )
    fail();
  const servers = candidate.servers.map(admitServer);
  unique(servers.map((server) => server.serverIdentity));
  if (
    servers.reduce((count, server) => count + server.hosts.length, 0) >
      MAX_WORKSPACE_HOSTS ||
    servers.reduce((count, server) => count + server.projects.length, 0) >
      MAX_WORKSPACE_PROJECTS ||
    servers.reduce((count, server) => count + server.workspaces.length, 0) >
      MAX_WORKSPACES ||
    servers.reduce(
      (count, server) =>
        count +
        server.workspaces.reduce(
          (sessions, workspace) => sessions + workspace.sessions.length,
          0,
        ),
      0,
    ) > MAX_WORKSPACE_SESSIONS
  ) {
    fail();
  }
  const selectedServerIdentity =
    candidate.selectedServerIdentity === null
      ? null
      : identity(candidate.selectedServerIdentity);
  if (selectedServerIdentity !== null) {
    const selected = servers.find(
      (server) => server.serverIdentity === selectedServerIdentity,
    );
    if (selected === undefined || selected.authorization === 'revoked') fail();
  }
  return {
    schema: WORKSPACE_COMPANION_SCHEMA,
    phase: candidate.phase as CompanionPhase,
    generatedAt: timestamp(candidate.generatedAt),
    selectedServerIdentity,
    servers,
  };
}

export function selectScopedServer(
  catalog: WorkspaceCompanionCatalog,
  serverIdentity: ServerIdentity,
): WorkspaceCompanionCatalog {
  const profile = catalog.servers.find(
    (server) => server.serverIdentity === serverIdentity,
  );
  if (profile === undefined || profile.authorization === 'revoked') {
    throw new Error('workspace_server_not_authorized');
  }
  return { ...catalog, selectedServerIdentity: serverIdentity };
}

function staleReadOnlyCatalog(
  catalog: WorkspaceCompanionCatalog,
): WorkspaceCompanionCatalog {
  return {
    ...catalog,
    phase: 'stale',
    servers: catalog.servers.map((server) => ({
      ...server,
      authorization: server.authorization === 'revoked' ? 'revoked' : 'cached',
      actions: server.actions.includes('workspace_read')
        ? (['workspace_read'] as const)
        : [],
    })),
  };
}

/**
 * Admit one authoritative replacement. Revision rollback or malformed scope
 * makes the prior projection stale; mobile never merges partial unknown data.
 */
export function reduceWorkspaceCompanionCatalog(
  current: WorkspaceCompanionCatalog,
  replacement: unknown,
): WorkspaceCatalogReduction {
  let next: WorkspaceCompanionCatalog;
  try {
    next = admitWorkspaceCompanionCatalog(replacement);
  } catch {
    return { catalog: staleReadOnlyCatalog(current), resyncRequired: true };
  }
  if (
    next.phase !== 'live' ||
    Date.parse(next.generatedAt) < Date.parse(current.generatedAt)
  ) {
    return { catalog: staleReadOnlyCatalog(current), resyncRequired: true };
  }
  for (const server of next.servers) {
    const previous = current.servers.find(
      (candidate) => candidate.serverIdentity === server.serverIdentity,
    );
    if (
      previous !== undefined &&
      BigInt(server.authorizationRevision) <
        BigInt(previous.authorizationRevision)
    ) {
      return { catalog: staleReadOnlyCatalog(current), resyncRequired: true };
    }
    for (const workspace of server.workspaces) {
      const priorWorkspace = previous?.workspaces.find(
        (candidate) => candidate.id === workspace.id,
      );
      if (
        priorWorkspace !== undefined &&
        BigInt(workspace.revision) < BigInt(priorWorkspace.revision)
      ) {
        return { catalog: staleReadOnlyCatalog(current), resyncRequired: true };
      }
    }
  }
  return { catalog: next, resyncRequired: false };
}

/** Build only an internal route. It never accepts host paths or arbitrary URLs. */
export function admitWorkspaceDeepLink(
  catalog: WorkspaceCompanionCatalog,
  request: WorkspaceDeepLinkRequest,
): AdmittedWorkspaceRoute {
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === request.serverIdentity,
  );
  if (
    server === undefined ||
    server.authorization === 'revoked' ||
    !server.actions.includes('workspace_read')
  ) {
    throw new Error('workspace_navigation_not_authorized');
  }
  const workspace = server.workspaces.find(
    (candidate) => candidate.id === request.workspaceId,
  );
  const grant = workspace?.navigation.find(
    (candidate) => candidate.destination === request.destination,
  );
  if (
    workspace === undefined ||
    workspace.revision !== request.workspaceRevision ||
    grant?.revision !== workspace.revision
  ) {
    throw new Error('workspace_navigation_not_authorized');
  }
  if (
    request.destination === 'terminal' &&
    (catalog.phase !== 'live' ||
      server.authorization !== 'active' ||
      !server.actions.includes('terminal_relay'))
  ) {
    throw new Error('workspace_terminal_not_authorized');
  }
  const params: Record<string, string> = {
    server: request.serverIdentity,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: request.destination,
  };
  if (request.destination === 'chat') {
    const session = workspace.sessions.find(
      (candidate) => candidate.id === request.sessionId,
    );
    if (session === undefined)
      throw new Error('workspace_navigation_not_authorized');
    params.session = session.id;
    return {
      pathname: '/workspace/[server]/[workspace]/session/[session]',
      params,
      readOnly: true,
    };
  }
  if (request.sessionId !== null)
    throw new Error('workspace_navigation_not_authorized');
  return {
    pathname: '/workspace/[server]/[workspace]',
    params,
    readOnly: request.destination !== 'terminal',
  };
}

export function admitWorkspaceIntentRequest(
  value: unknown,
): WorkspaceIntentRequest {
  const candidate = object(value);
  if (candidate.kind === 'create') {
    keys(candidate, [
      'kind',
      'serverIdentity',
      'hostId',
      'projectId',
      'task',
      'idempotencyKey',
    ]);
    const task = object(candidate.task);
    keys(task, ['provider', 'key', 'title']);
    return {
      kind: 'create',
      serverIdentity: identity(candidate.serverIdentity),
      hostId: string(candidate.hostId, 256),
      projectId: string(candidate.projectId, 256),
      task: {
        provider: string(task.provider, 128),
        key: string(task.key, 256),
        title: string(task.title, 4_096),
      },
      idempotencyKey: string(candidate.idempotencyKey, 256),
    };
  }
  if (candidate.kind === 'resume') {
    keys(candidate, [
      'kind',
      'serverIdentity',
      'workspaceId',
      'workspaceRevision',
      'sessionId',
      'idempotencyKey',
    ]);
    return {
      kind: 'resume',
      serverIdentity: identity(candidate.serverIdentity),
      workspaceId: string(candidate.workspaceId, 256),
      workspaceRevision: decimalRevision(
        string(candidate.workspaceRevision, 19),
      ),
      sessionId: string(candidate.sessionId, 256),
      idempotencyKey: string(candidate.idempotencyKey, 256),
    };
  }
  fail();
}

export function admitWorkspaceAuthorityPreview(
  value: unknown,
): WorkspaceAuthorityPreview {
  const candidate = object(value);
  keys(candidate, [
    'schema',
    'action',
    'serverIdentity',
    'requestIdempotencyKey',
    'authorityRevision',
    'summary',
    'expiresAt',
  ]);
  if (
    candidate.schema !== 'automonique.workspace-authority-preview/v1' ||
    !['create', 'resume'].includes(String(candidate.action)) ||
    !Array.isArray(candidate.summary) ||
    candidate.summary.length > 16
  )
    fail();
  return {
    schema: 'automonique.workspace-authority-preview/v1',
    action: candidate.action as WorkspaceAuthorityPreview['action'],
    serverIdentity: identity(candidate.serverIdentity),
    requestIdempotencyKey: string(candidate.requestIdempotencyKey, 256),
    authorityRevision: decimalRevision(string(candidate.authorityRevision, 19)),
    summary: candidate.summary.map((entry) => string(entry, 512)),
    expiresAt: timestamp(candidate.expiresAt),
  };
}

export function bindWorkspaceIntentPreview(
  catalog: WorkspaceCompanionCatalog,
  request: WorkspaceIntentRequest,
  preview: WorkspaceAuthorityPreview,
  now = Date.now(),
): AdmittedWorkspaceIntentPreview {
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === request.serverIdentity,
  );
  if (
    catalog.phase !== 'live' ||
    server?.authorization !== 'active' ||
    preview.serverIdentity !== request.serverIdentity ||
    preview.action !== request.kind ||
    preview.requestIdempotencyKey !== request.idempotencyKey ||
    preview.authorityRevision !== server.authorizationRevision ||
    Date.parse(preview.expiresAt) <= now
  ) {
    throw new Error('workspace_intent_preview_not_authorized');
  }
  if (request.kind === 'create') {
    const project = server.projects.find(
      (candidate) => candidate.id === request.projectId,
    );
    if (
      !server.actions.includes('workspace_create_preview') ||
      project?.hostId !== request.hostId ||
      !server.hosts.some((host) => host.id === request.hostId)
    ) {
      throw new Error('workspace_intent_preview_not_authorized');
    }
  } else {
    const workspace = server.workspaces.find(
      (candidate) => candidate.id === request.workspaceId,
    );
    if (
      !server.actions.includes('workspace_resume_preview') ||
      workspace?.revision !== request.workspaceRevision ||
      !workspace.sessions.some((session) => session.id === request.sessionId)
    ) {
      throw new Error('workspace_intent_preview_not_authorized');
    }
  }
  // The v2 adapter will consume this pair later. This foundation cannot send it.
  return { request, preview, executable: false };
}

/** Production execution remains unavailable until the canonical v2 SDK exists. */
export function workspaceMutationAvailability(): {
  readonly enabled: false;
  readonly reason: 'platform_v2_sdk_and_auth_required';
} {
  return { enabled: false, reason: 'platform_v2_sdk_and_auth_required' };
}
