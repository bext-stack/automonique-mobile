// SPDX-License-Identifier: Elastic-2.0

import type { ReviewAction } from '@automonique/sdk';

/**
 * Production server adapters complete local review effects plus the retained
 * comment-delivery lane. The coarse execute_review_action grant is still not
 * evidence that Git, CI, or pull-request adapters exist.
 */
export const MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS = Object.freeze([
  'add_comment',
  'approve_review',
  'send_comment_to_agent',
  'batch_send_comments_to_agent',
] as const satisfies readonly ReviewAction['kind'][]);

export type MobileSupportedReviewEffectKind =
  (typeof MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS)[number];

export type MobileSupportedReviewAction = Extract<
  ReviewAction,
  { readonly kind: MobileSupportedReviewEffectKind }
>;

export const MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES = Object.freeze({
  stage: 'platform_v2_review_git_adapter_unavailable',
  unstage: 'platform_v2_review_git_adapter_unavailable',
  commit: 'platform_v2_review_git_adapter_unavailable',
  resolve_conflict: 'platform_v2_review_git_adapter_unavailable',
  rerun_check: 'platform_v2_review_ci_adapter_unavailable',
  open_pull_request: 'platform_v2_review_pull_request_adapter_unavailable',
  update_pull_request: 'platform_v2_review_pull_request_adapter_unavailable',
  merge_pull_request: 'platform_v2_review_pull_request_adapter_unavailable',
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
