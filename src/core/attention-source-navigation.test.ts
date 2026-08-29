// SPDX-License-Identifier: Elastic-2.0

import {
  ProjectId,
  UserWorkspaceId,
  WorkContextRevision,
  type AttentionItem,
  type AttentionSource,
  type AttentionSourceSnapshot,
  type ReviewSnapshot,
} from '@automonique/sdk';

import {
  applyAttentionSnapshot,
  createAttentionSourceBoard,
} from './attention-source-board';
import {
  admitAttentionSourceNotificationDeepLink,
  admitAuthoritativeAttentionDeepLink,
} from './attention-source-navigation';
import { projectAuthoritativeAttentionNodes } from './attention-source-projection';
import { projectReviewRenderSemantics } from './review-render-semantics';
import type { SessionSummary } from './types';
import { workspaceCompanionFixture } from './workspace-fixtures';
import type { WorkspaceCatalogDetail } from './workspace-v2-catalog';

const target = {
  project: ProjectId('project-mobile'),
  userWorkspace: UserWorkspaceId('workspace-34'),
};
const reviewSource: AttentionSource = { id: 'workspace-34', kind: 'review' };
const orchestrationSource: AttentionSource = {
  id: 'workspace-34',
  kind: 'orchestration',
};
const providerSource: AttentionSource = {
  id: 'work-session-34',
  kind: 'provider_session',
};

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

function reviewSnapshot(): ReviewSnapshot {
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
    files: [],
    comments: [],
    checks: [],
    review: {
      authority: { kind: 'review', id: 'review-local' },
      decision: 'pending',
      freshness: { state: 'fresh', observed_revision: 3n },
    },
    pull_request: {
      authority: { kind: 'review', id: 'review-local' },
      freshness: { state: 'fresh', observed_revision: 3n },
      id: null,
      state: 'absent',
      merge_readiness: 'unknown',
    },
    delivery: {
      authority: { kind: 'review', id: 'review-local' },
      freshness: { state: 'fresh', observed_revision: 3n },
      id: null,
      state: 'not_delivered',
    },
  } as unknown as ReviewSnapshot;
}

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'item-a',
    nested_agent_path: [],
    observed_at_ms: 1_000n,
    platform_session: null,
    reason: 'approval_required',
    revision: WorkContextRevision(1n),
    state: 'needs_you',
    unread: true,
    ...overrides,
  };
}

function snapshot(
  source: AttentionSource,
  items: readonly AttentionItem[],
): AttentionSourceSnapshot {
  return {
    items,
    observed_at_ms: 1_000n,
    previous_revision: null,
    project: target.project,
    revision: WorkContextRevision(1n),
    schema: 'automonique.platform/attention/v1',
    semantics: 'atomic_replace',
    source,
    user_workspace: target.userWorkspace,
  };
}

function board(
  entries: readonly (readonly [AttentionSource, readonly AttentionItem[]])[],
) {
  let current = createAttentionSourceBoard(
    target,
    entries.map(([source]) => source),
  );
  for (const [source, items] of entries) {
    current = applyAttentionSnapshot(current, source, snapshot(source, items), {
      mode: 'continuous',
    }).board;
  }
  return current;
}

function detail(
  attention: WorkspaceCatalogDetail['attention'],
): WorkspaceCatalogDetail {
  const review = reviewSnapshot();
  return {
    attention,
    lineage: null,
    lineageAvailable: false,
    review: {
      snapshot: review,
      semantics: projectReviewRenderSemantics(review)!,
      revision: '7',
      attentionState: 'needs_you',
      attentionReason: 'approval_required',
      unread: 2,
      files: [],
      comments: [],
      checks: [],
      pullRequestId: null,
      pullRequestState: 'absent',
      mergeReadiness: 'unknown',
      deliveryState: 'not_delivered',
      decision: 'pending',
      reviewFreshness: 'fresh',
      pullRequestFreshness: 'fresh',
      deliveryFreshness: 'fresh',
    } as unknown as WorkspaceCatalogDetail['review'],
    serverIdentity: workspaceCompanionFixture.servers[0]!.serverIdentity,
    sessionBindings: [
      {
        attemptWorkspaceId: 'attempt-34-a',
        retainedSessionId: 'session-34',
        workSessionId: 'work-session-34',
      },
    ],
    workspaceId: 'workspace-34',
    workspaceRevision: '12',
  };
}

const retainedSessions: readonly SessionSummary[] = [
  {
    target: {
      coordinate: {
        authority: 'automonique',
        id: 'session-34',
        kind: 'session',
      },
    },
  } as unknown as SessionSummary,
];

function admit(
  current: WorkspaceCatalogDetail,
  nodeIndex = 0,
  sessions: readonly SessionSummary[] = retainedSessions,
) {
  const nodes = projectAuthoritativeAttentionNodes(current.attention!);
  return admitAuthoritativeAttentionDeepLink({
    catalog,
    detail: current,
    details: [current],
    node: nodes[nodeIndex]!,
    retainedSessions: sessions,
  });
}

