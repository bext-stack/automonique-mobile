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
  ReviewReceiptCorrelationDigest,
  SupportedPlatformVersionNumber,
  UserWorkspaceId,
  WorkContextPageLimit,
  WorkContextRevision,
  WorkspaceIntentId,
  mutationPreviewDigest,
  validateReviewActionAgainstSnapshot,
  decodeWorkContextMutationApproval,
  type AttentionSource,
  type AttentionSourceSnapshot,
  type LineageProjection,
  type MutationApproval,
  type MutationPreview,
  type MutationReceipt,
  type PlatformNegotiationResponse,
  type PlatformV2Refusal,
  type ReviewCapabilities,
  type ReviewConfirmationDigest,
  type ReviewReceiptCorrelationDigest as ReviewReceiptCorrelationDigestValue,
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
  admitReviewV2ReceiptHandle,
  admitReviewReceiptForHandle,
  reviewReceiptSettled,
  type ReviewV2ReceiptHandle,
  type ReviewV2ReceiptStore,
} from './review-v2-receipts';
import {
  MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS,
  MOBILE_DIRECT_REVIEW_EFFECT_GRANTS,
  MOBILE_DIRECT_REVIEW_EFFECT_KINDS,
  MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS,
  isConfirmedReviewEffectKind,
  unavailableReviewEffectCategory,
  type MobileConfirmedReviewAction,
  type MobileDirectReviewAction,
  type MobilePullRequestReviewAction,
  type MobilePullRequestReviewEffectKind,
  type MobileSupportedReviewAction,
  type MobileSupportedReviewEffectKind,
} from './mobile-review-effects';

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
const NO_MOBILE_REVIEW_EFFECT_KINDS = Object.freeze([] as const);
const MAX_PULL_REQUEST_TITLE_BYTES = 256;

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

/** One generation-bound, server-issued, inert check-rerun confirmation. */
export interface PreparedCheckRerun {
  readonly project: ProjectIdValue;
  readonly workspace: ReviewWorkspaceIdentity;
  readonly workspaceRevision: bigint;
  readonly snapshotRevision: bigint;
  readonly authority: ReviewAuthority;
  readonly action: Extract<ReviewAction, { readonly kind: 'rerun_check' }>;
  readonly confirmationDigest: ReviewConfirmationDigest;
  readonly receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue;
}

/**
 * One generation-bound, server-issued, inert pull-request confirmation.
 *
 * Every authority-bearing field is copied out of the capability slot the
 * server minted from its own mutation-free preflight. The client contributes
 * only the human title on open and update; it never computes a revision, a
 * head, a pull-request identity, or either digest.
 */
export interface PreparedPullRequestAction {
  readonly project: ProjectIdValue;
  readonly workspace: ReviewWorkspaceIdentity;
  readonly workspaceRevision: bigint;
  readonly snapshotRevision: bigint;
  readonly authority: ReviewAuthority;
  readonly action: MobilePullRequestReviewAction;
  readonly confirmationDigest: ReviewConfirmationDigest;
  readonly receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue;
  /** Server-observed pull-request identity. Absent for open. */
  readonly pullRequestId: string | null;
  /** Server-observed head being merged. Merge only; never client-derived. */
  readonly expectedHeadRevision: string | null;
  /** Server-asserted merge readiness. Merge only. */
  readonly readiness: 'ready' | null;
}

/**
 * What the server will actually let this delegation do to the pull request,
 * for the render layer to decide which controls exist at all.
 *
 * A slot is present only when the server minted it *and* the delegation
 * carries the matching grant. It deliberately carries no confirmation or
 * correlation digest: deciding that a control exists must not be able to send
 * anything. The digests are minted separately, at confirmation time.
 */
export interface ReviewPullRequestGrant {
  readonly authority: ReviewAuthority;
  readonly expectedPullRequestRevision: bigint;
  readonly pullRequestId: string | null;
  readonly expectedHeadRevision: string | null;
  readonly readiness: 'ready' | null;
}

