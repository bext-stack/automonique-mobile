// SPDX-License-Identifier: Elastic-2.0

import type { SessionSummary } from './types';
import {
  projectAuthoritativeAttentionNodes,
  type AuthoritativeAttentionNode,
} from './attention-source-projection';
import {
  admitWorkspaceDeepLink,
  type AdmittedWorkspaceRoute,
  type ServerIdentity,
  type WorkspaceCompanionCatalog,
} from './workspace-companion';
import type { WorkspaceCatalogDetail } from './workspace-v2-catalog';
import {
  admitReviewDeepLink,
  reviewAttentionAnchor,
  workspaceForDetail,
  type AdmittedReviewRoute,
} from './review-attention';

/**
 * Navigation for a row that came from the authoritative attention board.
 *
 * The row is a coordinate, not a capability. Opening it re-resolves the current
 * catalog, credential generation, and retained-session projection, and every
 * check is against the exact revision the row was observed at. A row whose
 * source moved, whose workspace went stale, or whose provider session is no
 * longer the one the server bound stays non-navigable rather than opening
 * something plausible.
 */

export type AdmittedAuthoritativeAttentionRoute =
  AdmittedReviewRoute | AdmittedWorkspaceRoute;

/**
 * The content-free coordinate a notification carries. It names the exact
 * source and the exact item revision the alert was raised at, and nothing
 * about what the item says.
 */
export interface AttentionSourceDeepLinkRequest {
  readonly serverIdentity: ServerIdentity;
  readonly authorizationRevision: string;
  readonly principalGeneration: string;
  readonly workspaceId: string;
  readonly workspaceRevision: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly itemId: string;
  readonly itemRevision: string;
}

export class AuthoritativeAttentionNavigationError extends Error {
  constructor(readonly category: string) {
    super(category);
    this.name = 'AuthoritativeAttentionNavigationError';
  }
}

function refuse(): never {
  throw new AuthoritativeAttentionNavigationError(
    'attention_navigation_not_authorized',
  );
}

export function admitAuthoritativeAttentionDeepLink(options: {
  readonly catalog: WorkspaceCompanionCatalog;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly detail: WorkspaceCatalogDetail;
  readonly node: AuthoritativeAttentionNode;
  readonly retainedSessions: readonly SessionSummary[];
}): AdmittedAuthoritativeAttentionRoute {
  const { catalog, detail, details, node, retainedSessions } = options;
  const workspace = workspaceForDetail(catalog, detail);
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === detail.serverIdentity,
  );
  if (workspace === null || server === undefined) refuse();
  if (
    catalog.phase !== 'live' ||
    catalog.selectedServerIdentity !== detail.serverIdentity ||
    server.authorization !== 'active' ||
    server.staleProjectIds.includes(workspace.projectId)
  ) {
    refuse();
  }
  // The board is keyed by workspace; a row from another workspace's board
  // cannot borrow this one's navigation.
  if (
    detail.attention == null ||
    detail.attention.target.userWorkspace !== workspace.id
  ) {
    refuse();
  }

  if (node.source.kind === 'review') {
    // The review source is named by the workspace it reviews, and the anchor
    // comes from the review snapshot rather than from the attention row.
    if (node.source.id !== workspace.id || detail.review === null) refuse();
    return admitReviewDeepLink(catalog, details, {
      authorizationRevision: server.authorizationRevision,
      principalGeneration: server.principalGeneration,
      reviewRevision: detail.review.revision,
      serverIdentity: detail.serverIdentity,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      ...reviewAttentionAnchor(detail.review.snapshot),
    });
  }

  if (node.source.kind === 'orchestration') {
    // Orchestration attention belongs to the workspace itself. It opens the
    // review surface only where the catalog already granted one.
    if (node.source.id !== workspace.id || detail.review === null) refuse();
    return admitReviewDeepLink(catalog, details, {
      authorizationRevision: server.authorizationRevision,
      fileId: null,
      hunkId: null,
      checkId: null,
      principalGeneration: server.principalGeneration,
      reviewRevision: detail.review.revision,
      serverIdentity: detail.serverIdentity,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
    });
  }

  // A provider row opens exactly the session the server bound it to, and only
  // while that binding is still the current retained one.
  const platformSession = node.platformSession;
  if (platformSession === null) refuse();
  const binding = detail.sessionBindings.find(
    (candidate) => candidate.workSessionId === node.source.id,
  );
  if (binding === undefined) refuse();
  const session = workspace.sessions.find(
    (candidate) =>
      candidate.id === binding.workSessionId &&
      candidate.target.id === binding.retainedSessionId &&
      candidate.target.authority === platformSession.authority &&
      candidate.target.kind === platformSession.kind &&
      candidate.target.id === platformSession.id,
  );
  if (session === undefined) refuse();
  const retained = retainedSessions.find(
    (candidate) =>
      candidate.target.coordinate.authority === session.target.authority &&
      candidate.target.coordinate.kind === session.target.kind &&
      candidate.target.coordinate.id === session.target.id,
  );
  if (retained === undefined) refuse();
  return admitWorkspaceDeepLink(catalog, {
    authorizationRevision: server.authorizationRevision,
    destination: 'chat',
    principalGeneration: server.principalGeneration,
    retainedTarget: retained.target,
    serverIdentity: detail.serverIdentity,
    sessionRelationRevision: session.revision,
    tenantId: server.tenantId,
    workSessionId: session.id,
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
  });
}

/**
 * Re-resolve a notification coordinate against the board this client holds
 * now. The alert supplies no route: the source must still be inventoried and
 * available, and the item must still be published at exactly the revision the
 * alert named. A newer revision means the alert described a state that has
 * already moved, so it opens nothing rather than something adjacent.
 */
export function admitAttentionSourceNotificationDeepLink(options: {
  readonly catalog: WorkspaceCompanionCatalog;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly request: AttentionSourceDeepLinkRequest;
  readonly retainedSessions: readonly SessionSummary[];
}): AdmittedAuthoritativeAttentionRoute {
  const { catalog, details, request, retainedSessions } = options;
  const server = catalog.servers.find(
    (candidate) => candidate.serverIdentity === request.serverIdentity,
  );
  if (
    server === undefined ||
    server.authorizationRevision !== request.authorizationRevision ||
    server.principalGeneration !== request.principalGeneration
  ) {
    refuse();
  }
  const detail = details.find(
    (candidate) =>
      candidate.serverIdentity === request.serverIdentity &&
      candidate.workspaceId === request.workspaceId,
  );
  if (
    detail === undefined ||
    detail.workspaceRevision !== request.workspaceRevision ||
    detail.attention == null
  ) {
    refuse();
  }
  const node = projectAuthoritativeAttentionNodes(detail.attention).find(
    (candidate) =>
      candidate.source.kind === request.sourceKind &&
      candidate.source.id === request.sourceId &&
      candidate.itemId === request.itemId,
  );
  if (node === undefined || node.revision !== request.itemRevision) refuse();
  return admitAuthoritativeAttentionDeepLink({
    catalog,
    detail,
    details,
    node,
    retainedSessions,
  });
}
