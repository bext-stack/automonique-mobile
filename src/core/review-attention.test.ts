// SPDX-License-Identifier: Elastic-2.0

import type { LineageProjection, ReviewSnapshot } from '@automonique/sdk';

import {
  admitReviewDeepLink,
  projectAttentionNodes,
  reviewAttentionAnchor,
  reviewActionAvailability,
  safeHunkPreview,
} from './review-attention';
import { projectReviewRenderSemantics } from './review-render-semantics';
import { workspaceCompanionFixture } from './workspace-fixtures';
import type { WorkspaceCatalogDetail } from './workspace-v2-catalog';

function review(): ReviewSnapshot {
  return {
    schema: 'automonique.platform/review/v2',
    platform_version: 2n,
    revision: 7n,
    workspace: { kind: 'user_workspace', id: 'workspace-34' },
    attention: {
      reason: 'approval_required',
      source_revision: 3n,
      state: 'needs_you',
      unread: 2n,
    },
    attention_events: [
      {
        id: 'attention-approval-1',
        origin: {
          authority: { kind: 'review', id: 'review-local' },
          id: null,
          kind: 'review',
          revision: 3n,
        },
        reason: 'approval_required',
        unread: 2n,
      },
    ],
    files: [
      {
        id: 'file-1',
        path: 'src/review.ts',
        change: 'modified',
        conflict: 'none',
        worktree: 'unstaged',
        preview: {
          byte_size: 20n,
          height: null,
          kind: 'text',
          media_type: 'text/plain',
          sanitized: true,
          width: null,
        },
        hunks: [
          {
            id: 'hunk-1',
            old_start: 1n,
            old_lines: 1n,
            new_start: 1n,
            new_lines: 2n,
            preview: '-old\n+new',
          },
        ],
      },
    ],
    checks: [],
    comments: [],
    proposals: [],
    review: {
      authority: { kind: 'review', id: 'review-local' },
      decision: 'pending',
      freshness: {
        observed_at_ms: 100n,
        observed_revision: 3n,
        state: 'fresh',
      },
    },
    pull_request: {
      authority: { kind: 'pull_request', id: 'pr-local' },
      freshness: {
        observed_at_ms: 100n,
        observed_revision: 1n,
        state: 'fresh',
      },
      head_revision: null,
      id: null,
      readiness: 'unknown',
      state: 'absent',
    },
    delivery: {
      authority: { kind: 'delivery', id: 'delivery-local' },
      freshness: {
        observed_at_ms: 100n,
        observed_revision: 1n,
        state: 'fresh',
      },
      id: null,
      state: 'not_delivered',
    },
  } as unknown as ReviewSnapshot;
}

function detail(snapshot = review()): WorkspaceCatalogDetail {
  return {
    serverIdentity: workspaceCompanionFixture.servers[0]!.serverIdentity,
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
    lineageAvailable: false,
    lineage: null,
    review: {
      snapshot,
      semantics: projectReviewRenderSemantics(snapshot)!,
      revision: '7',
      attentionState: 'needs_you',
      attentionReason: 'approval_required',
      unread: 2,
      files: [
        {
          id: 'file-1',
          path: 'src/review.ts',
          change: 'modified',
          worktree: 'unstaged',
          conflict: 'none',
          previewKind: 'text',
          sanitized: true,
          hunks: [
            {
              id: 'hunk-1',
              oldStart: '1',
              oldLines: '1',
              newStart: '1',
              newLines: '2',
              preview: '-old\n+new',
            },
          ],
        },
      ],
      pullRequestState: 'absent',
      pullRequestId: null,
      reviewDecision: 'pending',
      deliveryState: 'not_delivered',
      comments: snapshot.comments,
      checks: snapshot.checks,
      proposals: snapshot.proposals,
      reviewAuthority: snapshot.review.authority,
      reviewFreshness: snapshot.review.freshness,
      pullRequest: snapshot.pull_request,
      delivery: snapshot.delivery,
    },
  };
}

test('projects exact review and nested-agent states without flattening parents', () => {
  const lineage = {
    workspace: 'workspace-34',
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'task', id: 'task-1' },
        parent: null,
        status: { kind: 'working' },
        revision: 2n,
        latest_useful_message: null,
      },
      {
        identity: { kind: 'question', id: 'question-1' },
        parent: { kind: 'task', id: 'task-1' },
        status: { kind: 'waiting', reason: 'Choose a safe action' },
        revision: 3n,
        latest_useful_message: { text: 'Choose a safe action' },
      },
    ],
  } as unknown as LineageProjection;

  expect(projectAttentionNodes(review(), lineage)).toMatchObject([
    {
      key: 'review',
      semanticKey: 'attention.needs_you',
      state: 'needs_you',
      revision: '3',
      unread: 2,
      depth: 0,
    },
    {
      key: 'task\u0000task-1',
      semanticKey: 'orchestration.working',
      state: 'working',
      depth: 0,
    },
    {
      key: 'question\u0000question-1',
      state: 'needs_you',
      depth: 1,
    },
  ]);
});

