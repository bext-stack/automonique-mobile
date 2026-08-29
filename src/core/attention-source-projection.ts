// SPDX-License-Identifier: Elastic-2.0

import type {
  AttentionItemReason,
  AttentionItemState,
  AttentionSource,
} from '@automonique/sdk';

import {
  visibleAttentionItems,
  unavailableAttentionSources,
  type AttentionSourceBoard,
  type AuthoritativeAttentionItem,
} from './attention-source-board';

/**
 * Renderable rows derived from the authoritative attention board.
 *
 * Nothing here re-derives state or reason: the server already decided both, and
 * the wire decoder already proved they agree. The projection only adds display
 * ordering, the nesting the `nested_agent_path` describes, and the semantic
 * keys the desktop and hosted surfaces use for the same meaning.
 */

export const MAX_AUTHORITATIVE_ATTENTION_NODES = 256;

export type AuthoritativeAttentionState = AttentionItemState;

export interface AuthoritativeAttentionNode {
  /** The board's derived presentation identity; never a display string. */
  readonly key: string;
  readonly source: AttentionSource;
  readonly itemId: string;
  readonly state: AuthoritativeAttentionState;
  readonly reason: AttentionItemReason;
  /** `attention.<state>`, matching the desktop and hosted surfaces. */
  readonly semanticKey: string;
  /** `attention_reason.<reason>`, matching the desktop and hosted surfaces. */
  readonly reasonKey: string;
  readonly unread: boolean;
  readonly depth: number;
  /** The nesting parent, when the server published it as its own item. */
  readonly parentKey: string | null;
  /** The exact revision this row was observed at; deep links bind to it. */
  readonly revision: string;
  readonly observedAtMs: string;
  /**
   * Present only for a provider source, and only as the server published it.
   * A row never carries a session it was not authoritatively bound to.
   */
  readonly platformSession: {
    readonly authority: string;
    readonly kind: 'session';
    readonly id: string;
  } | null;
}

const STATE_PRECEDENCE: Readonly<Record<AuthoritativeAttentionState, number>> =
  Object.freeze({
    blocked: 0,
    needs_you: 1,
    working: 2,
    done: 3,
  });

function nodeOf(
  visible: AuthoritativeAttentionItem,
  siblings: ReadonlyMap<string, string>,
): AuthoritativeAttentionNode {
  const path = visible.item.nested_agent_path;
  const parent = path.length === 0 ? null : path[path.length - 1]!;
  return {
    depth: path.length,
    itemId: visible.item.id,
    key: visible.presentationId,
    observedAtMs: visible.item.observed_at_ms.toString(),
    parentKey: parent === null ? null : (siblings.get(parent) ?? null),
    platformSession: visible.item.platform_session,
    reason: visible.item.reason,
    reasonKey: `attention_reason.${visible.item.reason}`,
    revision: visible.item.revision.toString(),
    semanticKey: `attention.${visible.item.state}`,
    source: visible.source,
    state: visible.item.state,
    unread: visible.item.unread,
  };
}

/**
 * Every visible row, most urgent first, then unread before read, then the
 * board's own deterministic (source, item) order so two clients holding the
 * same snapshots list the same rows in the same sequence.
 */
export function projectAuthoritativeAttentionNodes(
  board: AttentionSourceBoard,
): readonly AuthoritativeAttentionNode[] {
  const visible = visibleAttentionItems(board);
  // A parent is only a parent when the server published it as its own item of
  // the same source; a dangling path element never fabricates a row.
  const siblings = new Map<string, string>();
  for (const candidate of visible) {
    siblings.set(candidate.item.id, candidate.presentationId);
  }
  const nodes = visible.map((candidate) => nodeOf(candidate, siblings));
  return Object.freeze(
    nodes
      .sort((left, right) => {
        const urgency =
          STATE_PRECEDENCE[left.state] - STATE_PRECEDENCE[right.state];
        if (urgency !== 0) return urgency;
        if (left.unread !== right.unread) return left.unread ? -1 : 1;
        return 0;
      })
      .slice(0, MAX_AUTHORITATIVE_ATTENTION_NODES),
  );
}

export interface AuthoritativeAttentionSummary {
  readonly counts: Readonly<Record<AuthoritativeAttentionState, number>>;
  readonly unread: number;
  /**
   * True when at least one source is refused or unavailable, so the surface can
   * say the board is partial instead of implying an empty inbox.
   */
  readonly partial: boolean;
  readonly hiddenSources: readonly AttentionSource[];
}

export function summarizeAuthoritativeAttention(
  board: AttentionSourceBoard,
): AuthoritativeAttentionSummary {
  const nodes = projectAuthoritativeAttentionNodes(board);
  const counts = { blocked: 0, done: 0, needs_you: 0, working: 0 };
  let unread = 0;
  for (const node of nodes) {
    counts[node.state] += 1;
    if (node.unread) unread += 1;
  }
  const hidden = unavailableAttentionSources(board);
  return Object.freeze({
    counts: Object.freeze(counts),
    hiddenSources: Object.freeze(hidden.map((entry) => entry.source)),
    partial: hidden.length > 0,
    unread,
  });
}
