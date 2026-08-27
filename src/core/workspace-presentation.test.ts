// SPDX-License-Identifier: Elastic-2.0

import { workspaceCompanionFixture } from './workspace-fixtures';
import { presentWorkspaceCatalog } from './workspace-presentation';

test('fixture-driven cards expose separate task and orchestration states', () => {
  const [card] = presentWorkspaceCatalog(workspaceCompanionFixture);
  expect(card).toMatchObject({
    serverLabel: 'Delivery Europe',
    hostLabel: 'Paris builder',
    projectLabel: 'Mobile',
    externalWorkItem: { label: 'GitHub #34', status: 'open' },
    orchestrationStatus: 'review',
    attemptState: 'waiting',
    retainedSessionId: 'session-34',
    repositoryLabel: 'bext-stack/automonique-mobile',
    branchLabel: 'feat/workspace-companion-34',
    unreadAttention: 2,
    readOnly: true,
  });
});

test.each(['#34', 'paris', 'mobile', 'automonique-mobile', 'workspace'])(
  'finds a scoped workspace by %s',
  (query) => {
    expect(
      presentWorkspaceCatalog(workspaceCompanionFixture, query),
    ).toHaveLength(1);
  },
);

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
