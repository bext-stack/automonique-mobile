// SPDX-License-Identifier: Elastic-2.0

import type {
  LineageProjection,
  ReviewAction,
  ReviewAuthority,
  ReviewSnapshot,
} from '@automonique/sdk';

import type {
  AdmittedWorkspaceRoute,
  CompanionWorkspace,
  ServerIdentity,
  WorkspaceCompanionCatalog,
} from './workspace-companion';
import { admitWorkspaceDeepLink } from './workspace-companion';
import type { SessionSummary } from './types';
import type { WorkspaceCatalogDetail } from './workspace-v2-catalog';
import { projectReviewRenderSemantics } from './review-render-semantics';

export const MAX_MOBILE_REVIEW_FILES = 128;
export const MAX_MOBILE_REVIEW_HUNKS = 512;
export const MAX_MOBILE_REVIEW_COMMENTS = 256;
export const MAX_MOBILE_REVIEW_CHECKS = 128;
export const MAX_MOBILE_ATTENTION_NODES = 256;

export type MobileAttentionState =
  'idle' | 'needs_you' | 'working' | 'blocked' | 'done';

export interface MobileAttentionNode {
  readonly key: string;
  readonly kind: string;
  readonly label: string;
  readonly semanticKey: string;
  readonly state: MobileAttentionState;
  readonly depth: number;
  readonly parentKey: string | null;
  readonly parentLabel: string | null;
  readonly origin: {
    readonly workspaceId: string;
    readonly attemptId: string | null;
    readonly sessionId: string | null;
    readonly paneId: string | null;
  } | null;
  readonly revision: string | null;
  readonly unread: number;
}

export interface ReviewDeepLinkRequest {
  readonly serverIdentity: ServerIdentity;
  readonly workspaceId: string;
  readonly workspaceRevision: string;
  readonly reviewRevision: string;
  readonly fileId: string | null;
  readonly hunkId: string | null;
}

export interface AdmittedReviewRoute {
  readonly pathname: '/workspace/[server]/[workspace]';
  readonly params: Readonly<Record<string, string>>;
}

export interface ReviewActionAvailability {
  readonly enabled: boolean;
  readonly reason:
    | 'available'
    | 'cached_or_offline'
    | 'stale_project'
    | 'review_not_current'
    | 'action_not_delegated'
    | 'effect_unavailable'
    | 'authority_stale'
    | 'target_already_settled';
}

export interface ReviewAttentionAnchor {
  readonly fileId: string | null;
  readonly hunkId: string | null;
}

function identityKey(value: {
  readonly kind: string;
  readonly id: string;
}): string {
  return `${value.kind}\u0000${value.id}`;
}

function statusOf(
  record: LineageProjection['orchestration'][number],
): MobileAttentionState {
  switch (record.status.kind) {
    case 'working':
      return 'working';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'waiting':
      return record.identity.kind === 'question' ||
        record.identity.kind === 'decision_gate'
        ? 'needs_you'
        : 'blocked';
  }
}

function orchestrationLabel(
  record: LineageProjection['orchestration'][number],
): string {
  return (
    record.latest_useful_message?.text ??
    `${record.identity.kind.replaceAll('_', ' ')} ${record.identity.id}`
  );
}

/**
 * Retains the server's typed parent graph. Labels are display-only and never
 * parsed back into identity, authority, or navigation coordinates.
 */
