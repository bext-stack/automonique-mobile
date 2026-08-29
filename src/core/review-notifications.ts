// SPDX-License-Identifier: Elastic-2.0

import type {
  AdmittedAuthoritativeAttentionRoute,
  AttentionSourceDeepLinkRequest,
} from './attention-source-navigation';
import type {
  AdmittedAttentionRoute,
  ReviewDeepLinkRequest,
  SessionAttentionDeepLinkRequest,
} from './review-attention';
import type { ServerIdentity } from './workspace-companion';

export type NotificationPermission = 'undetermined' | 'denied' | 'granted';

export interface ReviewNotificationCandidate {
  readonly permission: NotificationPermission;
  readonly appState: 'active' | 'background' | 'inactive';
  readonly authorizationActive: boolean;
  readonly projectionLive: boolean;
  readonly attentionState:
    'idle' | 'needs_you' | 'working' | 'blocked' | 'done';
  readonly unread: number;
  readonly target: 'review' | 'session' | 'attention_source';
  readonly route: AdmittedAttentionRoute | AdmittedAuthoritativeAttentionRoute;
}

export interface AdmittedReviewNotification {
  readonly title: 'Automonique needs you';
  readonly body: 'Open Automonique to inspect the current bounded request.';
  readonly route: AdmittedAttentionRoute | AdmittedAuthoritativeAttentionRoute;
}

export type ReviewNotificationData = Readonly<Record<string, unknown>> & {
  readonly kind: 'automonique_review_attention_v3';
  readonly server_identity: string;
  readonly authorization_revision: string;
  readonly principal_generation: string;
  readonly workspace_id: string;
  readonly workspace_revision: string;
  readonly review_revision: string;
  readonly file_id: string | null;
  readonly hunk_id: string | null;
  readonly check_id: string | null;
};

export type SessionAttentionNotificationData = Readonly<
  Record<string, unknown>
> & {
  readonly kind: 'automonique_session_attention_v1';
  readonly server_identity: string;
  readonly authorization_revision: string;
  readonly principal_generation: string;
  readonly workspace_id: string;
  readonly workspace_revision: string;
  readonly node_kind: string;
  readonly node_id: string;
  readonly node_revision: string;
};

export type AttentionSourceNotificationData = Readonly<
  Record<string, unknown>
> & {
  readonly kind: 'automonique_attention_source_v1';
  readonly server_identity: string;
  readonly authorization_revision: string;
  readonly principal_generation: string;
  readonly workspace_id: string;
  readonly workspace_revision: string;
  readonly source_kind: string;
  readonly source_id: string;
  readonly item_id: string;
  readonly item_revision: string;
};

export type AttentionNotificationData =
  | ReviewNotificationData
  | SessionAttentionNotificationData
  | AttentionSourceNotificationData;

export type DecodedAttentionNotification =
  | { readonly target: 'review'; readonly request: ReviewDeepLinkRequest }
  | {
      readonly target: 'session';
      readonly request: SessionAttentionDeepLinkRequest;
    }
  | {
      readonly target: 'attention_source';
      readonly request: AttentionSourceDeepLinkRequest;
    };

function bounded(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 256 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('review_notification_invalid');
  }
  return value;
}

function revision(value: unknown): string {
  const result = bounded(value);
  if (!/^[1-9][0-9]{0,19}$/u.test(result)) {
    throw new Error('review_notification_invalid');
  }
  return result;
}

export function encodeReviewNotificationData(
  request: ReviewDeepLinkRequest,
): ReviewNotificationData {
  return {
    kind: 'automonique_review_attention_v3',
    server_identity: request.serverIdentity,
    authorization_revision: request.authorizationRevision,
    principal_generation: request.principalGeneration,
    workspace_id: request.workspaceId,
    workspace_revision: request.workspaceRevision,
    review_revision: request.reviewRevision,
    file_id: request.fileId,
    hunk_id: request.hunkId,
    check_id: request.checkId ?? null,
  };
}

export function encodeAttentionSourceNotificationData(
  request: AttentionSourceDeepLinkRequest,
): AttentionSourceNotificationData {
  return {
    kind: 'automonique_attention_source_v1',
    server_identity: request.serverIdentity,
    authorization_revision: request.authorizationRevision,
    principal_generation: request.principalGeneration,
    workspace_id: request.workspaceId,
    workspace_revision: request.workspaceRevision,
    source_kind: request.sourceKind,
    source_id: request.sourceId,
    item_id: request.itemId,
    item_revision: request.itemRevision,
  };
}

export function encodeSessionAttentionNotificationData(
  request: SessionAttentionDeepLinkRequest,
): SessionAttentionNotificationData {
  return {
    kind: 'automonique_session_attention_v1',
    server_identity: request.serverIdentity,
    authorization_revision: request.authorizationRevision,
    principal_generation: request.principalGeneration,
    workspace_id: request.workspaceId,
    workspace_revision: request.workspaceRevision,
    node_kind: request.nodeKind,
    node_id: request.nodeId,
    node_revision: request.nodeRevision,
  };
}

function exactFields(
  candidate: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return (
    Object.keys(candidate).length === fields.length &&
    fields.every((field) => Object.hasOwn(candidate, field))
  );
}

function serverIdentity(value: unknown): ServerIdentity {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error('review_notification_invalid');
  }
  return value as ServerIdentity;
}

/** Notification data is inert until it is decoded and re-admitted against live state. */
export function decodeReviewNotificationData(
  value: unknown,
): ReviewDeepLinkRequest {
  const decoded = decodeAttentionNotificationData(value);
  if (decoded.target !== 'review') {
    throw new Error('review_notification_invalid');
  }
  return decoded.request;
}