describe('authoritative attention navigation', () => {
  it('opens the review anchor for a review row', () => {
    const current = detail(board([[reviewSource, [item()]]]));
    expect(admit(current)).toEqual({
      pathname: '/workspace/[server]/[workspace]',
      params: {
        destination: 'review',
        review_revision: '7',
        revision: '12',
        server: workspaceCompanionFixture.servers[0]!.serverIdentity,
        workspace: 'workspace-34',
      },
    });
  });

  it('opens the review root for an orchestration row', () => {
    const current = detail(board([[orchestrationSource, [item()]]]));
    expect(admit(current)).toMatchObject({
      pathname: '/workspace/[server]/[workspace]',
      params: { destination: 'review' },
    });
  });

  it('opens exactly the session the server bound a provider row to', () => {
    const current = detail(
      board([
        [
          providerSource,
          [
            item({
              platform_session: {
                authority: 'automonique',
                id: 'session-34',
                kind: 'session',
              },
              reason: 'agent_working',
              state: 'working',
            }),
          ],
        ],
      ]),
    );
    expect(admit(current)).toMatchObject({
      pathname: '/workspace/[server]/[workspace]/session/[session]',
    });
  });

  it('refuses a provider row whose session is not the bound one', () => {
    const current = detail(
      board([
        [
          providerSource,
          [
            item({
              platform_session: {
                authority: 'automonique',
                id: 'session-other',
                kind: 'session',
              },
              reason: 'agent_working',
              state: 'working',
            }),
          ],
        ],
      ]),
    );
    expect(() => admit(current)).toThrow('attention_navigation_not_authorized');
  });

  it('refuses a provider row with no retained session left', () => {
    const current = detail(
      board([
        [
          providerSource,
          [
            item({
              platform_session: {
                authority: 'automonique',
                id: 'session-34',
                kind: 'session',
              },
              reason: 'agent_working',
              state: 'working',
            }),
          ],
        ],
      ]),
    );
    expect(() => admit(current, 0, [])).toThrow(
      'attention_navigation_not_authorized',
    );
  });

  it('refuses a row whose board belongs to another workspace', () => {
    const foreign = createAttentionSourceBoard(
      {
        project: target.project,
        userWorkspace: UserWorkspaceId('workspace-other'),
      },
      [{ id: 'workspace-other', kind: 'review' }],
    );
    const current = detail(
      applyAttentionSnapshot(
        foreign,
        { id: 'workspace-other', kind: 'review' },
        {
          ...snapshot({ id: 'workspace-other', kind: 'review' }, [item()]),
          user_workspace: UserWorkspaceId('workspace-other'),
        },
        { mode: 'continuous' },
      ).board,
    );
    expect(() => admit(current)).toThrow('attention_navigation_not_authorized');
  });

  it('refuses every row once the project is stale', () => {
    const current = detail(board([[reviewSource, [item()]]]));
    const stale = {
      ...catalog,
      servers: catalog.servers.map((server) => ({
        ...server,
        staleProjectIds: ['project-mobile'],
      })),
    };
    const nodes = projectAuthoritativeAttentionNodes(current.attention!);
    expect(() =>
      admitAuthoritativeAttentionDeepLink({
        catalog: stale,
        detail: current,
        details: [current],
        node: nodes[0]!,
        retainedSessions,
      }),
    ).toThrow('attention_navigation_not_authorized');
  });

  it('re-admits a notification only at the exact item revision', () => {
    const current = detail(board([[reviewSource, [item()]]]));
    const server = workspaceCompanionFixture.servers[0]!;
    const request = {
      authorizationRevision: server.authorizationRevision,
      itemId: 'item-a',
      itemRevision: '1',
      principalGeneration: server.principalGeneration,
      serverIdentity: server.serverIdentity,
      sourceId: 'workspace-34',
      sourceKind: 'review',
      workspaceId: 'workspace-34',
      workspaceRevision: '12',
    };
    expect(
      admitAttentionSourceNotificationDeepLink({
        catalog,
        details: [current],
        request,
        retainedSessions,
      }),
    ).toMatchObject({ pathname: '/workspace/[server]/[workspace]' });

    for (const stale of [
      { ...request, itemRevision: '2' },
      { ...request, itemId: 'item-gone' },
      { ...request, sourceId: 'workspace-other' },
      { ...request, sourceKind: 'orchestration' },
      { ...request, workspaceRevision: '13' },
      { ...request, principalGeneration: '99' },
      { ...request, authorizationRevision: '99' },
    ]) {
      expect(() =>
        admitAttentionSourceNotificationDeepLink({
          catalog,
          details: [current],
          request: stale,
          retainedSessions,
        }),
      ).toThrow('attention_navigation_not_authorized');
    }
  });

  it('refuses a notification for a workspace that serves no board', () => {
    const current = detail(null);
    const server = workspaceCompanionFixture.servers[0]!;
    expect(() =>
      admitAttentionSourceNotificationDeepLink({
        catalog,
        details: [current],
        request: {
          authorizationRevision: server.authorizationRevision,
          itemId: 'item-a',
          itemRevision: '1',
          principalGeneration: server.principalGeneration,
          serverIdentity: server.serverIdentity,
          sourceId: 'workspace-34',
          sourceKind: 'review',
          workspaceId: 'workspace-34',
          workspaceRevision: '12',
        },
        retainedSessions,
      }),
    ).toThrow('attention_navigation_not_authorized');
  });
});
