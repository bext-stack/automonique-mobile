// SPDX-License-Identifier: Elastic-2.0

import type { LineageProjection, ReviewSnapshot } from '@automonique/sdk';

import {
  admitAttentionDeepLink,
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
    sessionBindings: [],
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
        origin: {
          workspace: 'workspace-34',
          attempt: null,
          session: null,
          pane: null,
        },
        status: { kind: 'working' },
        revision: 2n,
        latest_useful_message: null,
      },
      {
        identity: { kind: 'question', id: 'question-1' },
        parent: { kind: 'task', id: 'task-1' },
        origin: {
          workspace: 'workspace-34',
          attempt: null,
          session: null,
          pane: null,
        },
        status: { kind: 'waiting', reason: 'Choose a safe action' },
        revision: 3n,
        latest_useful_message: { text: 'Choose a safe action' },
      },
      {
        identity: { kind: 'worker', id: 'worker-1' },
        parent: { kind: 'task', id: 'task-1' },
        origin: {
          workspace: 'workspace-34',
          attempt: 'attempt-34-a',
          session: null,
          pane: null,
        },
        status: { kind: 'blocked', reason: 'Waiting on exact authority' },
        revision: 4n,
        latest_useful_message: { text: 'Waiting on exact authority' },
      },
      {
        identity: { kind: 'dispatch', id: 'dispatch-1' },
        parent: { kind: 'worker', id: 'worker-1' },
        origin: {
          workspace: 'workspace-34',
          attempt: 'attempt-34-a',
          session: null,
          pane: null,
        },
        status: { kind: 'done' },
        revision: 5n,
        latest_useful_message: { text: 'Bounded dispatch completed' },
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
      parentKey: 'task\u0000task-1',
      parentLabel: 'task task-1',
    },
    {
      key: 'worker\u0000worker-1',
      semanticKey: 'orchestration.blocked',
      state: 'blocked',
      depth: 1,
      parentKey: 'task\u0000task-1',
      parentLabel: 'task task-1',
    },
    {
      key: 'dispatch\u0000dispatch-1',
      semanticKey: 'orchestration.done',
      state: 'done',
      depth: 2,
      parentKey: 'worker\u0000worker-1',
      parentLabel: 'Waiting on exact authority',
    },
  ]);
});

test('attention links review anchors and typed lineage sessions without inferring coordinates', () => {
  const snapshot = review();
  const anchoredSnapshot = {
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
  const lineage = {
    workspace: 'workspace-34',
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'worker', id: 'worker-1' },
        parent: null,
        origin: {
          workspace: 'workspace-34',
          attempt: 'attempt-34-a',
          session: 'work-session-34',
          pane: null,
        },
        status: { kind: 'working' },
        revision: 6n,
        latest_useful_message: { text: 'Working in retained session' },
      },
    ],
  } as unknown as LineageProjection;
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
  const currentDetail = {
    ...detail(anchoredSnapshot),
    lineageAvailable: true,
    lineage,
    sessionBindings: [
      {
        workSessionId: 'work-session-34',
        attemptWorkspaceId: 'attempt-34-a',
        retainedSessionId: 'session-34',
      },
    ],
  };
  const [reviewNode, workerNode] = projectAttentionNodes(
    anchoredSnapshot,
    lineage,
  );
  expect(
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: currentDetail,
      node: reviewNode!,
      retainedSessions: [],
    }),
  ).toMatchObject({
    pathname: '/workspace/[server]/[workspace]',
    params: { file: 'file-1', hunk: 'hunk-1' },
  });
  const retainedSessions = [
    {
      target: {
        coordinate: {
          authority: 'automonique',
          kind: 'session',
          id: 'session-34',
        },
        revision: '14',
      },
    },
  ] as never;
  expect(
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: currentDetail,
      node: workerNode!,
      retainedSessions,
    }),
  ).toMatchObject({
    pathname: '/workspace/[server]/[workspace]/session/[session]',
    params: {
      session: 'session-34',
      relation_revision: '9',
      session_revision: '14',
      principal_generation: '3',
      authorization_revision: '8',
    },
  });
  expect(() =>
    admitAttentionDeepLink({
      catalog: { ...catalog, selectedServerIdentity: null },
      details: [currentDetail],
      detail: currentDetail,
      node: workerNode!,
      retainedSessions,
    }),
  ).toThrow('attention_navigation_not_authorized');
  expect(() =>
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: {
        ...currentDetail,
        sessionBindings: currentDetail.sessionBindings.map((binding) => ({
          ...binding,
          attemptWorkspaceId: 'attempt-34-b',
        })),
      },
      node: workerNode!,
      retainedSessions,
    }),
  ).toThrow('attention_navigation_not_authorized');
  expect(() =>
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: {
        ...currentDetail,
        sessionBindings: currentDetail.sessionBindings.map((binding) => ({
          ...binding,
          workSessionId: binding.retainedSessionId,
          retainedSessionId: binding.workSessionId,
        })),
      },
      node: workerNode!,
      retainedSessions,
    }),
  ).toThrow('attention_navigation_not_authorized');
  expect(() =>
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: {
        ...currentDetail,
        lineage: {
          ...lineage,
          orchestration: lineage.orchestration.map((record) => ({
            ...record,
            origin: { ...record.origin, attempt: null },
          })),
        } as LineageProjection,
      },
      node: workerNode!,
      retainedSessions,
    }),
  ).toThrow('attention_navigation_not_authorized');
  expect(() =>
    admitAttentionDeepLink({
      catalog,
      details: [currentDetail],
      detail: currentDetail,
      node: workerNode!,
      retainedSessions: [],
    }),
  ).toThrow('attention_navigation_not_authorized');
});

