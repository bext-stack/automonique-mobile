// SPDX-License-Identifier: Elastic-2.0

import {
  HttpsPlatformV2Transport,
  IdempotencyKey,
  MutationPreviewDigest,
  PLATFORM_NEGOTIATION_SCHEMA_V1,
  PLATFORM_SCHEMA_V2,
  PlatformV2Client,
  PlatformVersionNumber,
  ProjectId,
  SupportedPlatformVersionNumber,
  UserWorkspaceId,
  WorkContextPageLimit,
  WorkContextRevision,
  WorkspaceIntentId,
  mutationPreviewDigest,
  validateReviewActionAgainstSnapshot,
  decodeWorkContextMutationApproval,
  type LineageProjection,
  type MutationApproval,
  type MutationPreview,
  type MutationReceipt,
  type PlatformNegotiationResponse,
  type PlatformV2Refusal,
  type ProjectId as ProjectIdValue,
  type ReviewSnapshot,
  type ReviewAction,
  type ReviewActionReceipt,
  type ReviewAuthority,
  type ReviewWorkspaceIdentity,
  type UserWorkspaceId as UserWorkspaceIdValue,
  type WorkContextMutationIntent,
  type WorkContextRecord,
  type WorkspaceIntent,
  type WorkspaceIntentOutcome,
} from '@automonique/sdk';
import * as Crypto from 'expo-crypto';
import {
  mobileV2AuthorizationDigest,
  type DelegatedMobileV2Authorization,
  type MobileV2Action,
} from './mobile-v2-authorization';
import {
  WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
  decodeWorkspaceV2Receipt,
  workspaceV2ReceiptSettled,
  type WorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptStore,
} from './workspace-v2-receipts';
import {
  REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
  admitReviewReceiptForHandle,
  reviewReceiptSettled,
  type ReviewV2ReceiptHandle,
  type ReviewV2ReceiptStore,
} from './review-v2-receipts';

const ALL_WORK_CONTEXT_KINDS = [
  'project',
  'host_setup',
  'checkout',
  'user_workspace',
  'attempt_workspace',
  'session',
  'pane',
] as const;
const PROJECT_PAGE_LIMIT = 128n;
const MAX_PROJECT_PAGES = 64;
const MAX_PROJECT_RECORDS = 1_024;

export type WorkspaceLifecycleIntent = Extract<
  WorkContextMutationIntent,
  {
    readonly kind:
      | 'create_user_workspace'
      | 'create_attempt_workspace'
      | 'resume_attempt_workspace'
      | 'resume_session';
  }
>;

export interface PreparedWorkspaceMutation {
  readonly project: ProjectIdValue;
  readonly preview: MutationPreview;
  readonly previewDigest: MutationPreviewDigest;
}

export type WorkspaceMutationConfirmation =
  | { readonly kind: 'cancelled_locally' }
  | { readonly kind: 'denied'; readonly approval: MutationApproval }
  | {
      readonly kind: 'submitted';
      readonly idempotencyKey: string;
      readonly receipt: MutationReceipt;
      readonly projectionRefreshRequired: true;
    }
  | {
      readonly kind: 'ambiguous';
      readonly idempotencyKey: string;
      readonly projectionRefreshRequired: true;
    };

export type WorkspaceMutationReconciliation =
  | {
      readonly kind: 'accepted';
      readonly handle: WorkspaceV2ReceiptHandle;
      readonly receipt: MutationReceipt;
    }
  | {
      readonly kind: 'settled';
      readonly handle: WorkspaceV2ReceiptHandle;
      readonly receipt: MutationReceipt;
      readonly projectionRefreshRequired: true;
    };

export interface WorkspaceIntentResult {
  readonly project: ProjectIdValue;
  readonly intentId: ReturnType<typeof WorkspaceIntentId>;
  readonly outcome: WorkspaceIntentOutcome;
}

/** Immutable, non-secret coordinates for the exact delegated gateway generation. */
export interface WorkspaceV2AuthorizationScope {
  readonly serverIdentity: string;
  readonly tenantId: string;
  readonly authorizationRevision: bigint;
  readonly principalGeneration: bigint;
  readonly delegationId: string;
  readonly expiresAtMs: bigint;
  readonly projectRoots: readonly string[];
  readonly actions: readonly string[];
}

export interface ReviewActionSubmission {
  readonly kind: 'submitted' | 'ambiguous';
  readonly idempotencyKey: string;
  readonly receipt: ReviewActionReceipt | null;
  readonly projectionRefreshRequired: true;
}

export interface ReviewActionReconciliation {
  readonly handle: ReviewV2ReceiptHandle;
  readonly receipt: ReviewActionReceipt;
  readonly projectionRefreshRequired: boolean;
}