export function projectAttentionNodes(
  review: ReviewSnapshot | null,
  lineage: LineageProjection | null,
): readonly MobileAttentionNode[] {
  const semantics =
    review === null ? null : projectReviewRenderSemantics(review);
  const result: MobileAttentionNode[] = [];
  if (review !== null && semantics !== null) {
    result.push({
      key: 'review',
      kind: 'review',
      label:
        review.attention.reason === null
          ? 'Review attention'
          : review.attention.reason.replaceAll('_', ' '),
      semanticKey: semantics.attention.semantic_key,
      state: review.attention.state,
      depth: 0,
      parentKey: null,
      parentLabel: null,
      origin: null,
      revision: semantics.attention.source_revision?.toString() ?? null,
      unread: Number(review.attention.unread),
    });
  }
  if (lineage === null) return result;
  const records = new Map(
    lineage.orchestration.map((record) => [
      identityKey(record.identity),
      record,
    ]),
  );
  const depthOf = (
    record: LineageProjection['orchestration'][number],
  ): number => {
    let depth = 0;
    let cursor = record.parent;
    const seen = new Set<string>();
    while (cursor !== null && depth < 8) {
      const key = identityKey(cursor);
      if (seen.has(key)) break;
      seen.add(key);
      const parent = records.get(key);
      if (parent === undefined) break;
      depth += 1;
      cursor = parent.parent;
    }
    return depth;
  };
  for (const record of lineage.orchestration.slice(
    0,
    MAX_MOBILE_ATTENTION_NODES - result.length,
  )) {
    const parentRecord =
      record.parent === null
        ? undefined
        : records.get(identityKey(record.parent));
    result.push({
      key: identityKey(record.identity),
      kind: record.identity.kind,
      label: orchestrationLabel(record),
      semanticKey: `orchestration.${record.status.kind}`,
      state: statusOf(record),
      depth: depthOf(record),
      parentKey: record.parent === null ? null : identityKey(record.parent),
      parentLabel:
        record.parent === null
          ? null
          : parentRecord === undefined
            ? `${record.parent.kind.replaceAll('_', ' ')} ${record.parent.id}`
            : orchestrationLabel(parentRecord),
      origin: {
        workspaceId: record.origin.workspace,
        attemptId: record.origin.attempt,
        sessionId: record.origin.session,
        paneId: record.origin.pane,
      },
      revision: record.revision.toString(),
      unread: 0,
    });
  }
  return result;
}

export type AdmittedAttentionRoute =
  AdmittedReviewRoute | AdmittedWorkspaceRoute;

/**
 * Admit a review anchor or a lineage session only from exact typed bindings.
 * A nested record without a retained live session stays non-navigable.
 */
export function admitAttentionDeepLink(options: {
  readonly catalog: WorkspaceCompanionCatalog;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly detail: WorkspaceCatalogDetail;
  readonly node: MobileAttentionNode;
  readonly retainedSessions: readonly SessionSummary[];
}): AdmittedAttentionRoute {
  const { catalog, detail, details, node, retainedSessions } = options;
  const workspace = workspaceForDetail(catalog, detail);
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === detail.serverIdentity,
  );
  if (workspace === null) {
    throw new Error('attention_navigation_not_authorized');
  }
  if (node.key === 'review') {
    if (detail.review === null) {
      throw new Error('attention_navigation_not_authorized');
    }
    return admitReviewDeepLink(catalog, details, {
      serverIdentity: detail.serverIdentity,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      reviewRevision: detail.review.revision,
      ...reviewAttentionAnchor(detail.review.snapshot),
    });
  }

  const record = detail.lineage?.orchestration.find(
    (candidate) => identityKey(candidate.identity) === node.key,
  );
  if (
    catalog.phase !== 'live' ||
    catalog.selectedServerIdentity !== detail.serverIdentity ||
    server?.authorization !== 'active' ||
    server.staleProjectIds.includes(workspace.projectId) ||
    record === undefined ||
    record.revision.toString() !== node.revision ||
    record.origin.workspace !== workspace.id ||
    record.origin.attempt === null ||
    record.origin.session === null
  ) {
    throw new Error('attention_navigation_not_authorized');
  }
  const binding = detail.sessionBindings.find(
    (candidate) =>
      candidate.workSessionId === record.origin.session &&
      candidate.attemptWorkspaceId === record.origin.attempt,
  );
  if (binding === undefined) {
    throw new Error('attention_navigation_not_authorized');
  }
  const session = workspace.sessions.find(
    (candidate) =>
      candidate.id === binding.workSessionId &&
      candidate.target.id === binding.retainedSessionId,
  );
  const retained = retainedSessions.find(
    (candidate) =>
      candidate.target.coordinate.authority === session?.target.authority &&
      candidate.target.coordinate.kind === session?.target.kind &&
      candidate.target.coordinate.id === session?.target.id,
  );
  if (session === undefined || retained === undefined) {
    throw new Error('attention_navigation_not_authorized');
  }
  const route = admitWorkspaceDeepLink(catalog, {
    serverIdentity: detail.serverIdentity,
    tenantId: server.tenantId,
    authorizationRevision: server.authorizationRevision,
    principalGeneration: server.principalGeneration,
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    destination: 'chat',
    workSessionId: session.id,
    sessionRelationRevision: session.revision,
    retainedTarget: retained.target,
  });
  return route;
}