test('projects and admits lineage-only attention without inventing review state', () => {
  const lineage = {
    workspace: 'workspace-34',
    external_work_items: [],
    orchestration: [
      {
        identity: { kind: 'question', id: 'question-lineage-only' },
        parent: null,
        origin: {
          workspace: 'workspace-34',
          attempt: 'attempt-34-a',
          session: 'work-session-34',
          pane: null,
        },
        status: { kind: 'waiting', reason: 'Inspect retained context' },
        revision: 8n,
        latest_useful_message: { text: 'Inspect retained context' },
      },
    ],
  } as unknown as LineageProjection;
  const lineageOnlyDetail: WorkspaceCatalogDetail = {
    ...detail(),
    lineageAvailable: true,
    lineage,
    sessionBindings: [
      {
        workSessionId: 'work-session-34',
        attemptWorkspaceId: 'attempt-34-a',
        retainedSessionId: 'session-34',
      },
    ],
    review: null,
  };
  const [node] = projectAttentionNodes(null, lineage);
  expect(node).toMatchObject({
    key: 'question\u0000question-lineage-only',
    state: 'needs_you',
    revision: '8',
  });
  expect(
    admitAttentionDeepLink({
      catalog: workspaceCompanionFixture,
      details: [lineageOnlyDetail],
      detail: lineageOnlyDetail,
      node: node!,
      retainedSessions: [
        {
          target: {
            coordinate: {
              authority: 'automonique',
              kind: 'session',
              id: 'session-34',
            },
            revision: '15',
          },
        },
      ] as never,
    }),
  ).toMatchObject({
    pathname: '/workspace/[server]/[workspace]/session/[session]',
    params: {
      session: 'session-34',
      session_revision: '15',
      principal_generation: '3',
      authorization_revision: '8',
    },
  });
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

test('retained-agent comment delivery requires an exact unsent comment revision', () => {
  const snapshot = {
    ...review(),
    comments: [
      {
        actor: 'operator-mobile',
        agent_state: 'not_sent',
        anchor: {
          file_id: 'file-1',
          hunk_id: 'hunk-1',
          line: 1n,
          side: 'new',
        },
        body: 'Exact persisted comment',
        id: 'comment-1',
        revision: 4n,
        unread: false,
      },
    ],
  } as ReviewSnapshot;
  const available = {
    action: {
      kind: 'send_comment_to_agent' as const,
      payload: { comment_id: 'comment-1', expected_comment_revision: 4n },
    },
    delegatedActions: ['execute_review_action'],
    effectKinds: ['send_comment_to_agent'] as const,
    live: true,
    projectStale: false,
    exactReviewRevision: true,
    snapshot,
  };
  expect(reviewActionAvailability(available)).toEqual({
    enabled: true,
    reason: 'available',
  });
  expect(
    reviewActionAvailability({
      ...available,
      action: {
        ...available.action,
        payload: {
          ...available.action.payload,
          expected_comment_revision: 3n,
        },
      },
    }),
  ).toEqual({ enabled: false, reason: 'target_already_settled' });
  expect(
    reviewActionAvailability({
      ...available,
      snapshot: {
        ...snapshot,
        comments: [{ ...snapshot.comments[0]!, agent_state: 'sent' }],
      } as ReviewSnapshot,
    }),
  ).toEqual({ enabled: false, reason: 'target_already_settled' });

  const refused = {
    ...snapshot.comments[0]!,
    id: 'comment-2',
    revision: 5n,
    agent_state: 'refused' as const,
  };
  const batch = {
    ...available,
    effectKinds: ['batch_send_comments_to_agent'] as const,
    snapshot: { ...snapshot, comments: [...snapshot.comments, refused] },
    action: {
      kind: 'batch_send_comments_to_agent' as const,
      payload: {
        comments: [
          { comment_id: 'comment-1', expected_comment_revision: 4n },
          { comment_id: 'comment-2', expected_comment_revision: 5n },
        ],
      },
    },
  };
  expect(reviewActionAvailability(batch)).toEqual({
    enabled: true,
    reason: 'available',
  });
  expect(
    reviewActionAvailability({
      ...batch,
      action: {
        ...batch.action,
        payload: {
          comments: [
            batch.action.payload.comments[0]!,
            { comment_id: 'comment-2', expected_comment_revision: 4n },
          ],
        },
      },
    }),
  ).toEqual({ enabled: false, reason: 'target_already_settled' });
  expect(
    reviewActionAvailability({
      ...batch,
      snapshot: {
        ...batch.snapshot,
        comments: [snapshot.comments[0]!, { ...refused, agent_state: 'sent' }],
      },
    }),
  ).toEqual({ enabled: false, reason: 'target_already_settled' });
});
