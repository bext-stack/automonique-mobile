// SPDX-License-Identifier: Elastic-2.0

import {
  ProjectId,
  UserWorkspaceId,
  type WorkContextRecord,
} from '@automonique/sdk';

import {
  deriveAttentionSourceInventory,
  providerSessionBinding,
} from './attention-source-inventory';

const target = {
  project: ProjectId('project-35'),
  userWorkspace: UserWorkspaceId('workspace-35'),
};

function record(
  identity: WorkContextRecord['identity'],
  relations: WorkContextRecord['relations'] = [],
): WorkContextRecord {
  return {
    attributes: { checkout: null, host_setup: null },
    identity,
    label: 'label',
    lifecycle: 'active',
    relations,
    revision: 1n,
  } as WorkContextRecord;
}

function workspaceRecord(project = target.project): WorkContextRecord {
  return record({ id: target.userWorkspace, kind: 'user_workspace' }, [
    {
      kind: 'user_workspace_project',
      target: { id: project, kind: 'project' },
    },
  ]);
}

function attemptRecord(id: string): WorkContextRecord {
  return record(
    { id, kind: 'attempt_workspace' } as WorkContextRecord['identity'],
    [
      {
        kind: 'attempt_user_workspace',
        target: { id: target.userWorkspace, kind: 'user_workspace' },
      },
    ],
  );
}

function sessionRecord(
  id: string,
  attempt: string,
  session: { authority: string; kind: string; id: string } = {
    authority: 'automonique',
    id: 'platform-session-1',
    kind: 'session',
  },
): WorkContextRecord {
  return record({ id, kind: 'session' } as WorkContextRecord['identity'], [
    {
      kind: 'session_attempt_workspace',
      target: {
        id: attempt,
        kind: 'attempt_workspace',
      } as WorkContextRecord['relations'][number]['target'],
    },
    {
      kind: 'session_platform_session',
      target: {
        kind: 'platform_session',
        resource: session,
      } as WorkContextRecord['relations'][number]['target'],
    },
  ]);
}

describe('attention source inventory', () => {
  it('always inventories orchestration and adds review only when present', () => {
    const records = [workspaceRecord()];
    expect(
      deriveAttentionSourceInventory(target, records, 'absent').sources,
    ).toEqual([{ id: target.userWorkspace, kind: 'orchestration' }]);
    expect(
      deriveAttentionSourceInventory(target, records, 'present').sources,
    ).toEqual([
      { id: target.userWorkspace, kind: 'orchestration' },
      { id: target.userWorkspace, kind: 'review' },
    ]);
  });

  it('inventories a provider source only through the attempt of this workspace', () => {
    const inventory = deriveAttentionSourceInventory(
      target,
      [
        workspaceRecord(),
        attemptRecord('attempt-1'),
        sessionRecord('session-1', 'attempt-1'),
        // An attempt of another workspace contributes nothing.
        record(
          {
            id: 'attempt-foreign',
            kind: 'attempt_workspace',
          } as WorkContextRecord['identity'],
          [
            {
              kind: 'attempt_user_workspace',
              target: {
                id: UserWorkspaceId('workspace-other'),
                kind: 'user_workspace',
              },
            },
          ],
        ),
        sessionRecord('session-foreign', 'attempt-foreign'),
      ],
      'absent',
    );
    expect(
      inventory.sources.filter((source) => source.kind === 'provider_session'),
    ).toEqual([{ id: 'session-1', kind: 'provider_session' }]);
    expect(
      providerSessionBinding(inventory, {
        id: 'session-1',
        kind: 'provider_session',
      }),
    ).toEqual({
      authority: 'automonique',
      id: 'platform-session-1',
      kind: 'session',
    });
  });

  it('refuses a provider session without an exact automonique binding', () => {
    for (const binding of [
      { authority: 'github', id: 'x', kind: 'session' },
      { authority: 'automonique', id: 'x', kind: 'pane' },
    ]) {
      expect(() =>
        deriveAttentionSourceInventory(
          target,
          [
            workspaceRecord(),
            attemptRecord('attempt-1'),
            sessionRecord('session-1', 'attempt-1', binding),
          ],
          'absent',
        ),
      ).toThrow('attention_provider_relation_invalid');
    }
  });

  it('refuses an ambiguous relation rather than taking the first match', () => {
    const ambiguous = record(
      { id: 'session-1', kind: 'session' } as WorkContextRecord['identity'],
      [
        {
          kind: 'session_attempt_workspace',
          target: {
            id: 'attempt-1',
            kind: 'attempt_workspace',
          } as WorkContextRecord['relations'][number]['target'],
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: { authority: 'automonique', id: 'a', kind: 'session' },
          } as WorkContextRecord['relations'][number]['target'],
        },
        {
          kind: 'session_platform_session',
          target: {
            kind: 'platform_session',
            resource: { authority: 'automonique', id: 'b', kind: 'session' },
          } as WorkContextRecord['relations'][number]['target'],
        },
      ],
    );
    expect(() =>
      deriveAttentionSourceInventory(
        target,
        [workspaceRecord(), attemptRecord('attempt-1'), ambiguous],
        'absent',
      ),
    ).toThrow('attention_provider_relation_invalid');
  });

  it('refuses a missing, duplicated, or wrongly parented workspace', () => {
    expect(() => deriveAttentionSourceInventory(target, [], 'absent')).toThrow(
      'attention_workspace_missing_or_ambiguous',
    );
    expect(() =>
      deriveAttentionSourceInventory(
        target,
        [workspaceRecord(ProjectId('project-other'))],
        'absent',
      ),
    ).toThrow('attention_workspace_project_mismatch');
    expect(() =>
      deriveAttentionSourceInventory(
        target,
        [workspaceRecord(), workspaceRecord()],
        'absent',
      ),
    ).toThrow('attention_inventory_duplicate_record');
  });

  it('refuses an inventory larger than the read bound', () => {
    const records = [
      workspaceRecord(),
      ...Array.from({ length: 512 }, (_unused, index) =>
        record({
          id: `attempt-${index}`,
          kind: 'attempt_workspace',
        } as WorkContextRecord['identity']),
      ),
    ];
    expect(() =>
      deriveAttentionSourceInventory(target, records, 'absent'),
    ).toThrow('attention_inventory_too_large');
  });
});