/** Resolve only an anchor carried by the authoritative selected attention event. */
export function reviewAttentionAnchor(
  review: ReviewSnapshot,
): ReviewAttentionAnchor {
  if (review.attention.reason === null) {
    return { fileId: null, hunkId: null };
  }
  const selected = review.attention_events
    .filter((event) => event.reason === review.attention.reason)
    .sort((left, right) =>
      left.origin.revision === right.origin.revision
        ? left.id.localeCompare(right.id)
        : left.origin.revision > right.origin.revision
          ? -1
          : 1,
    )[0];
  if (selected?.origin.kind === 'comment' && selected.origin.id !== null) {
    const comment = review.comments.find(
      (candidate) => candidate.id === selected.origin.id,
    );
    if (comment !== undefined) {
      return {
        fileId: comment.anchor.file_id,
        hunkId: comment.anchor.hunk_id,
      };
    }
  }
  if (selected?.origin.kind === 'file' && selected.origin.id !== null) {
    return review.files.some((file) => file.id === selected.origin.id)
      ? { fileId: selected.origin.id, hunkId: null }
      : { fileId: null, hunkId: null };
  }
  return { fileId: null, hunkId: null };
}

/** Never render an unsanitized hunk as source text. */
export function safeHunkPreview(
  preview: string,
  sanitized: boolean,
): string | null {
  if (!sanitized) return null;
  return preview
    .replace(/[\p{Cc}\p{Cf}]/gu, (value) =>
      value === '\n' || value === '\t' ? value : '\ufffd',
    )
    .slice(0, 512);
}

function reviewFile(
  detail: WorkspaceCatalogDetail,
  fileId: string,
): NonNullable<WorkspaceCatalogDetail['review']>['files'][number] | null {
  return detail.review?.files.find((file) => file.id === fileId) ?? null;
}

/** Admit only an exact, current, internally-routed review/file/hunk target. */
export function admitReviewDeepLink(
  catalog: WorkspaceCompanionCatalog,
  details: readonly WorkspaceCatalogDetail[],
  request: ReviewDeepLinkRequest,
): AdmittedReviewRoute {
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === request.serverIdentity,
  );
  const workspace = server?.workspaces.find(
    (candidate) => candidate.id === request.workspaceId,
  );
  const detail = details.find(
    (candidate) =>
      candidate.serverIdentity === request.serverIdentity &&
      candidate.workspaceId === request.workspaceId,
  );
  if (
    catalog.phase !== 'live' ||
    server?.authorization !== 'active' ||
    workspace === undefined ||
    workspace.revision !== request.workspaceRevision ||
    !workspace.navigation.some(
      (grant) =>
        grant.destination === 'review' && grant.revision === workspace.revision,
    ) ||
    server.staleProjectIds.includes(workspace.projectId) ||
    detail?.workspaceRevision !== request.workspaceRevision ||
    detail.review?.revision !== request.reviewRevision
  ) {
    throw new Error('review_navigation_not_authorized');
  }
  const params: Record<string, string> = {
    server: request.serverIdentity,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: 'review',
    review_revision: request.reviewRevision,
  };
  if (request.fileId === null) {
    if (request.hunkId !== null)
      throw new Error('review_navigation_not_authorized');
  } else {
    const file = reviewFile(detail, request.fileId);
    if (file === null) throw new Error('review_navigation_not_authorized');
    params.file = file.id;
    if (request.hunkId !== null) {
      if (!file.hunks.some((hunk) => hunk.id === request.hunkId)) {
        throw new Error('review_navigation_not_authorized');
      }
      params.hunk = request.hunkId;
    }
  }
  return { pathname: '/workspace/[server]/[workspace]', params };
}

