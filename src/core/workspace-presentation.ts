// SPDX-License-Identifier: Elastic-2.0

import type {
  CompanionWorkspace,
  ServerIdentity,
  WorkspaceCompanionCatalog,
} from './workspace-companion';

export interface WorkspaceCardModel {
  readonly key: string;
  readonly serverIdentity: ServerIdentity;
  readonly serverLabel: string;
  readonly hostLabel: string;
  readonly projectLabel: string;
  readonly workspaceId: string;
  readonly workspaceRevision: CompanionWorkspace['revision'];
  readonly title: string;
  readonly externalWorkItem: {
    readonly label: string;
    readonly title: string;
    readonly status: NonNullable<
      CompanionWorkspace['externalWorkItem']
    >['status'];
  } | null;
  readonly orchestrationStatus: CompanionWorkspace['orchestrationStatus'];
  readonly attemptState:
    NonNullable<CompanionWorkspace['attempt']>['state'] | null;
  readonly sessionCount: number;
  readonly retainedSessionId: string | null;
  readonly retainedSessionRevision: CompanionWorkspace['revision'] | null;
  readonly repositoryLabel: string | null;
  readonly branchLabel: string | null;
  readonly freshness: CompanionWorkspace['freshness'];
  readonly unreadAttention: number;
  readonly readOnly: boolean;
}

function retainedSession(
  workspace: CompanionWorkspace,
): CompanionWorkspace['sessions'][number] | null {
  const statePriority = { active: 0, waiting: 1 } as const;
  return (
    [...workspace.sessions]
      .filter(
        (
          session,
        ): session is typeof session & { state: 'active' | 'waiting' } =>
          session.state === 'active' || session.state === 'waiting',
      )
      .sort((left, right) => {
        const state = statePriority[left.state] - statePriority[right.state];
        if (state !== 0) return state;
        const revision = BigInt(right.revision) - BigInt(left.revision);
        if (revision !== 0n) return revision > 0n ? 1 : -1;
        return left.id.localeCompare(right.id);
      })[0] ?? null
  );
}

export function presentWorkspaceCatalog(
  catalog: WorkspaceCompanionCatalog,
  query = '',
): readonly WorkspaceCardModel[] {
  const needle = query.trim().toLocaleLowerCase();
  const cards = catalog.servers
    .filter((server) => server.authorization !== 'revoked')
    .flatMap((server) =>
      server.workspaces.map((workspace): WorkspaceCardModel => {
        const resumableSession = retainedSession(workspace);
        const host = server.hosts.find(
          (entry) => entry.id === workspace.hostId,
        );
        const project = server.projects.find(
          (entry) => entry.id === workspace.projectId,
        );
        if (host === undefined || project === undefined) {
          throw new Error('workspace_presentation_scope_invalid');
        }
        return {
          key: `${server.serverIdentity}:${workspace.id}`,
          serverIdentity: server.serverIdentity,
          serverLabel: server.label,
          hostLabel: host.label,
          projectLabel: project.label,
          workspaceId: workspace.id,
          workspaceRevision: workspace.revision,
          title: workspace.title,
          externalWorkItem:
            workspace.externalWorkItem === null
              ? null
              : {
                  label: `${workspace.externalWorkItem.provider} ${workspace.externalWorkItem.key}`,
                  title: workspace.externalWorkItem.title,
                  status: workspace.externalWorkItem.status,
                },
          orchestrationStatus: workspace.orchestrationStatus,
          attemptState: workspace.attempt?.state ?? null,
          sessionCount: workspace.sessions.length,
          retainedSessionId: resumableSession?.id ?? null,
          retainedSessionRevision: resumableSession?.revision ?? null,
          repositoryLabel: workspace.repository?.label ?? null,
          branchLabel: workspace.branch?.label ?? null,
          freshness: workspace.freshness,
          unreadAttention: workspace.unreadAttention,
          readOnly: true,
        };
      }),
    );
  if (needle.length === 0) return cards;
  return cards.filter((card) =>
    [
      card.serverLabel,
      card.hostLabel,
      card.projectLabel,
      card.title,
      card.externalWorkItem?.label,
      card.externalWorkItem?.title,
      card.repositoryLabel,
      card.branchLabel,
    ].some((value) => value?.toLocaleLowerCase().includes(needle)),
  );
}
