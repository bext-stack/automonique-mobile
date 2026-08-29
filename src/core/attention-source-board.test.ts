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
  AttentionBoardError,
  applyAttentionSnapshot,
  attentionItemByPresentationId,
  attentionSourceStatus,
  createAttentionSourceBoard,
  markAttentionBoardUnavailable,
  markAttentionSourceRefused,
  markAttentionSourceUnavailable,
  replaceAttentionInventory,
  retainedAttentionSnapshot,
  unavailableAttentionSources,
  visibleAttentionItems,
} from './attention-source-board';

const target = {
  project: ProjectId('project-35'),
  userWorkspace: UserWorkspaceId('workspace-35'),
};
const reviewSource: AttentionSource = { id: 'review-local', kind: 'review' };
const orchestrationSource: AttentionSource = {
  id: 'dispatch-7',
  kind: 'orchestration',
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
  overrides: Partial<AttentionSourceSnapshot> = {},
): AttentionSourceSnapshot {
  return {
    items: [item()],
    observed_at_ms: 1_000n,
    previous_revision: null,
    project: target.project,
    revision: WorkContextRevision(1n),
    schema: 'automonique.platform/attention/v1',
    semantics: 'atomic_replace',
    source: reviewSource,
    user_workspace: target.userWorkspace,
    ...overrides,
  };
}

function board() {
  return createAttentionSourceBoard(target, [
    reviewSource,
    orchestrationSource,
  ]);
}

