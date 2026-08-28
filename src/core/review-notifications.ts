// SPDX-License-Identifier: Elastic-2.0

import type {
  AdmittedReviewRoute,
  ReviewDeepLinkRequest,
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
  readonly route: AdmittedReviewRoute;
}

export interface AdmittedReviewNotification {
  readonly title: 'Automonique needs you';
  readonly body: 'Open the current review to inspect the bounded request.';
  readonly route: AdmittedReviewRoute;
}

export type ReviewNotificationData = Readonly<Record<string, unknown>> & {
  readonly kind: 'automonique_review_attention';
  readonly server_identity: string;
  readonly workspace_id: string;
  readonly workspace_revision: string;
  readonly review_revision: string;
  readonly file_id: string | null;
  readonly hunk_id: string | null;
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
    kind: 'automonique_review_attention',
    server_identity: request.serverIdentity,
    workspace_id: request.workspaceId,
    workspace_revision: request.workspaceRevision,
    review_revision: request.reviewRevision,
    file_id: request.fileId,
    hunk_id: request.hunkId,
  };
}

/** Notification data is inert until it is decoded and re-admitted against live state. */
export function decodeReviewNotificationData(
  value: unknown,
): ReviewDeepLinkRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review_notification_invalid');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const fields = [
    'kind',
    'server_identity',
    'workspace_id',
    'workspace_revision',
    'review_revision',
    'file_id',
    'hunk_id',
  ];
  if (
    Object.keys(candidate).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(candidate, field)) ||
    candidate.kind !== 'automonique_review_attention' ||
    typeof candidate.server_identity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.server_identity) ||
    (candidate.file_id !== null && typeof candidate.file_id !== 'string') ||
    (candidate.hunk_id !== null && typeof candidate.hunk_id !== 'string') ||
    (candidate.file_id === null && candidate.hunk_id !== null)
  ) {
    throw new Error('review_notification_invalid');
  }
  return {
    serverIdentity: candidate.server_identity as ServerIdentity,
    workspaceId: bounded(candidate.workspace_id),
    workspaceRevision: revision(candidate.workspace_revision),
    reviewRevision: revision(candidate.review_revision),
    fileId: candidate.file_id === null ? null : bounded(candidate.file_id),
    hunkId: candidate.hunk_id === null ? null : bounded(candidate.hunk_id),
  };
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
    candidate.unread <= 0
  ) {
    return null;
  }
  return {
    title: 'Automonique needs you',
    body: 'Open the current review to inspect the bounded request.',
    route: candidate.route,
  };
}
