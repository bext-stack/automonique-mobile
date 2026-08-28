// SPDX-License-Identifier: Elastic-2.0

import { workspaceCompanionFixture } from './workspace-fixtures';
import { decimalRevision } from './types';
import { presentWorkspaceCatalog } from './workspace-presentation';

test('fixture-driven cards expose separate task and orchestration states', () => {
  const [card] = presentWorkspaceCatalog(workspaceCompanionFixture);
  expect(card).toMatchObject({
    serverLabel: 'Delivery Europe',
    hostLabel: 'Paris builder',
    projectLabel: 'Mobile',
    externalWorkItem: {
      label: 'GitHub #34',
      title: 'Add a read-mostly workspace companion',
      status: 'open',
    },
    orchestrationStatus: 'review',
    attemptState: 'waiting',
    workSessionId: 'work-session-34',
    retainedSessionTarget: {
      authority: 'automonique',
      kind: 'session',
      id: 'session-34',
    },
    workSessionRelationRevision: '9',
    repositoryLabel: 'bext-stack/automonique-mobile',
    branchLabel: 'feat/workspace-companion-34',
    unreadAttention: 2,
    readOnly: true,
  });
});

test.each([
  '#34',
  'paris',
  'mobile',
  'automonique-mobile',
  'workspace',
  'read-mostly',
])('finds a scoped workspace by %s', (query) => {
  expect(
    presentWorkspaceCatalog(workspaceCompanionFixture, query),
  ).toHaveLength(1);
});

test('selects an eligible retained session deterministically', () => {
  const catalog = {
    ...workspaceCompanionFixture,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      workspaces: server.workspaces.map((workspace) => ({
        ...workspace,
        sessions: [
          {
            ...workspace.sessions[0]!,
            id: 'lost-first',
            target: { ...workspace.sessions[0]!.target, id: 'lost-first' },
            revision: decimalRevision('99'),
            state: 'lost' as const,
          },
          {
            ...workspace.sessions[0]!,
            id: 'waiting-newer',
            target: { ...workspace.sessions[0]!.target, id: 'waiting-newer' },
            revision: decimalRevision('11'),
            state: 'waiting' as const,
          },
          {
            ...workspace.sessions[0]!,
            id: 'active-current',
            target: { ...workspace.sessions[0]!.target, id: 'active-current' },
            revision: decimalRevision('10'),
            state: 'active' as const,
          },
        ],
      })),
    })),
  };

  expect(presentWorkspaceCatalog(catalog)[0]).toMatchObject({
    workSessionId: 'active-current',
    retainedSessionTarget: {
      authority: 'automonique',
      kind: 'session',
      id: 'active-current',
    },
    workSessionRelationRevision: '10',
  });
});

test('revoked profiles disappear from presentation', () => {
  const revoked = {
    ...workspaceCompanionFixture,
    servers: workspaceCompanionFixture.servers.map((server) => ({
      ...server,
      authorization: 'revoked' as const,
    })),
  };
  expect(presentWorkspaceCatalog(revoked)).toEqual([]);
});