describe('attention source board', () => {
  it('admits a first continuous read only at revision one', () => {
    expect(() =>
      applyAttentionSnapshot(
        board(),
        reviewSource,
        snapshot({
          previous_revision: WorkContextRevision(1n),
          revision: WorkContextRevision(2n),
        }),
        { mode: 'continuous' },
      ),
    ).toThrow(AttentionBoardError);

    const applied = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    });
    expect(applied.outcome).toBe('inserted');
    expect(visibleAttentionItems(applied.board)).toHaveLength(1);
  });

  it('admits an authenticated baseline above revision one', () => {
    const applied = applyAttentionSnapshot(
      board(),
      reviewSource,
      snapshot({
        previous_revision: WorkContextRevision(4n),
        revision: WorkContextRevision(5n),
      }),
      { mode: 'baseline' },
    );
    expect(applied.outcome).toBe('inserted');
    expect(
      retainedAttentionSnapshot(applied.board, reviewSource)?.revision,
    ).toBe(5n);
  });

  it('refuses a source, project, or workspace the board did not ask for', () => {
    const base = board();
    expect(() =>
      applyAttentionSnapshot(
        base,
        reviewSource,
        snapshot({ source: orchestrationSource }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_source_mismatch');
    expect(() =>
      applyAttentionSnapshot(
        base,
        reviewSource,
        snapshot({ project: ProjectId('other') }),
        {
          mode: 'continuous',
        },
      ),
    ).toThrow('attention_target_mismatch');
    expect(() =>
      applyAttentionSnapshot(
        base,
        reviewSource,
        snapshot({ user_workspace: UserWorkspaceId('other') }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_target_mismatch');
    expect(() =>
      applyAttentionSnapshot(
        base,
        { id: 'unknown', kind: 'review' },
        snapshot({ source: { id: 'unknown', kind: 'review' } }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_source_not_inventoried');
  });

  it('requires an exact predecessor and refuses a bridged gap continuously', () => {
    const first = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          previous_revision: WorkContextRevision(2n),
          revision: WorkContextRevision(3n),
        }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_successor_invalid');

    const second = applyAttentionSnapshot(
      first,
      reviewSource,
      snapshot({
        items: [
          item({ observed_at_ms: 2_000n, revision: WorkContextRevision(2n) }),
        ],
        observed_at_ms: 2_000n,
        previous_revision: WorkContextRevision(1n),
        revision: WorkContextRevision(2n),
      }),
      { mode: 'continuous' },
    );
    expect(second.outcome).toBe('replaced');
  });

  it('refuses a rollback and an item that goes backwards', () => {
    const first = applyAttentionSnapshot(
      board(),
      reviewSource,
      snapshot({
        items: [item({ revision: WorkContextRevision(4n) })],
        previous_revision: WorkContextRevision(4n),
        revision: WorkContextRevision(5n),
      }),
      { mode: 'baseline' },
    ).board;

    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          previous_revision: WorkContextRevision(3n),
          revision: WorkContextRevision(4n),
        }),
        { mode: 'baseline' },
      ),
    ).toThrow('attention_baseline_invalid');

    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          items: [item({ revision: WorkContextRevision(2n) })],
          previous_revision: WorkContextRevision(5n),
          revision: WorkContextRevision(6n),
        }),
        { mode: 'baseline' },
      ),
    ).toThrow('attention_successor_invalid');

    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          items: [item({ revision: WorkContextRevision(4n), unread: false })],
          previous_revision: WorkContextRevision(5n),
          revision: WorkContextRevision(6n),
        }),
        { mode: 'baseline' },
      ),
    ).toThrow('attention_successor_invalid');
  });

  it('distinguishes an exact replay from a conflicting one', () => {
    const first = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    expect(
      applyAttentionSnapshot(first, reviewSource, snapshot(), {
        mode: 'continuous',
      }).outcome,
    ).toBe('exact_replay');
    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({ items: [item({ unread: false })] }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_conflicting_replay');
  });

  it('restores availability from an exact replay after a refusal', () => {
    const first = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const refused = markAttentionSourceRefused(
      first,
      reviewSource,
      'unauthorized',
    );
    expect(visibleAttentionItems(refused)).toHaveLength(0);
    expect(retainedAttentionSnapshot(refused, reviewSource)).toBeNull();
    expect(attentionSourceStatus(refused, reviewSource)).toEqual({
      category: 'unauthorized',
      kind: 'refused',
    });

    const restored = applyAttentionSnapshot(refused, reviewSource, snapshot(), {
      mode: 'continuous',
    });
    expect(restored.outcome).toBe('availability_restored');
    expect(visibleAttentionItems(restored.board)).toHaveLength(1);
  });

  it('hides every projection on a whole-poll failure and keeps the chain', () => {
    const first = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const hidden = markAttentionBoardUnavailable(first, 'transport');
    expect(visibleAttentionItems(hidden)).toHaveLength(0);
    expect(unavailableAttentionSources(hidden)).toHaveLength(2);

    const recovered = applyAttentionSnapshot(
      hidden,
      reviewSource,
      snapshot({
        items: [
          item({ observed_at_ms: 2_000n, revision: WorkContextRevision(2n) }),
        ],
        observed_at_ms: 2_000n,
        previous_revision: WorkContextRevision(1n),
        revision: WorkContextRevision(2n),
      }),
      { mode: 'continuous' },
    );
    expect(recovered.outcome).toBe('replaced');
    expect(visibleAttentionItems(recovered.board)).toHaveLength(1);
  });

  it('keeps a detected gap hidden until an authenticated baseline resyncs it', () => {
    const first = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const gapped = markAttentionSourceUnavailable(
      first,
      reviewSource,
      'inventory_incomplete',
    );
    expect(visibleAttentionItems(gapped)).toHaveLength(0);

    const resynced = applyAttentionSnapshot(
      gapped,
      reviewSource,
      snapshot({
        items: [
          item({ revision: WorkContextRevision(8n), observed_at_ms: 9_000n }),
        ],
        observed_at_ms: 9_000n,
        previous_revision: WorkContextRevision(8n),
        revision: WorkContextRevision(9n),
      }),
      { mode: 'baseline' },
    );
    expect(resynced.outcome).toBe('replaced');
    expect(attentionSourceStatus(resynced.board, reviewSource)).toEqual({
      kind: 'available',
    });
  });

  it('orders items by source kind, source id, then item id', () => {
    let current = applyAttentionSnapshot(
      board(),
      orchestrationSource,
      snapshot({
        items: [item({ id: 'item-a' }), item({ id: 'item-b' })],
        source: orchestrationSource,
      }),
      { mode: 'continuous' },
    ).board;
    current = applyAttentionSnapshot(current, reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;

    expect(
      visibleAttentionItems(current).map(
        (visible) => `${visible.source.kind}/${visible.item.id}`,
      ),
    ).toEqual([
      'orchestration/item-a',
      'orchestration/item-b',
      'review/item-a',
    ]);
  });

  it('resolves an item only by its exact derived presentation identity', () => {
    const applied = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const [visible] = visibleAttentionItems(applied);
    expect(visible).toBeDefined();
    expect(
      attentionItemByPresentationId(applied, visible!.presentationId)?.item.id,
    ).toBe('item-a');
    expect(attentionItemByPresentationId(applied, 'review item-a')).toBeNull();
    expect(attentionItemByPresentationId(applied, 'item-a')).toBeNull();
  });

  it('retires a source that leaves the inventory and keeps the ones that stay', () => {
    const applied = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const narrowed = replaceAttentionInventory(applied, [reviewSource]);
    expect(narrowed.sources).toHaveLength(1);
    expect(retainedAttentionSnapshot(narrowed, reviewSource)?.revision).toBe(
      1n,
    );
    expect(() => attentionSourceStatus(narrowed, orchestrationSource)).toThrow(
      'attention_source_not_inventoried',
    );

    const readmitted = replaceAttentionInventory(narrowed, [
      reviewSource,
      orchestrationSource,
    ]);
    expect(
      retainedAttentionSnapshot(readmitted, orchestrationSource),
    ).toBeNull();
    expect(retainedAttentionSnapshot(readmitted, reviewSource)?.revision).toBe(
      1n,
    );
  });

  it('refuses a duplicate or oversized inventory', () => {
    expect(() =>
      createAttentionSourceBoard(target, [reviewSource, { ...reviewSource }]),
    ).toThrow('attention_inventory_duplicate_source');
    expect(() =>
      createAttentionSourceBoard(
        target,
        Array.from({ length: 65 }, (_unused, index) => ({
          id: `source-${index}`,
          kind: 'review' as const,
        })),
      ),
    ).toThrow('attention_inventory_too_large');
  });

  it('leaves the retained projection untouched when an application refuses', () => {
    const applied = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    expect(() =>
      applyAttentionSnapshot(
        applied,
        reviewSource,
        snapshot({
          previous_revision: WorkContextRevision(9n),
          revision: WorkContextRevision(10n),
        }),
        { mode: 'continuous' },
      ),
    ).toThrow('attention_successor_invalid');
    expect(retainedAttentionSnapshot(applied, reviewSource)?.revision).toBe(1n);
    expect(visibleAttentionItems(applied)).toHaveLength(1);
  });

  it('never lets a hidden source contribute a rendered row', () => {
    let current = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    current = applyAttentionSnapshot(
      current,
      orchestrationSource,
      snapshot({ source: orchestrationSource }),
      { mode: 'continuous' },
    ).board;
    expect(visibleAttentionItems(current)).toHaveLength(2);

    const partial = markAttentionSourceRefused(
      current,
      orchestrationSource,
      'unavailable',
    );
    expect(
      visibleAttentionItems(partial).map((visible) => visible.source.kind),
    ).toEqual(['review']);
    expect(unavailableAttentionSources(partial)).toEqual([
      {
        source: orchestrationSource,
        status: { category: 'unavailable', kind: 'refused' },
      },
    ]);
  });

  it('reports an inventoried but never-read source as unobserved, not empty', () => {
    const fresh = board();
    expect(attentionSourceStatus(fresh, reviewSource)).toEqual({
      kind: 'unavailable',
      reason: 'not_observed',
    });
    expect(unavailableAttentionSources(fresh)).toHaveLength(2);
    expect(visibleAttentionItems(fresh)).toHaveLength(0);

    const read = applyAttentionSnapshot(fresh, reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    expect(attentionSourceStatus(read, reviewSource)).toEqual({
      kind: 'available',
    });
    expect(unavailableAttentionSources(read)).toHaveLength(1);
  });

  it('carries a re-added source back in as unobserved rather than empty', () => {
    const read = applyAttentionSnapshot(board(), reviewSource, snapshot(), {
      mode: 'continuous',
    }).board;
    const readmitted = replaceAttentionInventory(
      replaceAttentionInventory(read, [reviewSource]),
      [reviewSource, orchestrationSource],
    );
    expect(attentionSourceStatus(readmitted, orchestrationSource)).toEqual({
      kind: 'unavailable',
      reason: 'not_observed',
    });
    expect(attentionSourceStatus(readmitted, reviewSource)).toEqual({
      kind: 'available',
    });
  });

  it('refuses a baseline built on a predecessor older than the retained one', () => {
    const first = applyAttentionSnapshot(
      board(),
      reviewSource,
      snapshot({
        items: [
          item({ observed_at_ms: 5_000n, revision: WorkContextRevision(5n) }),
        ],
        observed_at_ms: 5_000n,
        previous_revision: WorkContextRevision(4n),
        revision: WorkContextRevision(5n),
      }),
      { mode: 'baseline' },
    ).board;

    // Bridging a predecessor this client never saw is exactly what a baseline
    // is for, so revision 9 over predecessor 6 is admitted.
    expect(
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          items: [
            item({ observed_at_ms: 9_000n, revision: WorkContextRevision(9n) }),
          ],
          observed_at_ms: 9_000n,
          previous_revision: WorkContextRevision(6n),
          revision: WorkContextRevision(9n),
        }),
        { mode: 'baseline' },
      ).outcome,
    ).toBe('replaced');

    // Claiming a predecessor below the retained revision is a different
    // history, not a resynchronization of this one.
    expect(() =>
      applyAttentionSnapshot(
        first,
        reviewSource,
        snapshot({
          items: [
            item({ observed_at_ms: 9_000n, revision: WorkContextRevision(9n) }),
          ],
          observed_at_ms: 9_000n,
          previous_revision: WorkContextRevision(2n),
          revision: WorkContextRevision(9n),
        }),
        { mode: 'baseline' },
      ),
    ).toThrow('attention_baseline_invalid');
  });
});