export interface WorkspaceV2Gateway {
  readonly authorizationScope: WorkspaceV2AuthorizationScope;
  readonly reviewEffectKinds: readonly ('add_comment' | 'approve_review')[];
  negotiate(signal?: AbortSignal): Promise<void>;
  loadProject(
    project: string,
    signal?: AbortSignal,
  ): Promise<readonly WorkContextRecord[]>;
  loadLineage(
    project: string,
    workspace: string,
    signal?: AbortSignal,
  ): Promise<LineageProjection>;
  loadReview(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    signal?: AbortSignal,
  ): Promise<ReviewSnapshot>;
  executeReviewAction(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: bigint,
    authority: ReviewAuthority,
    action: Extract<
      ReviewAction,
      { readonly kind: 'add_comment' | 'approve_review' }
    >,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ReviewActionSubmission>;
  pendingReviewReceipts(): Promise<readonly ReviewV2ReceiptHandle[]>;
  reconcileReviewAction(
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ReviewActionReconciliation>;
  prepareMutation(
    project: string,
    intent: WorkspaceLifecycleIntent,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PreparedWorkspaceMutation>;
  confirmMutation(
    prepared: PreparedWorkspaceMutation,
    decision: 'grant' | 'deny',
    signal?: AbortSignal,
  ): Promise<WorkspaceMutationConfirmation>;
  pendingMutationReceipts(): Promise<readonly WorkspaceV2ReceiptHandle[]>;
  reconcileMutation(
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceMutationReconciliation>;
  submitWorkspaceIntent(
    project: string,
    intent: WorkspaceIntent,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentResult>;
  getWorkspaceIntent(
    project: string,
    intentId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentResult>;
  cancelWorkspaceIntent(
    project: string,
    workspace: string,
    expectedRevision: bigint,
    intentId: string,
    targetIntentId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentResult>;
}

export class WorkspaceV2GatewayError extends Error {
  constructor(
    readonly category: string,
    options?: ErrorOptions,
  ) {
    super(category, options);
    this.name = 'WorkspaceV2GatewayError';
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

interface WorkspaceV2Client {
  negotiate(
    offer: {
      readonly schema: typeof PLATFORM_NEGOTIATION_SCHEMA_V1;
      readonly versions: readonly ReturnType<typeof PlatformVersionNumber>[];
    },
    signal?: AbortSignal,
  ): Promise<PlatformNegotiationResponse>;
  queryWorkContexts(
    query: Parameters<PlatformV2Client['queryWorkContexts']>[0],
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['queryWorkContexts']>;
  getLineage(
    project: ProjectIdValue,
    workspace: UserWorkspaceIdValue,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getLineage']>;
  getReview(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getReview']>;
  executeReviewAction(
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: ReturnType<typeof WorkContextRevision>,
    action: ReviewAction,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['executeReviewAction']>;
  getReviewReceipt(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getReviewReceipt']>;
  prepareMutation(
    key: ReturnType<typeof IdempotencyKey>,
    intent: WorkContextMutationIntent,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['prepareMutation']>;
  decideMutation(
    preview: MutationPreview['preview'],
    digest: MutationPreviewDigest,
    decision: 'granted' | 'denied',
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['decideMutation']>;
  submitMutation(
    preview: MutationPreview['preview'],
    digest: MutationPreviewDigest,
    approvalId: MutationApproval['id'] | null,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['submitMutation']>;
  getMutationReceipt(
    lookup: Parameters<PlatformV2Client['getMutationReceipt']>[0],
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getMutationReceipt']>;
  submitWorkspaceIntent(
    project: ProjectIdValue,
    intent: WorkspaceIntent,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['submitWorkspaceIntent']>;
  getWorkspaceIntent(
    project: ProjectIdValue,
    intentId: ReturnType<typeof WorkspaceIntentId>,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getWorkspaceIntent']>;
}

interface WorkspaceV2GatewayOptions {
  readonly client: WorkspaceV2Client;
  readonly authorization: DelegatedMobileV2Authorization;
  readonly authorizationDigest?: () => Promise<string>;
  readonly now?: () => number;
  readonly operationGuard?: WorkspaceV2OperationGuard;
  readonly receiptStore: WorkspaceV2ReceiptStore;
  readonly reviewReceiptStore?: ReviewV2ReceiptStore;
}

export interface WorkspaceV2OperationGuard {
  readonly signal: AbortSignal;
  admit(): void;
}

function refusal(
  value: PlatformV2Refusal | { readonly category: string },
): never {
  throw new WorkspaceV2GatewayError(value.category);
}

function requireNegotiatedV2(response: PlatformNegotiationResponse): void {
  if (response.kind === 'platform_v2_refused') refusal(response.refusal);
  if (
    response.negotiated.version !== SupportedPlatformVersionNumber(2n) ||
    response.negotiated.schema !== PLATFORM_SCHEMA_V2 ||
    response.negotiated.work_context !== 'v2_structured'
  ) {
    throw new WorkspaceV2GatewayError('platform_v2_not_negotiated');
  }
}

function requireMutationIntentProject(
  project: ProjectIdValue,
  intent: WorkspaceLifecycleIntent,
): void {
  if (
    intent.kind === 'create_user_workspace' &&
    (intent.project.identity.kind !== 'project' ||
      intent.project.identity.id !== project)
  ) {
    throw new WorkspaceV2GatewayError('workspace_project_mismatch');
  }
}

function requireLivePreview(preview: MutationPreview, now: number): void {
  if (preview.expires_at_ms <= BigInt(now)) {
    throw new WorkspaceV2GatewayError('preview_expired');
  }
}

function relation(
  record: WorkContextRecord,
  kind: WorkContextRecord['relations'][number]['kind'],
): WorkContextRecord['relations'][number]['target'] {
  const target = record.relations.find((entry) => entry.kind === kind)?.target;
  if (target === undefined) {
    throw new WorkspaceV2GatewayError('workspace_project_graph_incomplete');
  }
  return target;
}

function requireLocalIdentity(
  identity: WorkContextRecord['identity'],
  kind: Exclude<
    WorkContextRecord['identity']['kind'],
    'repository' | 'platform_session'
  >,
): string {
  if (identity.kind !== kind || !('id' in identity)) {
    throw new WorkspaceV2GatewayError('workspace_project_graph_invalid');
  }
  return identity.id;
}

function validateProjectGraph(
  project: ProjectIdValue,
  records: readonly WorkContextRecord[],
): void {
  const byKind = new Map<string, WorkContextRecord>();
  for (const record of records) {
    if (
      record.identity.kind === 'repository' ||
      record.identity.kind === 'platform_session'
    ) {
      throw new WorkspaceV2GatewayError('workspace_project_graph_invalid');
    }
    byKind.set(`${record.identity.kind}\u0000${record.identity.id}`, record);
  }
  const root = byKind.get(`project\u0000${project}`);
  if (
    root === undefined ||
    records.filter((item) => item.identity.kind === 'project').length !== 1
  ) {
    throw new WorkspaceV2GatewayError('workspace_project_graph_incomplete');
  }
  const local = (
    identity: WorkContextRecord['identity'],
    kind: Exclude<
      WorkContextRecord['identity']['kind'],
      'repository' | 'platform_session'
    >,
  ): WorkContextRecord => {
    const id = requireLocalIdentity(identity, kind);
    const record = byKind.get(`${kind}\u0000${id}`);
    if (record === undefined) {
      throw new WorkspaceV2GatewayError('workspace_project_graph_incomplete');
    }
    return record;
  };
  const exactProject = (identity: WorkContextRecord['identity']): void => {
    if (requireLocalIdentity(identity, 'project') !== project) {
      throw new WorkspaceV2GatewayError('workspace_project_graph_cross_scope');
    }
  };
  for (const record of records) {
    switch (record.identity.kind) {
      case 'project':
        exactProject(record.identity);
        break;
      case 'host_setup':
        exactProject(relation(record, 'host_setup_project'));
        break;
      case 'checkout': {
        exactProject(relation(record, 'checkout_project'));
        const host = local(
          relation(record, 'checkout_host_setup'),
          'host_setup',
        );
        exactProject(relation(host, 'host_setup_project'));
        break;
      }
      case 'user_workspace': {
        exactProject(relation(record, 'user_workspace_project'));
        const checkout = local(
          relation(record, 'user_workspace_checkout'),
          'checkout',
        );
        exactProject(relation(checkout, 'checkout_project'));
        break;
      }
      case 'attempt_workspace':
        local(relation(record, 'attempt_user_workspace'), 'user_workspace');
        break;
      case 'session':
        local(
          relation(record, 'session_attempt_workspace'),
          'attempt_workspace',
        );
        break;
      case 'pane':
        local(relation(record, 'pane_session'), 'session');
        break;
      case 'repository':
      case 'platform_session':
        throw new WorkspaceV2GatewayError('workspace_project_graph_invalid');
    }
  }
}

function snapshotRecord(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  kind:
    | 'project'
    | 'host_setup'
    | 'checkout'
    | 'user_workspace'
    | 'attempt_workspace'
    | 'session'
    | 'pane',
  id: string,
): WorkContextRecord {
  const records = snapshots.get(project);
  if (records === undefined) {
    throw new WorkspaceV2GatewayError('workspace_project_snapshot_required');
  }
  const record = records.find(
    (candidate) =>
      candidate.identity.kind === kind &&
      'id' in candidate.identity &&
      candidate.identity.id === id,
  );
  if (record === undefined) {
    throw new WorkspaceV2GatewayError('workspace_target_outside_project');
  }
  return record;
}

function requireExpectedRecord(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  expected: Extract<
    WorkContextMutationIntent,
    { readonly kind: 'create_user_workspace' }
  >['project'],
): WorkContextRecord {
  if (
    expected.identity.kind === 'repository' ||
    expected.identity.kind === 'platform_session'
  ) {
    throw new WorkspaceV2GatewayError('workspace_target_outside_project');
  }
  const record = snapshotRecord(
    snapshots,
    project,
    expected.identity.kind,
    expected.identity.id,
  );
  if (record.revision !== expected.revision) {
    throw new WorkspaceV2GatewayError('workspace_target_revision_stale');
  }
  return record;
}

function requireWorkspaceInSnapshot(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  workspace: UserWorkspaceIdValue,
): WorkContextRecord {
  return snapshotRecord(snapshots, project, 'user_workspace', workspace);
}

function requireWorkspaceRevision(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  workspace: UserWorkspaceIdValue,
  revision: bigint,
): WorkContextRecord {
  const record = requireWorkspaceInSnapshot(snapshots, project, workspace);
  if (record.revision !== WorkContextRevision(revision)) {
    throw new WorkspaceV2GatewayError('workspace_target_revision_stale');
  }
  return record;
}

function requireReviewWorkspaceInSnapshot(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  workspace: ReviewWorkspaceIdentity,
): void {
  if (!('id' in workspace)) {
    throw new WorkspaceV2GatewayError('workspace_target_outside_project');
  }
  snapshotRecord(snapshots, project, workspace.kind, workspace.id);
}

function sameWorkContextIdentity(
  left: WorkContextRecord['identity'],
  right: WorkContextRecord['identity'],
): boolean {
  if (left.kind !== right.kind) return false;
  if ('id' in left && 'id' in right) return left.id === right.id;
  if ('resource' in left && 'resource' in right) {
    return (
      left.resource.authority === right.resource.authority &&
      left.resource.kind === right.resource.kind &&
      left.resource.id === right.resource.id
    );
  }
  return false;
}

function sameReviewAuthority(
  left: ReviewAuthority,
  right: ReviewAuthority,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function reviewSnapshotKey(
  project: ProjectIdValue,
  workspace: ReviewWorkspaceIdentity,
): string {
  if (!('id' in workspace)) {
    throw new WorkspaceV2GatewayError('workspace_target_outside_project');
  }
  return `${project}\u0000${workspace.kind}\u0000${workspace.id}`;
}

async function reviewActionDigest(
  workspace: ReviewWorkspaceIdentity,
  expectedRevision: bigint,
  authority: ReviewAuthority,
  action: ReviewAction,
): Promise<string> {
  const canonical = JSON.stringify(
    {
      schema: 'automonique.mobile-review-action-digest/v1',
      workspace,
      expectedRevision,
      authority,
      action,
    },
    (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
  );
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonical,
  );
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new WorkspaceV2GatewayError('review_action_digest_invalid');
  }
  return `sha256:${digest}`;
}

function requireMutationAncestry(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  intent: WorkspaceLifecycleIntent,
): void {
  switch (intent.kind) {
    case 'create_user_workspace':
      requireExpectedRecord(snapshots, project, intent.project);
      requireExpectedRecord(snapshots, project, intent.checkout);
      break;
    case 'create_attempt_workspace':
      requireExpectedRecord(snapshots, project, intent.user_workspace);
      break;
    case 'resume_attempt_workspace':
    case 'resume_session':
      requireExpectedRecord(snapshots, project, intent.target);
      break;
  }
}

function requireWorkspaceIntentAncestry(
  snapshots: ReadonlyMap<ProjectIdValue, readonly WorkContextRecord[]>,
  project: ProjectIdValue,
  intent: WorkspaceIntent,
): void {
  if (intent.kind === 'create') {
    snapshotRecord(snapshots, project, 'project', project);
    return;
  }
  requireWorkspaceRevision(
    snapshots,
    project,
    UserWorkspaceId(intent.request.workspace),
    intent.request.expected_revision,
  );
}

function requireWorkspaceIntentOutcome(
  intent: WorkspaceIntent,
  outcome: WorkspaceIntentOutcome,
): void {
  if (
    outcome.kind === 'accepted' ||
    outcome.kind === 'unknown' ||
    outcome.kind === 'conflict'
  ) {
    return;
  }
  if (
    (intent.kind === 'create' && outcome.kind === 'created') ||
    (intent.kind === 'resume' &&
      outcome.kind === 'resumed' &&
      outcome.workspace === intent.request.workspace) ||
    (intent.kind === 'cancel' &&
      outcome.kind === 'cancelled' &&
      outcome.target_intent_id === intent.request.target_intent_id)
  ) {
    return;
  }
  throw new WorkspaceV2GatewayError('workspace_intent_outcome_mismatch');
}

export function createWorkspaceV2Gateway(
  options: WorkspaceV2GatewayOptions,
): WorkspaceV2Gateway {
  const now = options.now ?? Date.now;
  const authorization = deepFreeze({
    ...options.authorization,
    project_roots: [...options.authorization.project_roots],
    actions: [...options.authorization.actions],
  });
  const pendingPreviews = new WeakSet<PreparedWorkspaceMutation>();
  const projectSnapshots = new Map<
    ProjectIdValue,
    readonly WorkContextRecord[]
  >();
  const reviewSnapshots = new Map<string, ReviewSnapshot>();
  let digestPromise: Promise<string> | null = null;
  const authorizationDigest = (): Promise<string> => {
    digestPromise ??= (
      options.authorizationDigest ??
      (() => mobileV2AuthorizationDigest(authorization))
    )();
    return digestPromise;
  };
  const receiptStore = options.receiptStore;
  const reviewReceiptStore = options.reviewReceiptStore;

  function requireDelegatedAction(action: string): void {
    if (!(authorization.actions as readonly string[]).includes(action)) {
      throw new WorkspaceV2GatewayError('mobile_v2_action_unauthorized');
    }
  }

  function requireAction(action: MobileV2Action): void {
    requireDelegatedAction(action);
  }

  function requireProject(project: ProjectIdValue): void {
    if (!authorization.project_roots.includes(project)) {
      throw new WorkspaceV2GatewayError('mobile_v2_project_unauthorized');
    }
  }

  function admitCurrentGeneration(): void {
    if (authorization.expires_at_ms <= BigInt(now())) {
      throw new WorkspaceV2GatewayError('mobile_v2_authorization_expired');
    }
    options.operationGuard?.admit();
  }

  async function guardedReceiptOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    admitCurrentGeneration();
    const result = await operation();
    admitCurrentGeneration();
    return result;
  }

  async function guarded<T>(
    signal: AbortSignal | undefined,
    operation: (combined: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    admitCurrentGeneration();
    const controller = new AbortController();
    const sources = [signal, options.operationGuard?.signal].filter(
      (source): source is AbortSignal => source !== undefined,
    );
    const listeners = sources.map((source) => ({
      source,
      listener: () => controller.abort(source.reason),
    }));
    for (const { source, listener } of listeners) {
      if (source.aborted) listener();
      else source.addEventListener('abort', listener, { once: true });
    }
    if (controller.signal.aborted) {
      throw new WorkspaceV2GatewayError('aborted');
    }
    try {
      const result = await operation(
        sources.length === 0 ? undefined : controller.signal,
      );
      admitCurrentGeneration();
      return result;
    } finally {
      for (const { source, listener } of listeners) {
        source.removeEventListener('abort', listener);
      }
      if (!controller.signal.aborted) controller.abort('operation_complete');
    }
  }

  return {
    authorizationScope: deepFreeze({
      serverIdentity: authorization.server_identity,
      tenantId: authorization.tenant_id,
      authorizationRevision: authorization.authorization_revision,
      principalGeneration: authorization.principal_generation,
      delegationId: authorization.delegation_id,
      expiresAtMs: authorization.expires_at_ms,
      projectRoots: [...authorization.project_roots],
      actions: [...authorization.actions],
    }),
    reviewEffectKinds:
      reviewReceiptStore !== undefined &&
      (authorization.actions as readonly string[]).includes(
        'execute_review_action',
      ) &&
      (authorization.actions as readonly string[]).includes(
        'get_review_receipt',
      )
        ? ['add_comment', 'approve_review']
        : [],
    async negotiate(signal) {
      // Negotiation does not itself confer an operation grant.
      requireNegotiatedV2(
        await guarded(signal, (combined) =>
          options.client.negotiate(
            {
              schema: PLATFORM_NEGOTIATION_SCHEMA_V1,
              versions: [PlatformVersionNumber(1n), PlatformVersionNumber(2n)],
            },
            combined,
          ),
        ),
      );
    },

    async loadProject(projectValue, signal) {
      requireAction('query_work_contexts');
      const project = ProjectId(projectValue);
      requireProject(project);
      const records: WorkContextRecord[] = [];
      const identities = new Set<string>();
      const cursors = new Set<string>();
      let after: Parameters<PlatformV2Client['queryWorkContexts']>[0]['after'] =
        null;
      for (let pageIndex = 0; pageIndex < MAX_PROJECT_PAGES; pageIndex += 1) {
        const response = await guarded(signal, (combined) =>
          options.client.queryWorkContexts(
            {
              after,
              kinds: ALL_WORK_CONTEXT_KINDS,
              lifecycles: [],
              limit: WorkContextPageLimit(PROJECT_PAGE_LIMIT),
              parent: null,
              project,
              schema: PLATFORM_SCHEMA_V2,
            },
            combined,
          ),
        );
        if (response.kind === 'platform_v2_refused') refusal(response.refusal);
        if (response.kind === 'work_context_resync') {
          throw new WorkspaceV2GatewayError('workspace_v2_resync_required');
        }
        for (const record of response.page.items) {
          const identity =
            record.identity.kind === 'platform_session' ||
            record.identity.kind === 'repository'
              ? JSON.stringify([
                  record.identity.kind,
                  record.identity.resource.authority,
                  record.identity.resource.kind,
                  record.identity.resource.id,
                ])
              : JSON.stringify([record.identity.kind, record.identity.id]);
          if (identities.has(identity)) {
            throw new WorkspaceV2GatewayError(
              'workspace_record_duplicate_across_pages',
            );
          }
          identities.add(identity);
          records.push(record);
          if (records.length > MAX_PROJECT_RECORDS) {
            throw new WorkspaceV2GatewayError('workspace_project_too_large');
          }
        }
        if (!response.page.has_more) {
          validateProjectGraph(project, records);
          const snapshot = deepFreeze([...records]);
          projectSnapshots.set(project, snapshot);
          return snapshot;
        }
        const next = response.page.next_cursor;
        if (next === null || cursors.has(next)) {
          throw new WorkspaceV2GatewayError('workspace_cursor_cycle');
        }
        cursors.add(next);
        after = next;
      }
      throw new WorkspaceV2GatewayError('workspace_page_limit_exceeded');
    },

    async loadLineage(projectValue, workspaceValue, signal) {
      requireAction('get_lineage');
      const project = ProjectId(projectValue);
      requireProject(project);
      requireWorkspaceInSnapshot(
        projectSnapshots,
        project,
        UserWorkspaceId(workspaceValue),
      );
      const response = await guarded(signal, (combined) =>
        options.client.getLineage(
          project,
          UserWorkspaceId(workspaceValue),
          combined,
        ),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      if (
        response.lineage.workspace !== UserWorkspaceId(workspaceValue) ||
        response.lineage.orchestration.some(
          (record) => record.workspace !== UserWorkspaceId(workspaceValue),
        )
      ) {
        throw new WorkspaceV2GatewayError('workspace_lineage_mismatch');
      }
      return response.lineage;
    },

    async loadReview(projectValue, workspace, signal) {
      requireAction('get_review');
      const project = ProjectId(projectValue);
      requireProject(project);
      requireReviewWorkspaceInSnapshot(projectSnapshots, project, workspace);
      const response = await guarded(signal, (combined) =>
        options.client.getReview(project, workspace, combined),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      if (!sameWorkContextIdentity(response.review.workspace, workspace)) {
        throw new WorkspaceV2GatewayError('workspace_review_mismatch');
      }
      const snapshot = deepFreeze(response.review);
      reviewSnapshots.set(reviewSnapshotKey(project, workspace), snapshot);
      return snapshot;
    },

    async executeReviewAction(
      projectValue,
      workspace,
      expectedRevision,
      authority,
      action,
      idempotencyKeyValue,
      signal,
    ) {
      requireDelegatedAction('execute_review_action');
      requireDelegatedAction('get_review_receipt');
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const project = ProjectId(projectValue);
      requireProject(project);
      requireReviewWorkspaceInSnapshot(projectSnapshots, project, workspace);
      const snapshot = reviewSnapshots.get(
        reviewSnapshotKey(project, workspace),
      );
      if (
        snapshot === undefined ||
        snapshot.revision !== WorkContextRevision(expectedRevision) ||
        !sameReviewAuthority(snapshot.review.authority, authority) ||
        !['add_comment', 'approve_review'].includes(action.kind)
      ) {
        throw new WorkspaceV2GatewayError('review_target_revision_stale');
      }
      validateReviewActionAgainstSnapshot(
        {
          schema: 'automonique.platform/review/v1',
          platform_version: 2n,
          actor: authorization.actor_id,
          authentication: 'user_session',
          authority,
          workspace,
          expected_revision: WorkContextRevision(expectedRevision),
          idempotency_key: IdempotencyKey(idempotencyKeyValue),
          action,
        },
        snapshot,
      );
      const idempotencyKey = IdempotencyKey(idempotencyKeyValue);
      const persistedAuthorizationDigest = await guardedReceiptOperation(() =>
        authorizationDigest(),
      );
      const handle: ReviewV2ReceiptHandle = {
        schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
        authorization_digest: persistedAuthorizationDigest,
        project,
        workspace_kind: workspace.kind as
          'user_workspace' | 'attempt_workspace',
        workspace_id: 'id' in workspace ? workspace.id : '',
        expected_revision: expectedRevision.toString(),
        authority_kind: 'review',
        authority_id: authority.id,
        actor_id: authorization.actor_id,
        action_kind: action.kind,
        action_digest: await reviewActionDigest(
          workspace,
          expectedRevision,
          authority,
          action,
        ),
        idempotency_key: idempotencyKey,
        created_at_ms: BigInt(now()).toString(),
      };
      let inserted = false;
      try {
        admitCurrentGeneration();
        inserted = await reviewReceiptStore.put(handle);
        admitCurrentGeneration();
      } catch (error) {
        if (inserted) {
          await reviewReceiptStore
            .remove(idempotencyKey)
            .catch(() => undefined);
        }
        throw new WorkspaceV2GatewayError('review_action_not_submitted', {
          cause: error,
        });
      }
      if (!inserted) {
        return {
          kind: 'ambiguous',
          idempotencyKey,
          receipt: null,
          projectionRefreshRequired: true,
        };
      }
      let invoked = false;
      let response: Awaited<
        ReturnType<WorkspaceV2Client['executeReviewAction']>
      >;
      try {
        response = await guarded(signal, (combined) => {
          invoked = true;
          return options.client.executeReviewAction(
            workspace,
            WorkContextRevision(expectedRevision),
            action,
            idempotencyKey,
            combined,
          );
        });
      } catch (error) {
        if (!invoked) {
          await reviewReceiptStore
            .remove(idempotencyKey)
            .catch(() => undefined);
          throw new WorkspaceV2GatewayError('review_action_not_submitted', {
            cause: error,
          });
        }
        return {
          kind: 'ambiguous',
          idempotencyKey,
          receipt: null,
          projectionRefreshRequired: true,
        };
      }
      if (response.kind === 'platform_v2_refused') {
        await guardedReceiptOperation(() =>
          reviewReceiptStore.remove(idempotencyKey),
        );
        refusal(response.refusal);
      }
      const receipt = admitReviewReceiptForHandle(response.receipt, handle);
      if (reviewReceiptSettled(receipt)) {
        await guardedReceiptOperation(() =>
          reviewReceiptStore.remove(idempotencyKey),
        );
      }
      return {
        kind: 'submitted',
        idempotencyKey,
        receipt,
        projectionRefreshRequired: true,
      };
    },

    async pendingReviewReceipts() {
      requireDelegatedAction('get_review_receipt');
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const handles = await guardedReceiptOperation(() =>
        reviewReceiptStore.list(),
      );
      return handles.filter((handle) =>
        authorization.project_roots.includes(ProjectId(handle.project)),
      );
    },

    async reconcileReviewAction(idempotencyKeyValue, signal) {
      requireDelegatedAction('get_review_receipt');
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const idempotencyKey = IdempotencyKey(idempotencyKeyValue);
      const handles = await guardedReceiptOperation(() =>
        reviewReceiptStore.list(),
      );
      const handle = handles.find(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (handle === undefined) {
        throw new WorkspaceV2GatewayError('review_receipt_handle_missing');
      }
      const project = ProjectId(handle.project);
      requireProject(project);
      const workspace: ReviewWorkspaceIdentity = {
        kind: handle.workspace_kind,
        id: handle.workspace_id,
      } as ReviewWorkspaceIdentity;
      const response = await guarded(signal, (combined) =>
        options.client.getReviewReceipt(
          project,
          workspace,
          idempotencyKey,
          combined,
        ),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      const receipt = admitReviewReceiptForHandle(response.receipt, handle);
      if (reviewReceiptSettled(receipt)) {
        await guardedReceiptOperation(() =>
          reviewReceiptStore.remove(idempotencyKey),
        );
      }
      return {
        handle,
        receipt,
        projectionRefreshRequired: reviewReceiptSettled(receipt),
      };
    },

    async prepareMutation(projectValue, intent, keyValue, signal) {
      requireAction('prepare_mutation');
      const project = ProjectId(projectValue);
      requireProject(project);
      requireMutationAncestry(projectSnapshots, project, intent);
      requireMutationIntentProject(project, intent);
      const response = await guarded(signal, (combined) =>
        options.client.prepareMutation(
          IdempotencyKey(keyValue),
          intent,
          combined,
        ),
      );
      if (
        response.kind === 'platform_v2_refused' ||
        response.kind === 'mutation_refused'
      ) {
        refusal(
          response.kind === 'mutation_refused'
            ? response.refusal
            : response.refusal,
        );
      }
      const prepared: PreparedWorkspaceMutation = Object.freeze({
        project,
        preview: response.preview,
        previewDigest: mutationPreviewDigest(response.preview),
      });
      requireLivePreview(prepared.preview, now());
      pendingPreviews.add(prepared);
      return prepared;
    },

    async confirmMutation(prepared, decision, signal) {
      if (!pendingPreviews.delete(prepared)) {
        throw new WorkspaceV2GatewayError(
          'workspace_confirmation_missing_or_replayed',
        );
      }
      requireLivePreview(prepared.preview, now());
      const expectedDigest = mutationPreviewDigest(prepared.preview);
      if (prepared.previewDigest !== expectedDigest) {
        throw new WorkspaceV2GatewayError('workspace_preview_mismatch');
      }
      if (decision === 'deny' && prepared.preview.approval === 'not_required') {
        return { kind: 'cancelled_locally' };
      }
      let approval: MutationApproval | null = null;
      if (prepared.preview.approval === 'required') {
        requireAction('decide_mutation');
        const requestedDecision = decision === 'grant' ? 'granted' : 'denied';
        const response = await guarded(signal, (combined) =>
          options.client.decideMutation(
            prepared.preview.preview,
            prepared.previewDigest,
            requestedDecision,
            combined,
          ),
        );
        if (
          response.kind === 'platform_v2_refused' ||
          response.kind === 'mutation_refused'
        ) {
          refusal(response.refusal);
        }
        approval = decodeWorkContextMutationApproval(
          response.approval.canonical,
          prepared.preview,
        );
        if (approval.decision !== requestedDecision) {
          throw new WorkspaceV2GatewayError('workspace_approval_mismatch');
        }
        if (decision === 'deny') return { kind: 'denied', approval };
      }
      requireLivePreview(prepared.preview, now());
      requireAction('submit_mutation');
      requireProject(prepared.project);
      let persistedAuthorizationDigest: string;
      try {
        persistedAuthorizationDigest = await guardedReceiptOperation(() =>
          authorizationDigest(),
        );
      } catch (error) {
        throw new WorkspaceV2GatewayError('workspace_mutation_not_submitted', {
          cause: error,
        });
      }
      const handle: WorkspaceV2ReceiptHandle = {
        schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
        authorization_digest: persistedAuthorizationDigest,
        project: prepared.project,
        idempotency_key: prepared.preview.proposal.idempotency_key,
        preview_id: prepared.preview.preview.id,
        preview_revision: prepared.preview.preview.revision.toString(),
        preview_digest: prepared.previewDigest,
        request_digest: prepared.preview.proposal.request_digest,
        approval_id: approval?.id ?? null,
        expected_resulting_revision:
          prepared.preview.resulting.revision.toString(),
        created_at_ms: BigInt(now()).toString(),
      };
      // Persist only a bounded lookup capability before the one-shot submit.
      // Its digest is non-authority metadata; no grant, intent, preview payload,
      // or replayable outbox crosses the durable boundary.
      let inserted = false;
      try {
        admitCurrentGeneration();
        inserted = await receiptStore.put(handle);
        admitCurrentGeneration();
      } catch (error) {
        // The SDK submit has not been invoked. If this call inserted a handle,
        // compensate exactly that known-unsent local write even though the
        // generation may have changed while Async Storage was pending.
        if (inserted) {
          await receiptStore
            .remove(handle.idempotency_key)
            .catch(() => undefined);
        }
        throw new WorkspaceV2GatewayError('workspace_mutation_not_submitted', {
          cause: error,
        });
      }
      if (!inserted) {
        return {
          kind: 'ambiguous',
          idempotencyKey: handle.idempotency_key,
          projectionRefreshRequired: true,
        };
      }
      let submitted: Awaited<ReturnType<WorkspaceV2Client['submitMutation']>>;
      let submitInvoked = false;
      try {
        submitted = await guarded(signal, (combined) => {
          submitInvoked = true;
          return options.client.submitMutation(
            prepared.preview.preview,
            prepared.previewDigest,
            approval?.id ?? null,
            combined,
          );
        });
      } catch (error) {
        if (!submitInvoked) {
          if (inserted) {
            await receiptStore
              .remove(handle.idempotency_key)
              .catch(() => undefined);
          }
          throw new WorkspaceV2GatewayError(
            'workspace_mutation_not_submitted',
            {
              cause: error,
            },
          );
        }
        return {
          kind: 'ambiguous',
          idempotencyKey: handle.idempotency_key,
          projectionRefreshRequired: true,
        };
      }
      if (
        submitted.kind === 'platform_v2_refused' ||
        submitted.kind === 'mutation_refused'
      ) {
        await guardedReceiptOperation(() =>
          receiptStore.remove(handle.idempotency_key),
        );
        refusal(submitted.refusal);
      }
      const receipt = decodeWorkspaceV2Receipt(
        submitted.receipt.canonical,
        handle,
      );
      if (workspaceV2ReceiptSettled(receipt)) {
        await guardedReceiptOperation(() =>
          receiptStore.remove(handle.idempotency_key),
        );
      }
      admitCurrentGeneration();
      return {
        kind: 'submitted',
        idempotencyKey: handle.idempotency_key,
        receipt,
        projectionRefreshRequired: true,
      };
    },

    async pendingMutationReceipts() {
      requireAction('get_mutation_receipt');
      const handles = await guardedReceiptOperation(() => receiptStore.list());
      return handles.filter((handle) =>
        authorization.project_roots.includes(ProjectId(handle.project)),
      );
    },

    async reconcileMutation(idempotencyKeyValue, signal) {
      requireAction('get_mutation_receipt');
      const idempotencyKey = IdempotencyKey(idempotencyKeyValue);
      const handles = await guardedReceiptOperation(() => receiptStore.list());
      const handle = handles.find(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (handle === undefined) {
        throw new WorkspaceV2GatewayError('workspace_receipt_handle_missing');
      }
      const project = ProjectId(handle.project);
      requireProject(project);
      const response = await guarded(signal, (combined) =>
        options.client.getMutationReceipt(
          { project, idempotency_key: idempotencyKey },
          combined,
        ),
      );
      if (
        response.kind === 'platform_v2_refused' ||
        response.kind === 'mutation_refused'
      ) {
        refusal(response.refusal);
      }
      const receipt = decodeWorkspaceV2Receipt(
        response.receipt.canonical,
        handle,
      );
      if (workspaceV2ReceiptSettled(receipt)) {
        await guardedReceiptOperation(() =>
          receiptStore.remove(handle.idempotency_key),
        );
        admitCurrentGeneration();
        return {
          kind: 'settled',
          handle,
          receipt,
          projectionRefreshRequired: true,
        };
      }
      return { kind: 'accepted', handle, receipt };
    },

    async submitWorkspaceIntent(projectValue, intent, signal) {
      requireAction('submit_workspace_intent');
      const project = ProjectId(projectValue);
      requireProject(project);
      requireWorkspaceIntentAncestry(projectSnapshots, project, intent);
      const response = await guarded(signal, (combined) =>
        options.client.submitWorkspaceIntent(project, intent, combined),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      requireWorkspaceIntentOutcome(intent, response.result);
      return {
        project,
        intentId: intent.request.intent_id,
        outcome: response.result,
      };
    },

    async getWorkspaceIntent(projectValue, intentIdValue, signal) {
      requireAction('get_workspace_intent');
      const project = ProjectId(projectValue);
      requireProject(project);
      const response = await guarded(signal, (combined) =>
        options.client.getWorkspaceIntent(
          project,
          WorkspaceIntentId(intentIdValue),
          combined,
        ),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return {
        project,
        intentId: WorkspaceIntentId(intentIdValue),
        outcome: response.result,
      };
    },

    async cancelWorkspaceIntent(
      projectValue,
      workspaceValue,
      expectedRevision,
      intentIdValue,
      targetIntentIdValue,
      signal,
    ) {
      requireAction('submit_workspace_intent');
      const project = ProjectId(projectValue);
      requireProject(project);
      const workspace = UserWorkspaceId(workspaceValue);
      requireWorkspaceRevision(
        projectSnapshots,
        project,
        workspace,
        expectedRevision,
      );
      const intentId = WorkspaceIntentId(intentIdValue);
      const targetIntentId = WorkspaceIntentId(targetIntentIdValue);
      if (intentId === targetIntentId) {
        throw new WorkspaceV2GatewayError('workspace_cancel_target_invalid');
      }
      const intent: WorkspaceIntent = {
        kind: 'cancel',
        request: {
          expected_revision: WorkContextRevision(expectedRevision),
          intent_id: intentId,
          target_intent_id: targetIntentId,
          workspace,
        },
      };
      const response = await guarded(signal, (combined) =>
        options.client.submitWorkspaceIntent(project, intent, combined),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      requireWorkspaceIntentOutcome(intent, response.result);
      return { project, intentId, outcome: response.result };
    },
  };
}

export interface AuthorizedWorkspaceV2GatewayOptions {
  readonly authorization: DelegatedMobileV2Authorization;
  readonly authorizationDigest?: () => Promise<string>;
  readonly endpoint: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly token: () => string | Promise<string>;
  readonly operationGuard?: WorkspaceV2OperationGuard;
  readonly receiptStore: WorkspaceV2ReceiptStore;
  readonly reviewReceiptStore?: ReviewV2ReceiptStore;
}

/** Production constructor. The bearer and raw transport stay behind the SDK. */
export function createAuthorizedWorkspaceV2Gateway(
  options: AuthorizedWorkspaceV2GatewayOptions,
): WorkspaceV2Gateway {
  return createWorkspaceV2Gateway({
    authorization: options.authorization,
    ...(options.authorizationDigest === undefined
      ? {}
      : { authorizationDigest: options.authorizationDigest }),
    client: new PlatformV2Client(
      new HttpsPlatformV2Transport(
        options.endpoint,
        options.token,
        options.fetcher,
      ),
    ),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.operationGuard === undefined
      ? {}
      : { operationGuard: options.operationGuard }),
    receiptStore: options.receiptStore,
    ...(options.reviewReceiptStore === undefined
      ? {}
      : { reviewReceiptStore: options.reviewReceiptStore }),
  });
}

// Keep these protocol types reachable only from this modular review/lifecycle
// boundary. Issue #35 can build UI policy without widening the production
// transport or exposing generic execute.
export type { MutationReceipt, WorkspaceV2ReceiptHandle };
