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
  decodeWorkContextMutationApproval,
  type LineageProjection,
  type MutationApproval,
  type MutationPreview,
  type MutationReceipt,
  type PlatformNegotiationResponse,
  type PlatformV2Refusal,
  type ProjectId as ProjectIdValue,
  type ReviewSnapshot,
  type ReviewWorkspaceIdentity,
  type UserWorkspaceId as UserWorkspaceIdValue,
  type WorkContextMutationIntent,
  type WorkContextRecord,
  type WorkspaceIntent,
  type WorkspaceIntentOutcome,
} from '@automonique/sdk';

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
      /**
       * The v2 transport intentionally retains raw receipt custody. A fresh
       * project read, not a locally invented success state, proves the result.
       */
      readonly projectionRefreshRequired: true;
    };

export interface WorkspaceV2Gateway {
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
  submitWorkspaceIntent(
    project: string,
    intent: WorkspaceIntent,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentOutcome>;
  getWorkspaceIntent(
    project: string,
    intentId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentOutcome>;
  cancelWorkspaceIntent(
    project: string,
    workspace: string,
    expectedRevision: bigint,
    intentId: string,
    targetIntentId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntentOutcome>;
}

export class WorkspaceV2GatewayError extends Error {
  constructor(readonly category: string) {
    super(category);
    this.name = 'WorkspaceV2GatewayError';
  }
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
  readonly now?: () => number;
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

export function createWorkspaceV2Gateway(
  options: WorkspaceV2GatewayOptions,
): WorkspaceV2Gateway {
  const now = options.now ?? Date.now;
  const pendingPreviews = new WeakSet<PreparedWorkspaceMutation>();

  return {
    async negotiate(signal) {
      requireNegotiatedV2(
        await options.client.negotiate(
          {
            schema: PLATFORM_NEGOTIATION_SCHEMA_V1,
            versions: [PlatformVersionNumber(1n), PlatformVersionNumber(2n)],
          },
          signal,
        ),
      );
    },

    async loadProject(projectValue, signal) {
      const project = ProjectId(projectValue);
      const records: WorkContextRecord[] = [];
      const identities = new Set<string>();
      const cursors = new Set<string>();
      let after: Parameters<PlatformV2Client['queryWorkContexts']>[0]['after'] =
        null;
      for (let pageIndex = 0; pageIndex < MAX_PROJECT_PAGES; pageIndex += 1) {
        const response = await options.client.queryWorkContexts(
          {
            after,
            kinds: ALL_WORK_CONTEXT_KINDS,
            lifecycles: [],
            limit: WorkContextPageLimit(PROJECT_PAGE_LIMIT),
            parent: null,
            project,
            schema: PLATFORM_SCHEMA_V2,
          },
          signal,
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
          return records;
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
      const response = await options.client.getLineage(
        ProjectId(projectValue),
        UserWorkspaceId(workspaceValue),
        signal,
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return response.lineage;
    },

    async loadReview(projectValue, workspace, signal) {
      const response = await options.client.getReview(
        ProjectId(projectValue),
        workspace,
        signal,
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return response.review;
    },

    async prepareMutation(projectValue, intent, keyValue, signal) {
      const project = ProjectId(projectValue);
      requireMutationIntentProject(project, intent);
      const response = await options.client.prepareMutation(
        IdempotencyKey(keyValue),
        intent,
        signal,
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
      const prepared: PreparedWorkspaceMutation = {
        project,
        preview: response.preview,
        previewDigest: mutationPreviewDigest(response.preview),
      };
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
        const response = await options.client.decideMutation(
          prepared.preview.preview,
          prepared.previewDigest,
          decision === 'grant' ? 'granted' : 'denied',
          signal,
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
        if (decision === 'deny') return { kind: 'denied', approval };
      }
      requireLivePreview(prepared.preview, now());
      const submitted = await options.client.submitMutation(
        prepared.preview.preview,
        prepared.previewDigest,
        approval?.id ?? null,
        signal,
      );
      if (
        submitted.kind === 'platform_v2_refused' ||
        submitted.kind === 'mutation_refused'
      ) {
        refusal(submitted.refusal);
      }
      return {
        kind: 'submitted',
        idempotencyKey: prepared.preview.proposal.idempotency_key,
        projectionRefreshRequired: true,
      };
    },

    async submitWorkspaceIntent(projectValue, intent, signal) {
      const response = await options.client.submitWorkspaceIntent(
        ProjectId(projectValue),
        intent,
        signal,
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return response.result;
    },

    async getWorkspaceIntent(projectValue, intentIdValue, signal) {
      const response = await options.client.getWorkspaceIntent(
        ProjectId(projectValue),
        WorkspaceIntentId(intentIdValue),
        signal,
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return response.result;
    },

    async cancelWorkspaceIntent(
      projectValue,
      workspaceValue,
      expectedRevision,
      intentIdValue,
      targetIntentIdValue,
      signal,
    ) {
      const project = ProjectId(projectValue);
      const workspace = UserWorkspaceId(workspaceValue);
      const intentId = WorkspaceIntentId(intentIdValue);
      const targetIntentId = WorkspaceIntentId(targetIntentIdValue);
      if (intentId === targetIntentId) {
        throw new WorkspaceV2GatewayError('workspace_cancel_target_invalid');
      }
      const response = await options.client.submitWorkspaceIntent(
        project,
        {
          kind: 'cancel',
          request: {
            expected_revision: WorkContextRevision(expectedRevision),
            intent_id: intentId,
            target_intent_id: targetIntentId,
            workspace,
          },
        },
        signal,
      );
      if (response.kind === 'platform_v2_refused') refusal(response.refusal);
      return response.result;
    },
  };
}

export interface AuthorizedWorkspaceV2GatewayOptions {
  readonly endpoint: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly token: () => string | Promise<string>;
}

/** Production constructor. The bearer and raw transport stay behind the SDK. */
export function createAuthorizedWorkspaceV2Gateway(
  options: AuthorizedWorkspaceV2GatewayOptions,
): WorkspaceV2Gateway {
  return createWorkspaceV2Gateway({
    client: new PlatformV2Client(
      new HttpsPlatformV2Transport(
        options.endpoint,
        options.token,
        options.fetcher,
      ),
    ),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

// Keep these protocol types reachable only from this modular review/lifecycle
// boundary. Issue #35 can build UI policy without widening the production
// transport or exposing generic execute.
export type { MutationReceipt };