export function decodeAttentionNotificationData(
  value: unknown,
): DecodedAttentionNotification {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review_notification_invalid');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.kind === 'automonique_attention_source_v1') {
    const fields = [
      'kind',
      'server_identity',
      'authorization_revision',
      'principal_generation',
      'workspace_id',
      'workspace_revision',
      'source_kind',
      'source_id',
      'item_id',
      'item_revision',
    ];
    const sourceKind = bounded(candidate.source_kind);
    if (
      !exactFields(candidate, fields) ||
      !['review', 'orchestration', 'provider_session'].includes(sourceKind)
    ) {
      throw new Error('review_notification_invalid');
    }
    return {
      target: 'attention_source',
      request: {
        serverIdentity: serverIdentity(candidate.server_identity),
        authorizationRevision: revision(candidate.authorization_revision),
        principalGeneration: revision(candidate.principal_generation),
        workspaceId: bounded(candidate.workspace_id),
        workspaceRevision: revision(candidate.workspace_revision),
        sourceKind,
        sourceId: bounded(candidate.source_id),
        itemId: bounded(candidate.item_id),
        itemRevision: revision(candidate.item_revision),
      },
    };
  }
  if (candidate.kind === 'automonique_session_attention_v1') {
    const fields = [
      'kind',
      'server_identity',
      'authorization_revision',
      'principal_generation',
      'workspace_id',
      'workspace_revision',
      'node_kind',
      'node_id',
      'node_revision',
    ];
    if (!exactFields(candidate, fields)) {
      throw new Error('review_notification_invalid');
    }
    return {
      target: 'session',
      request: {
        serverIdentity: serverIdentity(candidate.server_identity),
        authorizationRevision: revision(candidate.authorization_revision),
        principalGeneration: revision(candidate.principal_generation),
        workspaceId: bounded(candidate.workspace_id),
        workspaceRevision: revision(candidate.workspace_revision),
        nodeKind: bounded(candidate.node_kind),
        nodeId: bounded(candidate.node_id),
        nodeRevision: revision(candidate.node_revision),
      },
    };
  }
  const legacy = candidate.kind === 'automonique_review_attention_v2';
  const fields = [
    'kind',
    'server_identity',
    'authorization_revision',
    'principal_generation',
    'workspace_id',
    'workspace_revision',
    'review_revision',
    'file_id',
    'hunk_id',
    ...(legacy ? [] : ['check_id']),
  ];
  if (
    !exactFields(candidate, fields) ||
    (!legacy && candidate.kind !== 'automonique_review_attention_v3') ||
    (candidate.file_id !== null && typeof candidate.file_id !== 'string') ||
    (candidate.hunk_id !== null && typeof candidate.hunk_id !== 'string') ||
    (candidate.file_id === null && candidate.hunk_id !== null) ||
    (!legacy &&
      candidate.check_id !== null &&
      typeof candidate.check_id !== 'string') ||
    (!legacy &&
      candidate.check_id !== null &&
      (candidate.file_id !== null || candidate.hunk_id !== null))
  ) {
    throw new Error('review_notification_invalid');
  }
  return {
    target: 'review',
    request: {
      serverIdentity: serverIdentity(candidate.server_identity),
      authorizationRevision: revision(candidate.authorization_revision),
      principalGeneration: revision(candidate.principal_generation),
      workspaceId: bounded(candidate.workspace_id),
      workspaceRevision: revision(candidate.workspace_revision),
      reviewRevision: revision(candidate.review_revision),
      fileId: candidate.file_id === null ? null : bounded(candidate.file_id),
      hunkId: candidate.hunk_id === null ? null : bounded(candidate.hunk_id),
      checkId:
        legacy || candidate.check_id === null
          ? null
          : bounded(candidate.check_id),
    },
  };
}

export function attentionNotificationKey(
  decoded: DecodedAttentionNotification,
): string {
  const coordinates =
    decoded.target === 'review'
      ? [
          decoded.request.reviewRevision,
          decoded.request.fileId ?? '',
          decoded.request.hunkId ?? '',
          decoded.request.checkId ?? '',
        ]
      : decoded.target === 'attention_source'
        ? [
            decoded.request.sourceKind,
            decoded.request.sourceId,
            decoded.request.itemId,
            decoded.request.itemRevision,
          ]
        : [
            decoded.request.nodeKind,
            decoded.request.nodeId,
            decoded.request.nodeRevision,
          ];
  const request = decoded.request;
  return [
    decoded.target,
    request.serverIdentity,
    request.authorizationRevision,
    request.principalGeneration,
    request.workspaceId,
    request.workspaceRevision,
    ...coordinates,
  ].join('\u001f');
}

/** Permission prompts are allowed only from an explicit operator gesture. */
export function mayRequestNotificationPermission(options: {
  readonly permission: NotificationPermission;
  readonly userInitiated: boolean;
}): boolean {
  return options.permission === 'undetermined' && options.userInitiated;
}

/**
 * Builds a path-free, content-free notification only for current background
 * attention. The caller must already have admitted the exact internal route.
 */
export function admitReviewNotification(
  candidate: ReviewNotificationCandidate,
): AdmittedReviewNotification | null {
  if (
    candidate.permission !== 'granted' ||
    candidate.appState !== 'background' ||
    !candidate.authorizationActive ||
    !candidate.projectionLive ||
    candidate.attentionState !== 'needs_you' ||
    !Number.isInteger(candidate.unread) ||
    candidate.unread < 0 ||
    (candidate.target === 'review' && candidate.unread === 0)
  ) {
    return null;
  }
  return {
    title: 'Automonique needs you',
    body: 'Open Automonique to inspect the current bounded request.',
    route: candidate.route,
  };
}