test('preserves canonical idle attention without inventing a snapshot revision', () => {
  const snapshot = review();
  expect(
    projectAttentionNodes(
      {
        ...snapshot,
        attention: {
          reason: null,
          source_revision: null,
          state: 'idle',
          unread: 0n,
        },
      },
      null,
    ),
  ).toMatchObject([
    {
      semanticKey: 'attention.idle',
      state: 'idle',
      revision: null,
    },
  ]);
});

test('renders only sanitized bounded previews and neutralizes control text', () => {
  expect(safeHunkPreview('secret', false)).toBeNull();
  expect(safeHunkPreview('ok\n\u001b[31mred', true)).toBe('ok\n\ufffd[31mred');
  expect(safeHunkPreview('x'.repeat(600), true)).toHaveLength(512);
});

test('notification anchors come only from the authoritative selected event', () => {
  const snapshot = review();
  const commentSnapshot = {
    ...snapshot,
    attention: {
      reason: 'comment_reply',
      source_revision: 5n,
      state: 'needs_you',
      unread: 1n,
    },
    attention_events: [
      {
        id: 'attention-comment-1',
        origin: {
          authority: snapshot.review.authority,
          id: 'comment-1',
          kind: 'comment',
          revision: 5n,
        },
        reason: 'comment_reply',
        unread: 1n,
      },
    ],
    comments: [
      {
        actor: 'reviewer',
        agent_state: 'not_sent',
        anchor: {
          file_id: 'file-1',
          hunk_id: 'hunk-1',
          line: 1n,
          side: 'new',
        },
        body: 'Please inspect this line.',
        id: 'comment-1',
        revision: 5n,
        unread: true,
      },
    ],
  } as unknown as ReviewSnapshot;
  expect(reviewAttentionAnchor(commentSnapshot)).toEqual({
    fileId: 'file-1',
    hunkId: 'hunk-1',
  });
  expect(
    reviewAttentionAnchor({
      ...commentSnapshot,
      comments: [],
    } as unknown as ReviewSnapshot),
  ).toEqual({ fileId: null, hunkId: null });
});

test('deep links bind the live grant plus exact review, file, and hunk revisions', () => {
  const catalog = {
    ...workspaceCompanionFixture,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      workspaces: server.workspaces.map((workspace) => ({
        ...workspace,
        navigation: [
          ...workspace.navigation,
          { destination: 'review' as const, revision: workspace.revision },
        ],
      })),
    })),
  };
  const request = {
    serverIdentity: catalog.servers[0]!.serverIdentity,
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
    reviewRevision: '7',
    fileId: 'file-1',
    hunkId: 'hunk-1',
  } as const;
  expect(admitReviewDeepLink(catalog, [detail()], request)).toEqual({
    pathname: '/workspace/[server]/[workspace]',
    params: expect.objectContaining({
      destination: 'review',
      review_revision: '7',
      file: 'file-1',
      hunk: 'hunk-1',
    }),
  });
  expect(() =>
    admitReviewDeepLink(catalog, [detail()], {
      ...request,
      reviewRevision: '8',
    }),
  ).toThrow('review_navigation_not_authorized');
  expect(() =>
    admitReviewDeepLink(catalog, [detail()], {
      ...request,
      hunkId: 'hunk-other',
    }),
  ).toThrow('review_navigation_not_authorized');
});

test('local review actions require live exact revisions, delegated transport, and adapter support', () => {
  const snapshot = review();
  const action = {
    kind: 'approve_review' as const,
    payload: { expected_review_revision: 3n },
  };
  expect(
    reviewActionAvailability({
      action,
      delegatedActions: ['execute_review_action'],
      effectKinds: ['approve_review'],
      live: true,
      projectStale: false,
      exactReviewRevision: true,
      snapshot,
    }),
  ).toEqual({ enabled: true, reason: 'available' });
  expect(
    reviewActionAvailability({
      action,
      delegatedActions: ['get_review'],
      effectKinds: ['approve_review'],
      live: true,
      projectStale: false,
      exactReviewRevision: true,
      snapshot,
    }),
  ).toEqual({ enabled: false, reason: 'action_not_delegated' });
});
