// SPDX-License-Identifier: Elastic-2.0

import {
  UserWorkspaceId,
  decodeAttentionReason,
  type AuthorizedReviewSnapshot,
} from '@automonique/sdk';
import {
  createRenderConformanceCorpus,
  type RenderConformanceInput,
} from '@automonique/sdk/testing';

import { projectReviewRenderSemantics } from './review-render-semantics';

const authority = { kind: 'review' as const, id: 'canonical-fixture' };

function snapshot(input: RenderConformanceInput): AuthorizedReviewSnapshot {
  return {
    schema: 'automonique.platform/review/v2',
    platform_version: 2n,
    revision: input.revision,
    workspace: {
      kind: 'user_workspace',
      id: UserWorkspaceId('render-corpus-workspace'),
    },
    attention: {
      ...input.attention,
      reason:
        input.attention.reason === null
          ? null
          : decodeAttentionReason(input.attention.reason),
      unread: BigInt(input.attention.unread),
    },
    attention_events: [],
    checks: input.checks.map((check) => ({
      ...check,
      authority: { kind: 'ci', id: check.id },
      freshness: { ...check.freshness, observed_at_ms: 1n },
    })),
    comments: [],
    proposals: [],
    review: {
      authority,
      decision: input.review.decision,
      freshness: { ...input.review.freshness, observed_at_ms: 1n },
    },
    pull_request: {
      authority: { kind: 'pull_request', id: 'canonical-pr' },
      freshness: {
        ...input.pull_request.freshness,
        observed_at_ms: 1n,
      },
      head_revision: null,
      id: input.pull_request.state === 'absent' ? null : 'canonical-pr',
      readiness: input.pull_request.readiness,
      state: input.pull_request.state,
    },
    delivery: {
      authority: { kind: 'delivery', id: 'canonical-delivery' },
      freshness: { ...input.delivery.freshness, observed_at_ms: 1n },
      id: input.delivery.state === 'not_delivered' ? null : 'delivery-1',
      state: input.delivery.state,
    },
    files: input.files.map((file) => ({
      change: 'modified',
      conflict: 'none',
      hunks: [],
      id: file.id,
      path: `src/${file.id}.ts`,
      preview: {
        byte_size: null,
        height: null,
        kind: file.preview.kind,
        media_type: null,
        sanitized: file.preview.sanitized,
        width: null,
      },
      worktree: 'unstaged',
    })),
  };
}

test('projects every canonical cross-client render case without revision loss', () => {
  const corpus = createRenderConformanceCorpus();
  expect(corpus.cases.map(({ id }) => id)).toEqual([
    'idle',
    'needs_you',
    'working',
    'blocked',
    'done',
  ]);
  for (const fixtureCase of corpus.cases) {
    expect(projectReviewRenderSemantics(snapshot(fixtureCase.input))).toEqual(
      fixtureCase.expected,
    );
  }
});

test('refuses incoherent attention, freshness, duplicate identity, and preview truth', () => {
  const baseline = snapshot(createRenderConformanceCorpus().cases[1]!.input);
  expect(
    projectReviewRenderSemantics({
      ...baseline,
      attention: { ...baseline.attention, reason: 'complete' },
    }),
  ).toBeNull();
  expect(
    projectReviewRenderSemantics({
      ...baseline,
      review: {
        ...baseline.review,
        freshness: {
          ...baseline.review.freshness,
          observed_revision: baseline.revision + 1n,
        },
      },
    }),
  ).toBeNull();
  expect(
    projectReviewRenderSemantics({
      ...baseline,
      checks: [baseline.checks[0]!, baseline.checks[0]!],
    }),
  ).toBeNull();
  expect(
    projectReviewRenderSemantics({
      ...baseline,
      files: baseline.files.map((file) => ({
        ...file,
        preview: { ...file.preview, sanitized: false },
      })),
    }),
  ).toBeNull();
});
