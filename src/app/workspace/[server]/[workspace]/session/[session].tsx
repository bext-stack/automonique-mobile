// SPDX-License-Identifier: Elastic-2.0

import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { Screen } from '@/components/screen';
import {
  admitWorkspaceDeepLink,
  type ServerIdentity,
} from '@/core/workspace-companion';
import { decimalRevision } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

export default function ExactWorkspaceSessionLink() {
  const params = useLocalSearchParams<{
    server: string;
    workspace: string;
    revision: string;
    session: string;
    session_revision: string;
  }>();
  const palette = usePalette();
  const { catalog } = useWorkspaces();
  const { snapshot } = useMobile();
  let admitted = false;
  try {
    admitWorkspaceDeepLink(catalog, {
      serverIdentity: params.server as ServerIdentity,
      workspaceId: params.workspace,
      workspaceRevision: decimalRevision(params.revision),
      destination: 'chat',
      sessionId: params.session,
      sessionRevision: decimalRevision(params.session_revision),
    });
    admitted = snapshot.sessions.some(
      (session) => session.target.coordinate.id === params.session,
    );
  } catch {
    admitted = false;
  }
  if (admitted) {
    return (
      <Redirect
        href={{ pathname: '/session/[id]', params: { id: params.session } }}
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
