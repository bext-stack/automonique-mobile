// SPDX-License-Identifier: Elastic-2.0

import { ReviewActionKind_VALUES } from '@automonique/sdk';

import {
  MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS,
  MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS,
  MOBILE_DIRECT_REVIEW_EFFECT_GRANTS,
  MOBILE_DIRECT_REVIEW_EFFECT_KINDS,
  MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS,
  MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS,
  MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES,
  isConfirmedReviewEffectKind,
  isPullRequestReviewEffectKind,
  reviewEffectGrants,
  unavailableReviewEffectCategory,
} from './mobile-review-effects';

test('the mobile effect audit classifies every canonical review action exactly once', () => {
  expect(MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS).toEqual([
    'add_comment',
    'approve_review',
    'send_comment_to_agent',
    'batch_send_comments_to_agent',
    'rerun_check',
    'open_pull_request',
    'update_pull_request',
    'merge_pull_request',
  ]);
  expect(MOBILE_DIRECT_REVIEW_EFFECT_KINDS).toEqual(
    MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS.slice(
      0,
      -MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS.length,
    ),
  );
  expect(MOBILE_CONFIRMED_REVIEW_EFFECT_KINDS).toEqual([
    'rerun_check',
    ...MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS,
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
  expect(unavailableReviewEffectCategory('rerun_check')).toBeNull();
  expect(unavailableReviewEffectCategory('merge_pull_request')).toBeNull();
  expect(unavailableReviewEffectCategory('commit')).toBe(
    'platform_v2_review_git_adapter_unavailable',
  );
});

test('no pull-request family shares a grant with another', () => {
  for (const kind of MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS) {
    expect(isPullRequestReviewEffectKind(kind)).toBe(true);
    expect(isConfirmedReviewEffectKind(kind)).toBe(true);
    // Its own name is the grant that distinguishes it, and it is held by no
    // sibling. A delegation cannot reach one family through another.
    expect(reviewEffectGrants(kind)).toEqual([
      'get_review_capabilities',
      kind,
      'get_review_receipt',
    ]);
    for (const sibling of MOBILE_PULL_REQUEST_REVIEW_EFFECT_KINDS) {
      if (sibling === kind) continue;
      expect(reviewEffectGrants(sibling)).not.toContain(kind);
    }
  }
  for (const kind of MOBILE_DIRECT_REVIEW_EFFECT_KINDS) {
    expect(isConfirmedReviewEffectKind(kind)).toBe(false);
    expect(reviewEffectGrants(kind)).toEqual(
      MOBILE_DIRECT_REVIEW_EFFECT_GRANTS,
    );
  }
  // The unconfirmed transport grant never appears in a confirmed grant set, so
  // `execute_review_action` alone can never reach a pull-request write.
  for (const grants of Object.values(MOBILE_CONFIRMED_REVIEW_EFFECT_GRANTS)) {
    expect(grants).not.toContain('execute_review_action');
  }
});
