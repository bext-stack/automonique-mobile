// SPDX-License-Identifier: Elastic-2.0

import { ReviewActionKind_VALUES } from '@automonique/sdk';

import {
  MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS,
  MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES,
  unavailableReviewEffectCategory,
} from './mobile-review-effects';

test('the mobile effect audit classifies every canonical review action exactly once', () => {
  expect(MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS).toEqual([
    'add_comment',
    'approve_review',
    'send_comment_to_agent',
    'batch_send_comments_to_agent',
  ]);
  expect(Object.isFrozen(MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS)).toBe(true);
  expect(Object.isFrozen(MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES)).toBe(
    true,
  );
  expect(
    [
      ...MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS,
      ...Object.keys(MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES),
    ].sort(),
  ).toEqual([...ReviewActionKind_VALUES].sort());
  expect(unavailableReviewEffectCategory('add_comment')).toBeNull();
  expect(unavailableReviewEffectCategory('send_comment_to_agent')).toBeNull();
  expect(unavailableReviewEffectCategory('rerun_check')).toBe(
    'platform_v2_review_ci_adapter_unavailable',
  );
  expect(unavailableReviewEffectCategory('merge_pull_request')).toBe(
    'platform_v2_review_pull_request_adapter_unavailable',
  );
});