function actionAuthority(
  snapshot: ReviewSnapshot,
  action: ReviewAction,
): ReviewAuthority | null {
  switch (action.kind) {
    case 'add_comment':
    case 'approve_review':
    case 'send_comment_to_agent':
    case 'batch_send_comments_to_agent':
      return snapshot.review.authority;
    default:
      return null;
  }
}

export function reviewActionAvailability(options: {
  readonly action: ReviewAction;
  readonly delegatedActions: readonly string[];
  readonly effectKinds: readonly ReviewAction['kind'][];
  readonly live: boolean;
  readonly projectStale: boolean;
  readonly exactReviewRevision: boolean;
  readonly snapshot: ReviewSnapshot;
}): ReviewActionAvailability {
  if (!options.live) return { enabled: false, reason: 'cached_or_offline' };
  if (options.projectStale) return { enabled: false, reason: 'stale_project' };
  if (!options.exactReviewRevision)
    return { enabled: false, reason: 'review_not_current' };
  if (!options.delegatedActions.includes('execute_review_action')) {
    return { enabled: false, reason: 'action_not_delegated' };
  }
  if (
    !options.effectKinds.includes(options.action.kind) ||
    actionAuthority(options.snapshot, options.action) === null
  ) {
    return { enabled: false, reason: 'effect_unavailable' };
  }
  if (options.snapshot.review.freshness.state !== 'fresh') {
    return { enabled: false, reason: 'authority_stale' };
  }
  if (
    options.action.kind === 'approve_review' &&
    !['pending', 'changes_requested'].includes(options.snapshot.review.decision)
  ) {
    return { enabled: false, reason: 'target_already_settled' };
  }
  if (options.action.kind === 'send_comment_to_agent') {
    const target = options.action.payload;
    const comment = options.snapshot.comments.find(
      (candidate) => candidate.id === target.comment_id,
    );
    if (
      comment === undefined ||
      comment.revision !== target.expected_comment_revision ||
      !['not_sent', 'refused'].includes(comment.agent_state)
    ) {
      return { enabled: false, reason: 'target_already_settled' };
    }
  }
  if (
    options.action.kind === 'batch_send_comments_to_agent' &&
    (options.action.payload.comments.length === 0 ||
      options.action.payload.comments.some((target) => {
        const comment = options.snapshot.comments.find(
          (candidate) => candidate.id === target.comment_id,
        );
        return (
          comment === undefined ||
          comment.revision !== target.expected_comment_revision ||
          !['not_sent', 'refused'].includes(comment.agent_state)
        );
      }))
  ) {
    return { enabled: false, reason: 'target_already_settled' };
  }
  return { enabled: true, reason: 'available' };
}

export function workspaceForDetail(
  catalog: WorkspaceCompanionCatalog,
  detail: WorkspaceCatalogDetail,
): CompanionWorkspace | null {
  return (
    catalog.servers
      .find((server) => server.serverIdentity === detail.serverIdentity)
      ?.workspaces.find(
        (workspace) =>
          workspace.id === detail.workspaceId &&
          workspace.revision === detail.workspaceRevision,
      ) ?? null
  );
}
