// SPDX-License-Identifier: Elastic-2.0

import {
  ProjectId,
  UserWorkspaceId,
  WorkContextRevision,
  type AttentionItem,
  type AttentionSource,
  type AttentionSourceSnapshot,
} from '@automonique/sdk';

import {
  applyAttentionSnapshot,
  createAttentionSourceBoard,
  markAttentionSourceRefused,
} from './attention-source-board';
import {
  projectAuthoritativeAttentionNodes,
  summarizeAuthoritativeAttention,
} from './attention-source-projection';

const target = {
  project: ProjectId('project-35'),
  userWorkspace: UserWorkspaceId('workspace-35'),
};
const reviewSource: AttentionSource = { id: 'workspace-35', kind: 'review' };
const providerSource: AttentionSource = {
  id: 'session-1',
  kind: 'provider_session',
};

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

function boardWith(
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

describe('authoritative attention projection', () => {
  it('carries the server state and reason without re-deriving either', () => {
    const nodes = projectAuthoritativeAttentionNodes(
      boardWith([
        [
          reviewSource,
          [item({ reason: 'check_failed', state: 'blocked', unread: false })],
        ],
      ]),
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      depth: 0,
      itemId: 'item-a',
      parentKey: null,
      platformSession: null,
      reason: 'check_failed',
      reasonKey: 'attention_reason.check_failed',
      revision: '1',
      semanticKey: 'attention.blocked',
      state: 'blocked',
      unread: false,
    });
  });

  it('orders blocked before needs you before working before done', () => {
    const nodes = projectAuthoritativeAttentionNodes(
      boardWith([
        [
          reviewSource,
          [
            item({ id: 'a', reason: 'complete', state: 'done', unread: false }),
            item({ id: 'b', reason: 'check_running', state: 'working' }),
            item({ id: 'c', reason: 'conflict', state: 'blocked' }),
            item({ id: 'd', reason: 'review_requested', state: 'needs_you' }),
          ],
        ],
      ]),
    );
    expect(nodes.map((node) => node.itemId)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('puts unread first inside one state', () => {
    const nodes = projectAuthoritativeAttentionNodes(
      boardWith([
        [
          reviewSource,
          [item({ id: 'a', unread: false }), item({ id: 'b', unread: true })],
        ],
      ]),
    );
    expect(nodes.map((node) => node.itemId)).toEqual(['b', 'a']);
  });

  it('nests only on a path element the server also published as an item', () => {
    const nodes = projectAuthoritativeAttentionNodes(
      boardWith([
        [
          reviewSource,
          [
            item({ id: 'agent-root' }),
            item({ id: 'child', nested_agent_path: ['agent-root'] }),
            item({ id: 'orphan', nested_agent_path: ['agent-missing'] }),
          ],
        ],
      ]),
    );
    const byId = new Map(nodes.map((node) => [node.itemId, node]));
    expect(byId.get('child')?.depth).toBe(1);
    expect(byId.get('child')?.parentKey).toBe(byId.get('agent-root')?.key);
    expect(byId.get('orphan')?.depth).toBe(1);
    expect(byId.get('orphan')?.parentKey).toBeNull();
  });

  it('surfaces a provider session exactly as the server published it', () => {
    const nodes = projectAuthoritativeAttentionNodes(
      boardWith([
        [
          providerSource,
          [
            item({
              platform_session: {
                authority: 'automonique',
                id: 'platform-session-1',
                kind: 'session',
              },
              reason: 'agent_working',
              state: 'working',
            }),
          ],
        ],
      ]),
    );
    expect(nodes[0]?.platformSession).toEqual({
      authority: 'automonique',
      id: 'platform-session-1',
      kind: 'session',
    });
  });

  it('reports a partial board instead of implying an empty inbox', () => {
    const full = boardWith([
      [reviewSource, [item({ id: 'a' })]],
      [
        providerSource,
        [item({ id: 'b', reason: 'agent_working', state: 'working' })],
      ],
    ]);
    expect(summarizeAuthoritativeAttention(full)).toMatchObject({
      counts: { blocked: 0, done: 0, needs_you: 1, working: 1 },
      hiddenSources: [],
      partial: false,
      unread: 2,
    });

    const partial = markAttentionSourceRefused(
      full,
      providerSource,
      'unauthorized',
    );
    expect(summarizeAuthoritativeAttention(partial)).toMatchObject({
      counts: { blocked: 0, done: 0, needs_you: 1, working: 0 },
      hiddenSources: [providerSource],
      partial: true,
      unread: 1,
    });
  });
});