export interface ReviewPullRequestGrants {
  readonly project: ProjectIdValue;
  readonly workspace: ReviewWorkspaceIdentity;
  readonly workspaceRevision: bigint;
  readonly snapshotRevision: bigint;
  readonly open_pull_request: ReviewPullRequestGrant | null;
  readonly update_pull_request: ReviewPullRequestGrant | null;
  readonly merge_pull_request: ReviewPullRequestGrant | null;
}

export interface WorkspaceV2Gateway {
  readonly authorizationScope: WorkspaceV2AuthorizationScope;
  readonly reviewEffectKinds: readonly MobileSupportedReviewEffectKind[];
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
  /**
   * The authoritative attention read. Callers reduce the result through an
   * `AttentionSourceBoard`; the gateway never derives attention from review
   * state, and never widens the read past a project the authorization roots.
   */
  loadAttentionSourceSnapshot(
    project: string,
    userWorkspace: string,
    source: AttentionSource,
    signal?: AbortSignal,
  ): Promise<AttentionSourceSnapshot>;
  executeReviewAction(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: bigint,
    authority: ReviewAuthority,
    action: MobileDirectReviewAction,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ReviewActionSubmission>;
  previewCheckRerun(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    expectedWorkspaceRevision: bigint,
    expectedRevision: bigint,
    checkId: string,
    expectedCheckRevision: bigint,
    signal?: AbortSignal,
  ): Promise<PreparedCheckRerun>;
  confirmCheckRerun(
    prepared: PreparedCheckRerun,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ReviewActionSubmission>;
  /**
   * Read which pull-request families the server has actually earned for this
   * delegation. The answer is the render layer's only licence to draw a
   * control; an absent slot means the control does not exist.
   */
  loadReviewPullRequestGrants(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    expectedWorkspaceRevision: bigint,
    expectedRevision: bigint,
    signal?: AbortSignal,
  ): Promise<ReviewPullRequestGrants>;
  previewPullRequestAction(
    project: string,
    workspace: ReviewWorkspaceIdentity,
    expectedWorkspaceRevision: bigint,
    expectedRevision: bigint,
    kind: MobilePullRequestReviewEffectKind,
    title: string | null,
    signal?: AbortSignal,
  ): Promise<PreparedPullRequestAction>;
  confirmPullRequestAction(
    prepared: PreparedPullRequestAction,
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

/**
 * Capability-minimal Platform v2 projection used for multi-server discovery.
 * It deliberately cannot submit effects, manage receipts, or expose tokens.
 */
export type ReadOnlyWorkspaceV2Gateway = Pick<
  WorkspaceV2Gateway,
  | 'authorizationScope'
  | 'negotiate'
  | 'loadProject'
  | 'loadLineage'
  | 'loadReview'
  | 'loadAttentionSourceSnapshot'
>;

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
  getAttentionSourceSnapshot(
    source: AttentionSource,
    project: ProjectIdValue,
    userWorkspace: UserWorkspaceIdValue,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getAttentionSourceSnapshot']>;
  getReviewCapabilities(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getReviewCapabilities']>;
  executeReviewAction(
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: ReturnType<typeof WorkContextRevision>,
    action: ReviewAction,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['executeReviewAction']>;
  executeConfirmedReviewAction(
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: ReturnType<typeof WorkContextRevision>,
    action: MobileConfirmedReviewAction,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    confirmationDigest: ReviewConfirmationDigest,
    expectedWorkspaceRevision: ReturnType<typeof WorkContextRevision>,
    receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['executeConfirmedReviewAction']>;
  getReviewReceipt(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getReviewReceipt']>;
  getCorrelatedReviewReceipt(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    idempotencyKey: ReturnType<typeof IdempotencyKey>,
    receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue,
    signal?: AbortSignal,
  ): ReturnType<PlatformV2Client['getCorrelatedReviewReceipt']>;
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
  confirmedRecovery: {
    readonly confirmationDigest: ReviewConfirmationDigest;
    readonly expectedWorkspaceRevision: bigint;
    readonly receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue;
  } | null = null,
): Promise<string> {
  const coordinates =
    confirmedRecovery === null
      ? {
          schema: 'automonique.mobile-review-action-digest/v1',
          workspace,
          expectedRevision,
          authority,
          action,
          confirmationDigest: null,
        }
      : {
          schema: 'automonique.mobile-review-action-digest/v2',
          workspace,
          expectedRevision,
          authority,
          action,
          // Field name kept from the rerun-only generation of this schema so
          // that already-persisted v3 handles keep the digest they were
          // written with. The pull-request families share the same lane.
          rerunRecovery: confirmedRecovery,
        };
  const canonical = JSON.stringify(coordinates, (_key, value: unknown) =>
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
  const pendingCheckReruns = new WeakSet<PreparedCheckRerun>();
  const pendingPullRequestActions = new WeakSet<PreparedPullRequestAction>();
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
  const delegatedActions = authorization.actions as readonly string[];
  const holdsEveryGrant = (grants: readonly string[]): boolean =>
    grants.every((grant) => delegatedActions.includes(grant));
  // Each confirmed family is tested against its own grant set, never against a
  // shared "can act on pull requests" summary. A delegation carrying open and
  // update therefore yields exactly those two kinds and no merge kind.
  const reviewEffectKinds: readonly MobileSupportedReviewEffectKind[] =
    reviewReceiptStore === undefined
      ? NO_MOBILE_REVIEW_EFFECT_KINDS
      : Object.freeze([
          ...(holdsEveryGrant(MOBILE_DIRECT_REVIEW_EFFECT_GRANTS)
            ? MOBILE_DIRECT_REVIEW_EFFECT_KINDS
            : []),
          ...(
            Object.keys(
              MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS,
            ) as (keyof typeof MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS)[]
          ).filter((kind) =>
            holdsEveryGrant(MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS[kind]),
          ),
        ]);

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

  async function submitReviewEffect(options: {
    readonly project: ProjectIdValue;
    readonly workspace: ReviewWorkspaceIdentity;
    readonly expectedRevision: bigint;
    readonly authority: ReviewAuthority;
    readonly action: MobileSupportedReviewAction;
    readonly idempotencyKey: string;
    readonly confirmedRecovery: {
      readonly confirmationDigest: ReviewConfirmationDigest;
      readonly expectedWorkspaceRevision: bigint;
      readonly receiptCorrelationDigest: ReviewReceiptCorrelationDigestValue;
    } | null;
    readonly signal: AbortSignal | undefined;
    readonly send: (
      idempotencyKey: ReturnType<typeof IdempotencyKey>,
      signal: AbortSignal | undefined,
    ) => ReturnType<PlatformV2Client['executeReviewAction']>;
  }): Promise<ReviewActionSubmission> {
    if (reviewReceiptStore === undefined) {
      throw new WorkspaceV2GatewayError('review_effect_unavailable');
    }
    const idempotencyKey = IdempotencyKey(options.idempotencyKey);
    const persistedAuthorizationDigest = await guardedReceiptOperation(() =>
      authorizationDigest(),
    );
    const handle: ReviewV2ReceiptHandle = {
      schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
      authorization_digest: persistedAuthorizationDigest,
      project: options.project,
      workspace_kind: options.workspace.kind as
        'user_workspace' | 'attempt_workspace',
      workspace_id: 'id' in options.workspace ? options.workspace.id : '',
      expected_revision: options.expectedRevision.toString(),
      authority_kind: options.authority
        .kind as ReviewV2ReceiptHandle['authority_kind'],
      authority_id: options.authority.id,
      actor_id: authorization.actor_id,
      action_kind: options.action.kind,
      action_digest: await reviewActionDigest(
        options.workspace,
        options.expectedRevision,
        options.authority,
        options.action,
        options.confirmedRecovery,
      ),
      idempotency_key: idempotencyKey,
      created_at_ms: BigInt(now()).toString(),
      expected_workspace_revision:
        options.confirmedRecovery?.expectedWorkspaceRevision.toString() ?? null,
      receipt_correlation_digest:
        options.confirmedRecovery?.receiptCorrelationDigest ?? null,
    };
    let inserted = false;
    try {
      admitCurrentGeneration();
      inserted = await reviewReceiptStore.put(handle);
      admitCurrentGeneration();
    } catch (error) {
      if (inserted) {
        await reviewReceiptStore.remove(idempotencyKey).catch(() => undefined);
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
    let response: Awaited<ReturnType<PlatformV2Client['executeReviewAction']>>;
    try {
      response = await guarded(options.signal, (combined) => {
        invoked = true;
        return options.send(idempotencyKey, combined);
      });
    } catch (error) {
      if (!invoked) {
        await reviewReceiptStore.remove(idempotencyKey).catch(() => undefined);
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
  }

  async function readReviewCapabilities(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    expectedWorkspaceRevision: bigint,
    expectedRevision: bigint,
    signal: AbortSignal | undefined,
  ): Promise<ReviewCapabilities> {
    const response = await guarded(signal, (combined) =>
      options.client.getReviewCapabilities(project, workspace, combined),
    );
    if (response.kind === 'platform_v2_refused') refusal(response.refusal);
    const capabilities: ReviewCapabilities = response.capabilities;
    if (
      capabilities.project !== project ||
      !sameWorkContextIdentity(capabilities.workspace, workspace) ||
      capabilities.snapshot_revision !==
        WorkContextRevision(expectedRevision) ||
      capabilities.workspace_revision !==
        WorkContextRevision(expectedWorkspaceRevision)
    ) {
      throw new WorkspaceV2GatewayError('review_capabilities_stale');
    }
    return capabilities;
  }

  /**
   * Bind a pull-request effect to the exact workspace and review generation it
   * was rendered from, and refuse a pull-request projection the server has not
   * freshly observed.
   */
  function requirePullRequestTarget(
    project: ProjectIdValue,
    workspace: ReviewWorkspaceIdentity,
    expectedWorkspaceRevision: bigint,
    expectedRevision: bigint,
  ): ReviewSnapshot {
    requireProject(project);
    requireReviewWorkspaceInSnapshot(projectSnapshots, project, workspace);
    if (
      !('id' in workspace) ||
      snapshotRecord(projectSnapshots, project, workspace.kind, workspace.id)
        .revision !== WorkContextRevision(expectedWorkspaceRevision)
    ) {
      throw new WorkspaceV2GatewayError('workspace_target_revision_stale');
    }
    const snapshot = reviewSnapshots.get(reviewSnapshotKey(project, workspace));
    if (
      snapshot === undefined ||
      snapshot.revision !== WorkContextRevision(expectedRevision) ||
      snapshot.pull_request.freshness.state !== 'fresh'
    ) {
      throw new WorkspaceV2GatewayError('review_target_revision_stale');
    }
    return snapshot;
  }

  /**
   * Project one capability slot, or null. Null is returned both when the
   * server withheld the slot and when this delegation does not carry the
   * matching grant: in either case the family is not available to this actor,
   * and the caller must render nothing rather than something disabled.
   */
  function pullRequestGrant(
    kind: MobilePullRequestReviewEffectKind,
    capabilities: ReviewCapabilities,
    snapshot: ReviewSnapshot,
  ): ReviewPullRequestGrant | null {
    if (!holdsEveryGrant(MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS[kind])) {
      return null;
    }
    const slot = capabilities[kind];
    if (slot === null) return null;
    if (!sameReviewAuthority(slot.authority, snapshot.pull_request.authority)) {
      throw new WorkspaceV2GatewayError('review_pull_request_capability_stale');
    }
    return {
      authority: slot.authority,
      expectedPullRequestRevision: slot.expected_pull_request_revision,
      pullRequestId: 'pull_request_id' in slot ? slot.pull_request_id : null,
      expectedHeadRevision:
        'expected_head_revision' in slot ? slot.expected_head_revision : null,
      readiness: 'readiness' in slot ? slot.readiness : null,
    };
  }

  function pullRequestTitle(value: string | null): string {
    if (
      value === null ||
      value.length === 0 ||
      new TextEncoder().encode(value).byteLength >
        MAX_PULL_REQUEST_TITLE_BYTES ||
      /\p{Cc}/u.test(value)
    ) {
      throw new WorkspaceV2GatewayError('review_pull_request_title_invalid');
    }
    return value;
  }

  /**
   * Build the wire action out of the capability slot. The title is the only
   * client contribution, and merge accepts none at all: its head, its
   * pull-request identity and its revision are all the server's own reading.
   */
  function pullRequestAction(
    kind: MobilePullRequestReviewEffectKind,
    grant: ReviewPullRequestGrant,
    title: string | null,
  ): MobilePullRequestReviewAction {
    const expectedPullRequestRevision = WorkContextRevision(
      grant.expectedPullRequestRevision,
    );
    if (kind === 'open_pull_request') {
      return {
        kind,
        payload: {
          expected_pull_request_revision: expectedPullRequestRevision,
          title: pullRequestTitle(title),
        },
      };
    }
    if (grant.pullRequestId === null) {
      throw new WorkspaceV2GatewayError('review_pull_request_capability_stale');
    }
    if (kind === 'update_pull_request') {
      return {
        kind,
        payload: {
          expected_pull_request_revision: expectedPullRequestRevision,
          pull_request_id: grant.pullRequestId,
          title: pullRequestTitle(title),
        },
      };
    }
    if (
      title !== null ||
      grant.expectedHeadRevision === null ||
      grant.readiness !== 'ready'
    ) {
      throw new WorkspaceV2GatewayError('review_pull_request_capability_stale');
    }
    return {
      kind,
      payload: {
        expected_head_revision: grant.expectedHeadRevision,
        expected_pull_request_revision: expectedPullRequestRevision,
        pull_request_id: grant.pullRequestId,
      },
    };
  }

  function fencePullRequestAction(
    workspace: ReviewWorkspaceIdentity,
    expectedRevision: bigint,
    authority: ReviewAuthority,
    action: MobilePullRequestReviewAction,
    idempotencyKey: string,
    snapshot: ReviewSnapshot,
  ): void {
    validateReviewActionAgainstSnapshot(
      {
        schema: 'automonique.platform/review/v1',
        platform_version: 2n,
        actor: authorization.actor_id,
        authentication: 'user_session',
        authority,
        workspace,
        expected_revision: WorkContextRevision(expectedRevision),
        idempotency_key: IdempotencyKey(idempotencyKey),
        action,
      },
      snapshot,
    );
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
    reviewEffectKinds,
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

    async loadAttentionSourceSnapshot(
      projectValue,
      userWorkspaceValue,
      source,
      signal,
    ) {
      requireAction('get_attention_source_snapshot');
      const project = ProjectId(projectValue);
      requireProject(project);
      // The workspace must already be in this project's admitted snapshot, so
      // an attention read can never be the thing that discovers a workspace.
      snapshotRecord(
        projectSnapshots,
        project,
        'user_workspace',
        userWorkspaceValue,
      );
      const userWorkspace = UserWorkspaceId(userWorkspaceValue);
      const response = await guarded(signal, (combined) =>
        options.client.getAttentionSourceSnapshot(
          source,
          project,
          userWorkspace,
          combined,
        ),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      const snapshot = response.snapshot;
      if (
        snapshot.source.kind !== source.kind ||
        snapshot.source.id !== source.id ||
        snapshot.project !== project ||
        snapshot.user_workspace !== userWorkspace
      ) {
        throw new WorkspaceV2GatewayError('attention_snapshot_mismatch');
      }
      return deepFreeze(snapshot);
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
      const unavailableCategory = unavailableReviewEffectCategory(action.kind);
      if (unavailableCategory !== null) {
        throw new WorkspaceV2GatewayError(unavailableCategory);
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
        !MOBILE_DIRECT_REVIEW_EFFECT_KINDS.includes(
          action.kind as (typeof MOBILE_DIRECT_REVIEW_EFFECT_KINDS)[number],
        )
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
      return submitReviewEffect({
        project,
        workspace,
        expectedRevision,
        authority,
        action,
        idempotencyKey: idempotencyKeyValue,
        confirmedRecovery: null,
        signal,
        send: (idempotencyKey, combined) =>
          options.client.executeReviewAction(
            workspace,
            WorkContextRevision(expectedRevision),
            action,
            idempotencyKey,
            combined,
          ),
      });
    },

    async previewCheckRerun(
      projectValue,
      workspace,
      expectedWorkspaceRevision,
      expectedRevision,
      checkId,
      expectedCheckRevision,
      signal,
    ) {
      requireDelegatedAction('get_review_capabilities');
      requireDelegatedAction('rerun_check');
      requireDelegatedAction('get_review_receipt');
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const project = ProjectId(projectValue);
      requireProject(project);
      requireReviewWorkspaceInSnapshot(projectSnapshots, project, workspace);
      if (
        !('id' in workspace) ||
        snapshotRecord(projectSnapshots, project, workspace.kind, workspace.id)
          .revision !== WorkContextRevision(expectedWorkspaceRevision)
      ) {
        throw new WorkspaceV2GatewayError('workspace_target_revision_stale');
      }
      const snapshot = reviewSnapshots.get(
        reviewSnapshotKey(project, workspace),
      );
      const check = snapshot?.checks.find(
        (candidate) => candidate.id === checkId,
      );
      if (
        snapshot === undefined ||
        snapshot.revision !== WorkContextRevision(expectedRevision) ||
        check === undefined ||
        check.freshness.state !== 'fresh' ||
        check.freshness.observed_revision !==
          WorkContextRevision(expectedCheckRevision)
      ) {
        throw new WorkspaceV2GatewayError('review_target_revision_stale');
      }
      const response = await guarded(signal, (combined) =>
        options.client.getReviewCapabilities(project, workspace, combined),
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      const capabilities: ReviewCapabilities = response.capabilities;
      const candidates = capabilities.rerunnable_checks.filter(
        (candidate) =>
          candidate.check_id === checkId &&
          candidate.expected_check_revision ===
            WorkContextRevision(expectedCheckRevision) &&
          sameReviewAuthority(candidate.authority, check.authority),
      );
      if (
        capabilities.project !== project ||
        !sameWorkContextIdentity(capabilities.workspace, workspace) ||
        capabilities.snapshot_revision !==
          WorkContextRevision(expectedRevision) ||
        capabilities.workspace_revision !==
          WorkContextRevision(expectedWorkspaceRevision) ||
        candidates.length !== 1
      ) {
        throw new WorkspaceV2GatewayError('review_rerun_capability_stale');
      }
      const capability = candidates[0]!;
      const action = {
        kind: 'rerun_check' as const,
        payload: {
          check_id: checkId,
          expected_check_revision: WorkContextRevision(expectedCheckRevision),
        },
      };
      validateReviewActionAgainstSnapshot(
        {
          schema: 'automonique.platform/review/v1',
          platform_version: 2n,
          actor: authorization.actor_id,
          authentication: 'user_session',
          authority: capability.authority,
          workspace,
          expected_revision: WorkContextRevision(expectedRevision),
          idempotency_key: IdempotencyKey('mobile-rerun-preview'),
          action,
        },
        snapshot,
      );
      const prepared = deepFreeze({
        project,
        workspace,
        workspaceRevision: expectedWorkspaceRevision,
        snapshotRevision: expectedRevision,
        authority: capability.authority,
        action,
        confirmationDigest: capability.confirmation_digest,
        receiptCorrelationDigest: capability.receipt_correlation_digest,
      });
      pendingCheckReruns.add(prepared);
      return prepared;
    },

    async confirmCheckRerun(prepared, idempotencyKeyValue, signal) {
      if (!pendingCheckReruns.delete(prepared)) {
        throw new WorkspaceV2GatewayError(
          'review_confirmation_missing_or_replayed',
        );
      }
      requireDelegatedAction('rerun_check');
      requireDelegatedAction('get_review_receipt');
      requireProject(prepared.project);
      requireReviewWorkspaceInSnapshot(
        projectSnapshots,
        prepared.project,
        prepared.workspace,
      );
      if (
        !('id' in prepared.workspace) ||
        snapshotRecord(
          projectSnapshots,
          prepared.project,
          prepared.workspace.kind,
          prepared.workspace.id,
        ).revision !== WorkContextRevision(prepared.workspaceRevision)
      ) {
        throw new WorkspaceV2GatewayError('workspace_target_revision_stale');
      }
      const snapshot = reviewSnapshots.get(
        reviewSnapshotKey(prepared.project, prepared.workspace),
      );
      const check = snapshot?.checks.find(
        (candidate) => candidate.id === prepared.action.payload.check_id,
      );
      if (
        snapshot === undefined ||
        snapshot.revision !== WorkContextRevision(prepared.snapshotRevision) ||
        check === undefined ||
        check.freshness.state !== 'fresh' ||
        check.freshness.observed_revision !==
          prepared.action.payload.expected_check_revision ||
        !sameReviewAuthority(check.authority, prepared.authority)
      ) {
        throw new WorkspaceV2GatewayError('review_target_revision_stale');
      }
      return submitReviewEffect({
        project: prepared.project,
        workspace: prepared.workspace,
        expectedRevision: prepared.snapshotRevision,
        authority: prepared.authority,
        action: prepared.action,
        idempotencyKey: idempotencyKeyValue,
        confirmedRecovery: {
          confirmationDigest: prepared.confirmationDigest,
          expectedWorkspaceRevision: prepared.workspaceRevision,
          receiptCorrelationDigest: prepared.receiptCorrelationDigest,
        },
        signal,
        send: (idempotencyKey, combined) =>
          options.client.executeConfirmedReviewAction(
            prepared.workspace,
            WorkContextRevision(prepared.snapshotRevision),
            prepared.action,
            idempotencyKey,
            prepared.confirmationDigest,
            WorkContextRevision(prepared.workspaceRevision),
            prepared.receiptCorrelationDigest,
            combined,
          ),
      });
    },

    async loadReviewPullRequestGrants(
      projectValue,
      workspace,
      expectedWorkspaceRevision,
      expectedRevision,
      signal,
    ) {
      const project = ProjectId(projectValue);
      const offered = MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS.filter((kind) =>
        reviewEffectKinds.includes(kind),
      );
      const snapshot = requirePullRequestTarget(
        project,
        workspace,
        expectedWorkspaceRevision,
        expectedRevision,
      );
      const base = {
        project,
        workspace,
        workspaceRevision: expectedWorkspaceRevision,
        snapshotRevision: expectedRevision,
      };
      // No delegated pull-request grant means no reason to ask the server what
      // it would have allowed. Nothing is claimed and nothing is read.
      if (offered.length === 0) {
        return deepFreeze({
          ...base,
          open_pull_request: null,
          update_pull_request: null,
          merge_pull_request: null,
        });
      }
      requireDelegatedAction('get_review_capabilities');
      const capabilities = await readReviewCapabilities(
        project,
        workspace,
        expectedWorkspaceRevision,
        expectedRevision,
        signal,
      );
      return deepFreeze({
        ...base,
        open_pull_request: pullRequestGrant(
          'open_pull_request',
          capabilities,
          snapshot,
        ),
        update_pull_request: pullRequestGrant(
          'update_pull_request',
          capabilities,
          snapshot,
        ),
        merge_pull_request: pullRequestGrant(
          'merge_pull_request',
          capabilities,
          snapshot,
        ),
      });
    },

    async previewPullRequestAction(
      projectValue,
      workspace,
      expectedWorkspaceRevision,
      expectedRevision,
      kind,
      title,
      signal,
    ) {
      for (const grant of MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS[kind]) {
        requireDelegatedAction(grant);
      }
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const project = ProjectId(projectValue);
      const snapshot = requirePullRequestTarget(
        project,
        workspace,
        expectedWorkspaceRevision,
        expectedRevision,
      );
      const capabilities = await readReviewCapabilities(
        project,
        workspace,
        expectedWorkspaceRevision,
        expectedRevision,
        signal,
      );
      const grant = pullRequestGrant(kind, capabilities, snapshot);
      const slot = capabilities[kind];
      if (grant === null || slot === null) {
        throw new WorkspaceV2GatewayError(
          'review_pull_request_capability_withheld',
        );
      }
      const action = pullRequestAction(kind, grant, title);
      fencePullRequestAction(
        workspace,
        expectedRevision,
        grant.authority,
        action,
        'mobile-pull-request-preview',
        snapshot,
      );
      const prepared = deepFreeze({
        project,
        workspace,
        workspaceRevision: expectedWorkspaceRevision,
        snapshotRevision: expectedRevision,
        authority: grant.authority,
        action,
        // Verbatim server material. Nothing here is derived on the client.
        confirmationDigest: slot.confirmation_digest,
        receiptCorrelationDigest: slot.receipt_correlation_digest,
        pullRequestId: grant.pullRequestId,
        expectedHeadRevision: grant.expectedHeadRevision,
        readiness: grant.readiness,
      });
      pendingPullRequestActions.add(prepared);
      return prepared;
    },

    async confirmPullRequestAction(prepared, idempotencyKeyValue, signal) {
      if (!pendingPullRequestActions.delete(prepared)) {
        throw new WorkspaceV2GatewayError(
          'review_confirmation_missing_or_replayed',
        );
      }
      for (const grant of MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS[
        prepared.action.kind
      ]) {
        requireDelegatedAction(grant);
      }
      const snapshot = requirePullRequestTarget(
        prepared.project,
        prepared.workspace,
        prepared.workspaceRevision,
        prepared.snapshotRevision,
      );
      // Re-fence at confirmation. The preview is inert; this is the first and
      // only point at which the exact target is allowed to still be current.
      fencePullRequestAction(
        prepared.workspace,
        prepared.snapshotRevision,
        prepared.authority,
        prepared.action,
        idempotencyKeyValue,
        snapshot,
      );
      return submitReviewEffect({
        project: prepared.project,
        workspace: prepared.workspace,
        expectedRevision: prepared.snapshotRevision,
        authority: prepared.authority,
        action: prepared.action,
        idempotencyKey: idempotencyKeyValue,
        confirmedRecovery: {
          confirmationDigest: prepared.confirmationDigest,
          expectedWorkspaceRevision: prepared.workspaceRevision,
          receiptCorrelationDigest: prepared.receiptCorrelationDigest,
        },
        signal,
        send: (idempotencyKey, combined) =>
          options.client.executeConfirmedReviewAction(
            prepared.workspace,
            WorkContextRevision(prepared.snapshotRevision),
            prepared.action,
            idempotencyKey,
            prepared.confirmationDigest,
            WorkContextRevision(prepared.workspaceRevision),
            prepared.receiptCorrelationDigest,
            combined,
          ),
      });
    },

    async pendingReviewReceipts() {
      requireDelegatedAction('get_review_receipt');
      if (reviewReceiptStore === undefined) {
        throw new WorkspaceV2GatewayError('review_effect_unavailable');
      }
      const handles = await guardedReceiptOperation(() =>
        reviewReceiptStore.list(),
      );
      return handles
        .map(admitReviewV2ReceiptHandle)
        .filter((handle) =>
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
      const storedHandle = handles.find(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (storedHandle === undefined) {
        throw new WorkspaceV2GatewayError('review_receipt_handle_missing');
      }
      const handle = admitReviewV2ReceiptHandle(storedHandle);
      const project = ProjectId(handle.project);
      requireProject(project);
      const workspace: ReviewWorkspaceIdentity = {
        kind: handle.workspace_kind,
        id: handle.workspace_id,
      } as ReviewWorkspaceIdentity;
      const response = await guarded(signal, (combined) => {
        // Every confirmed-lane write recovers through its own correlation
        // proof. Falling back to the generic lookup could attribute someone
        // else's provider attempt to this handle, so it is never attempted.
        if (isConfirmedReviewEffectKind(handle.action_kind)) {
          if (
            handle.expected_workspace_revision === null ||
            handle.receipt_correlation_digest === null
          ) {
            throw new WorkspaceV2GatewayError('review_receipt_handle_invalid');
          }
          return options.client.getCorrelatedReviewReceipt(
            project,
            workspace,
            idempotencyKey,
            ReviewReceiptCorrelationDigest(handle.receipt_correlation_digest),
            combined,
          );
        }
        return options.client.getReviewReceipt(
          project,
          workspace,
          idempotencyKey,
          combined,
        );
      });
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
