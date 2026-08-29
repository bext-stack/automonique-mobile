// SPDX-License-Identifier: Elastic-2.0

import {
  ProjectId,
  UserWorkspaceId,
  type AttentionSource,
  type WorkContextRecord,
} from '@automonique/sdk';
import {
  createAttentionConformanceCorpus,
  type AttentionConformanceCase,
} from '@automonique/sdk/testing';

import {
  applyAttentionSnapshot,
  attentionSourceStatus,
  createAttentionSourceBoard,
  markAttentionSourceRefused,
  markAttentionSourceUnavailable,
  retainedAttentionSnapshot,
  visibleAttentionItems,
  type AttentionSourceBoard,
} from './attention-source-board';
import { deriveAttentionSourceInventory } from './attention-source-inventory';

/**
 * The same corpus ShellDeck replays. It is the only thing that says the two
 * clients agree about what a sequence of reads means, so a divergence here is
 * a product bug rather than a test-fixture disagreement.
 */

const target = {
  project: ProjectId('project-conformance'),
  userWorkspace: UserWorkspaceId('workspace-conformance'),
};

function record(
  identity: WorkContextRecord['identity'],
  relations: WorkContextRecord['relations'] = [],
): WorkContextRecord {
  return {
    attributes: { checkout: null, host_setup: null },
    identity,
    label: 'record',
    lifecycle: 'active',
    relations,
    revision: 1n,
  } as WorkContextRecord;
}

/**
 * The graph the corpus target implies, mirroring the desktop replay: one
 * workspace in its project, one attempt under it, and one session bound to an
 * exact Platform session.
 */
function corpusRecords(): readonly WorkContextRecord[] {
  return [
    record({ id: target.userWorkspace, kind: 'user_workspace' }, [
      {
        kind: 'user_workspace_project',
        target: { id: target.project, kind: 'project' },
      },
    ]),
    record(
      {
        id: 'attempt-conformance',
        kind: 'attempt_workspace',
      } as WorkContextRecord['identity'],
      [
        {
          kind: 'attempt_user_workspace',
          target: { id: target.userWorkspace, kind: 'user_workspace' },
        },
      ],
    ),
    record(
      {
        id: 'session-conformance',
        kind: 'session',
      } as WorkContextRecord['identity'],
      [
        {
          kind: 'session_attempt_workspace',
          target: {
            id: 'attempt-conformance',
            kind: 'attempt_workspace',
          } as WorkContextRecord['relations'][number]['target'],
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: {
              authority: 'automonique',
              id: 'platform-session-conformance',
              kind: 'session',
            },
          } as WorkContextRecord['relations'][number]['target'],
        },
      ],
    ),
  ];
}

const REFUSALS: Readonly<Record<string, string>> = {
  initial_revision_required: 'attention_initial_revision_required',
  invalid_successor: 'attention_successor_invalid',
  conflicting_replay: 'attention_conflicting_replay',
  baseline_invalid: 'attention_baseline_invalid',
};

function replay(
  entry: AttentionConformanceCase,
  source: AttentionSource,
): AttentionSourceBoard {
  const inventory = deriveAttentionSourceInventory(
    target,
    corpusRecords(),
    'present',
  );
  expect(
    inventory.sources.some(
      (candidate) =>
        candidate.kind === source.kind && candidate.id === source.id,
    ),
  ).toBe(true);

  let board = createAttentionSourceBoard(target, inventory.sources);
  for (const read of entry.reads) {
    if (read.kind === 'refusal') {
      board = markAttentionSourceRefused(board, source, read.category);
      continue;
    }
    if (read.kind === 'unavailable') {
      board = markAttentionSourceUnavailable(board, source, read.reason);
      continue;
    }
    const refusal = REFUSALS[read.outcome];
    if (refusal === undefined) {
      const applied = applyAttentionSnapshot(board, source, read.snapshot, {
        mode: read.mode,
      });
      expect(applied.outcome).toBe(read.outcome);
      board = applied.board;
      continue;
    }
    expect(() =>
      applyAttentionSnapshot(board, source, read.snapshot, { mode: read.mode }),
    ).toThrow(refusal);
  }
  return board;
}

describe('shared attention succession corpus', () => {
  const corpus = createAttentionConformanceCorpus();

  it('declares the target this client derives its inventory for', () => {
    expect(corpus.schema).toBe('automonique.attention-conformance/v1');
    expect(corpus.target).toEqual({
      project: 'project-conformance',
      user_workspace: 'workspace-conformance',
    });
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  it.each(corpus.cases.map((entry) => [entry.id, entry] as const))(
    'replays %s to the recorded outcome',
    (_id, entry) => {
      const source = entry.source;
      const board = replay(entry, source);

      expect(attentionSourceStatus(board, source).kind === 'available').toBe(
        entry.expected.available,
      );
      expect(
        visibleAttentionItems(board)
          .filter(
            (visible) =>
              visible.source.kind === source.kind &&
              visible.source.id === source.id,
          )
          .map((visible) => visible.item.id),
      ).toEqual(entry.expected.visible_items);

      // Hiding a source must not discard its revision chain: a client that
      // forgot where it was could only resynchronize by trusting whatever the
      // next read claims.
      const everAccepted = entry.reads.some(
        (read) =>
          read.kind === 'snapshot' &&
          (read.outcome === 'inserted' || read.outcome === 'replaced'),
      );
      expect(retainedAttentionSnapshot(board, source) !== null).toBe(
        everAccepted,
      );
    },
  );
});
