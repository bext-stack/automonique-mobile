// SPDX-License-Identifier: Elastic-2.0

import type {
  AttentionReason,
  AttentionState,
  ReviewFreshness,
  ReviewSnapshot,
} from '@automonique/sdk';

const MAX_RENDER_CHECKS = 128;
const MAX_RENDER_FILES = 128;

export interface MobileRenderSemantic {
  readonly semantic_key: string;
  readonly source_revision: bigint;
}

export interface MobileFreshRenderSemantic extends MobileRenderSemantic {
  readonly freshness_key: `freshness.${ReviewFreshness['state']}`;
}

export interface MobileReviewRenderSemantics {
  readonly source_revision: bigint;
  readonly attention: {
    readonly semantic_key: `attention.${AttentionState}`;
    readonly reason_key: `attention_reason.${AttentionReason}` | null;
    readonly source_revision: bigint | null;
  };
  readonly review: MobileFreshRenderSemantic;
  readonly checks: readonly (MobileFreshRenderSemantic & {
    readonly id: string;
  })[];
  readonly pull_request: MobileFreshRenderSemantic;
  readonly delivery: MobileFreshRenderSemantic;
  readonly previews: readonly (MobileRenderSemantic & {
    readonly id: string;
  })[];
}

const ATTENTION_REASON_STATES: Readonly<
  Record<AttentionReason, Exclude<AttentionState, 'idle'>>
> = {
  approval_required: 'needs_you',
  check_failed: 'blocked',
  check_running: 'working',
  comment_reply: 'needs_you',
  complete: 'done',
  conflict: 'blocked',
  delivery_pending: 'working',
  external_blocker: 'blocked',
  review_requested: 'needs_you',
};

function boundedIdentity(value: string): boolean {
  return value.length > 0 && new TextEncoder().encode(value).byteLength <= 256;
}

function semanticFreshness(
  value: ReviewFreshness,
  rootRevision: bigint,
): Omit<MobileFreshRenderSemantic, 'semantic_key'> | null {
  if (value.observed_revision <= 0n || value.observed_revision > rootRevision) {
    return null;
  }
  return Object.freeze({
    freshness_key: `freshness.${value.state}`,
    source_revision: value.observed_revision,
  });
}

/**
 * Projects the decoded server document to the canonical cross-client render
 * keys. Any incoherent source/freshness relationship makes the whole review
 * unavailable instead of relabelling it with a plausible local state.
 */
export function projectReviewRenderSemantics(
  document: ReviewSnapshot,
): MobileReviewRenderSemantics | null {
  const rootRevision = document.revision;
  if (
    rootRevision <= 0n ||
    document.checks.length > MAX_RENDER_CHECKS ||
    document.files.length > MAX_RENDER_FILES
  ) {
    return null;
  }

  const attention = document.attention;
  const idleAttention =
    attention.state === 'idle' &&
    attention.reason === null &&
    attention.source_revision === null &&
    attention.unread === 0n;
  const activeAttention =
    attention.state !== 'idle' &&
    attention.reason !== null &&
    ATTENTION_REASON_STATES[attention.reason] === attention.state &&
    attention.source_revision !== null &&
    attention.source_revision > 0n &&
    attention.source_revision <= rootRevision &&
    attention.unread >= 0n;
  if (!idleAttention && !activeAttention) return null;

  const reviewFreshness = semanticFreshness(
    document.review.freshness,
    rootRevision,
  );
  const pullRequestFreshness = semanticFreshness(
    document.pull_request.freshness,
    rootRevision,
  );
  const deliveryFreshness = semanticFreshness(
    document.delivery.freshness,
    rootRevision,
  );
  if (
    reviewFreshness === null ||
    pullRequestFreshness === null ||
    deliveryFreshness === null
  ) {
    return null;
  }

  const checkIds = new Set<string>();
  const checks: (MobileFreshRenderSemantic & { readonly id: string })[] = [];
  for (const check of document.checks) {
    const freshness = semanticFreshness(check.freshness, rootRevision);
    if (
      !boundedIdentity(check.id) ||
      checkIds.has(check.id) ||
      freshness === null
    ) {
      return null;
    }
    checkIds.add(check.id);
    checks.push(
      Object.freeze({
        id: check.id,
        semantic_key: `check.${check.state}.${check.required ? 'required' : 'optional'}`,
        ...freshness,
      }),
    );
  }

  const fileIds = new Set<string>();
  const previews: (MobileRenderSemantic & { readonly id: string })[] = [];
  for (const file of document.files) {
    const coherentSanitization =
      file.preview.kind === 'none' || file.preview.kind === 'binary'
        ? file.preview.sanitized === false
        : file.preview.sanitized === true;
    if (
      !boundedIdentity(file.id) ||
      fileIds.has(file.id) ||
      !coherentSanitization
    ) {
      return null;
    }
    fileIds.add(file.id);
    previews.push(
      Object.freeze({
        id: file.id,
        semantic_key: `preview.${file.preview.kind}.${file.preview.sanitized ? 'sanitized' : 'raw'}`,
        source_revision: rootRevision,
      }),
    );
  }

  return Object.freeze({
    source_revision: rootRevision,
    attention: Object.freeze({
      semantic_key: `attention.${attention.state}`,
      reason_key:
        attention.reason === null
          ? null
          : `attention_reason.${attention.reason}`,
      source_revision: attention.source_revision,
    }),
    review: Object.freeze({
      semantic_key: `review.${document.review.decision}`,
      ...reviewFreshness,
    }),
    checks: Object.freeze(checks),
    pull_request: Object.freeze({
      semantic_key: `pull_request.${document.pull_request.state}.${document.pull_request.readiness}`,
      ...pullRequestFreshness,
    }),
    delivery: Object.freeze({
      semantic_key: `delivery.${document.delivery.state}`,
      ...deliveryFreshness,
    }),
    previews: Object.freeze(previews),
  });
}
