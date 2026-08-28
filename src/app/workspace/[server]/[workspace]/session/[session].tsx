// SPDX-License-Identifier: Elastic-2.0

import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { Screen } from '@/components/screen';
import {
  admitWorkspaceDeepLink,
  type ServerIdentity,
} from '@/core/workspace-companion';
import { decimalRevision, type Coordinate } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

export default function ExactWorkspaceSessionLink() {
  const params = useLocalSearchParams<{
    server: string;
    tenant: string;
    workspace: string;
    revision: string;
    session: string;
    work_session: string;
    relation_revision: string;
    session_revision: string;
    session_authority: string;
    session_kind: string;
    principal_generation: string;
    authorization_revision: string;
  }>();
  const palette = usePalette();
  const { catalog, findServer, findWorkspace, status } = useWorkspaces();
  const { snapshot } = useMobile();
  const { state: lifecycleState } = useMobileLifecycle();
  let admitted = false;
  try {
    const server = findServer(params.server);
    const workspace = findWorkspace(params.server, params.workspace);
    if (
      lifecycleState.phase !== 'ready' ||
      lifecycleState.profile?.serverIdentity !== params.server ||
      server === null ||
      workspace === null ||
      server.tenantId !== params.tenant ||
      catalog.phase !== 'live' ||
      status.phase !== 'live' ||
      server.authorization !== 'active' ||
      server.authorizationRevision !== params.authorization_revision ||
      server.principalGeneration !== params.principal_generation ||
      server.staleProjectIds.includes(workspace.projectId)
    ) {
      throw new Error('workspace_session_scope_not_current');
    }
    admitWorkspaceDeepLink(catalog, {
      serverIdentity: params.server as ServerIdentity,
      tenantId: params.tenant,
      authorizationRevision: decimalRevision(params.authorization_revision),
      principalGeneration: decimalRevision(params.principal_generation),
      workspaceId: params.workspace,
      workspaceRevision: decimalRevision(params.revision),
      destination: 'chat',
      workSessionId: params.work_session,
      sessionRelationRevision: decimalRevision(params.relation_revision),
      retainedTarget: {
        coordinate: {
          authority: params.session_authority as Coordinate['authority'],
          kind: params.session_kind as Coordinate['kind'],
          id: params.session,
        },
        revision: decimalRevision(params.session_revision),
      },
    });
    admitted = snapshot.sessions.some(
      (session) =>
        session.target.coordinate.authority === params.session_authority &&
        session.target.coordinate.kind === params.session_kind &&
        session.target.coordinate.id === params.session &&
        session.target.revision === params.session_revision,
    );
  } catch {
    admitted = false;
  }
  if (admitted) {
    return (
      <Redirect
        href={{
          pathname: '/session/[id]',
          params: {
            id: params.session,
            scope_server: params.server,
            scope_tenant: params.tenant,
            scope_workspace: params.workspace,
            scope_workspace_revision: params.revision,
            scope_work_session: params.work_session,
            scope_relation_revision: params.relation_revision,
            scope_authority: params.session_authority,
            scope_kind: params.session_kind,
            scope_session_revision: params.session_revision,
            scope_principal_generation: params.principal_generation,
            scope_authorization_revision: params.authorization_revision,
          },
        }}
      />
    );
  }
  return (
    <Screen>
      <Text
        accessibilityRole="header"
        style={{ color: palette.text, fontSize: 24, fontWeight: '800' }}
      >
        Retained session unavailable
      </Text>
      <Text style={{ color: palette.textMuted }}>
        The exact server, workspace, workspace revision, session relation, and
        retained mobile session must all still match.
      </Text>
    </Screen>
  );
}
