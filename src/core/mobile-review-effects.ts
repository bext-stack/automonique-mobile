// SPDX-License-Identifier: Elastic-2.0

import type { ReviewAction } from '@automonique/sdk';

/**
 * Production server adapters complete local review effects plus the retained
 * comment-delivery lane. These reach the server through the unconfirmed
 * `execute_review_action` transport and carry no server-minted digest.
 */
export const MOBILE_DIRECT_REVIEW_EFFECT_KINDS = Object.freeze([
  'add_comment',
  'approve_review',
  'send_comment_to_agent',
  'batch_send_comments_to_agent',
] as const satisfies readonly ReviewAction['kind'][]);

/**
 * The three pull-request families. Upstream mints each capability slot
 * separately from a live mutation-free preflight, so a delegation may carry any
 * subset: open and update without merge is a normal, intended grant set.
 */
export const MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS = Object.freeze([
  'open_pull_request',
  'update_pull_request',
  'merge_pull_request',
] as const satisfies readonly ReviewAction['kind'][]);

/**
 * Effects that may only travel the confirmed transport. Each one requires a
 * server-minted `confirmation_digest` and `receipt_correlation_digest` read
 * from a populated capability slot; the client never synthesises either.
 */
export const MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS = Object.freeze([
  'rerun_check',
  ...MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS,
] as const satisfies readonly ReviewAction['kind'][]);

export const MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS = Object.freeze([
  ...MOBILE_DIRECT_REVIEW_EFFECT_KINDS,
  ...MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS,
] as const satisfies readonly ReviewAction['kind'][]);

export type MobileSupportedReviewEffectKind =
  (typeof MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS)[number];

export type MobileSupportedReviewAction = Extract<
  ReviewAction,
  { readonly kind: MobileSupportedReviewEffectKind }
>;

export type MobileDirectReviewEffectKind =
  (typeof MOBILE_DIRECT_REVIEW_EFFECT_KINDS)[number];

export type MobileDirectReviewAction = Extract<
  ReviewAction,
  { readonly kind: MobileDirectReviewEffectKind }
>;

export type MobileConfirmedReviewEffectKind =
  (typeof MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS)[number];

export type MobileConfirmedReviewAction = Extract<
  ReviewAction,
  { readonly kind: MobileConfirmedReviewEffectKind }
>;

export type MobilePullRequestReviewEffectKind =
  (typeof MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS)[number];

export type MobilePullRequestReviewAction = Extract<
  ReviewAction,
  { readonly kind: MobilePullRequestReviewEffectKind }
>;

export const MOBILE_DIRECT_REVIEW_EFFECT_GRANTS = Object.freeze([
  'execute_review_action',
  'get_review_receipt',
] as const);

/**
 * The exact delegated grant set each confirmed family needs. The three
 * pull-request grants are deliberately independent: holding `open_pull_request`
 * says nothing about whether this actor may merge.
 */
export const MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS = Object.freeze({
  rerun_check: Object.freeze([
    'get_review_capabilities',
    'rerun_check',
    'get_review_receipt',
  ] as const),
  open_pull_request: Object.freeze([
    'get_review_capabilities',
    'open_pull_request',
    'get_review_receipt',
  ] as const),
  update_pull_request: Object.freeze([
    'get_review_capabilities',
    'update_pull_request',
    'get_review_receipt',
  ] as const),
  merge_pull_request: Object.freeze([
    'get_review_capabilities',
    'merge_pull_request',
    'get_review_receipt',
  ] as const),
} as const satisfies Readonly<
  Record<MobileConfirmedReviewEffectKind, readonly string[]>
>);

export function isConfirmedReviewEffectKind(
  kind: ReviewAction['kind'],
): kind is MobileConfirmedReviewEffectKind {
  return Object.hasOwn(MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS, kind);
}

export function isPullRequestReviewEffectKind(
  kind: ReviewAction['kind'],
): kind is MobilePullRequestReviewEffectKind {
  return (
    MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS as readonly ReviewAction['kind'][]
  ).includes(kind);
}

export function reviewEffectGrants(
  kind: MobileSupportedReviewEffectKind,
): readonly string[] {
  return isConfirmedReviewEffectKind(kind)
    ? MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS[kind]
    : MOBILE_DIRECT_REVIEW_EFFECT_GRANTS;
}

export const MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES = Object.freeze({
  stage: 'platform_v2_review_git_adapter_unavailable',
  unstage: 'platform_v2_review_git_adapter_unavailable',
  commit: 'platform_v2_review_git_adapter_unavailable',
  resolve_conflict: 'platform_v2_review_git_adapter_unavailable',
} as const satisfies Readonly<
  Record<Exclude<ReviewAction['kind'], MobileSupportedReviewEffectKind>, string>
>);

export function unavailableReviewEffectCategory(
  kind: ReviewAction['kind'],
): string | null {
  return Object.hasOwn(MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES, kind)
    ? MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES[
        kind as keyof typeof MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES
      ]
    : null;
}
