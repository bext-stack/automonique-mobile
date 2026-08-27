// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  admitWorkspaceDeepLink,
  workspaceMutationAvailability,
  type ServerIdentity,
  type WorkspaceDestination,
} from '@/core/workspace-companion';
import { decimalRevision } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

const MAX_WORKSPACE_DRAFT_BYTES = 4_096;

function destinationTitle(destination: WorkspaceDestination): string {
  return destination === 'source_control'
    ? 'Source control'
    : destination[0]!.toUpperCase() + destination.slice(1);
}

function draftKey(server: string, workspace: string, revision: string): string {
  return `automonique.mobile.workspace-draft.v1:${server}:${workspace}:r${revision}`;
}

function DestinationControl({
  destination,
  enabled,
  href,
}: {
  readonly destination: Exclude<WorkspaceDestination, 'chat'>;
  readonly enabled: boolean;
  readonly href: {
    readonly pathname: '/workspace/[server]/[workspace]';
    readonly params: Readonly<Record<string, string>>;
  };
}) {
  const palette = usePalette();
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={`${destinationTitle(destination)}${enabled ? '' : ', unavailable without a separate current grant'}`}
      disabled={!enabled}
      style={{
        alignItems: 'center',
        backgroundColor: enabled ? palette.surface : palette.surfaceMuted,
        borderColor: palette.border,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 46,
        opacity: enabled ? 1 : 0.68,
        paddingHorizontal: 13,
      }}
    >
      <Text
        style={{
          color: enabled ? palette.text : palette.textMuted,
          fontWeight: '800',
        }}
      >
        {destinationTitle(destination)}
      </Text>
    </Pressable>
  );
  return enabled ? (
    <Link asChild href={href}>
      {button}
    </Link>
  ) : (
    button
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: palette.text }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function WorkspaceDetailScreen() {
  const params = useLocalSearchParams<{
    server: string;
    workspace: string;
    revision?: string;
    destination?: WorkspaceDestination;
  }>();
  const palette = usePalette();
  const { catalog, findServer, findWorkspace, findDetail, status } =
    useWorkspaces();
  const { snapshot } = useMobile();
  const server = findServer(params.server);
  const workspace = findWorkspace(params.server, params.workspace);
  const detail = findDetail(params.server, params.workspace);
  const [draft, setDraft] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const mutation = workspaceMutationAvailability();
  const exactRevision = workspace?.revision === params.revision;

  useEffect(() => {
    if (workspace === null || !exactRevision) return;
    let active = true;
    const key = draftKey(params.server, params.workspace, workspace.revision);
    void AsyncStorage.getItem(key)
      .then((value) => {
        if (!active) return;
        if (
          value !== null &&
          new TextEncoder().encode(value).byteLength <=
            MAX_WORKSPACE_DRAFT_BYTES
        ) {
          setDraft(value);
        } else if (value !== null) {
          void AsyncStorage.removeItem(key).catch(() => undefined);
        }
        setDraftLoaded(true);
      })
      .catch(() => {
        if (active) setDraftLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [exactRevision, params.server, params.workspace, workspace]);

  useEffect(() => {
    if (workspace === null || !draftLoaded || !exactRevision) return;
    const key = draftKey(params.server, params.workspace, workspace.revision);
    if (
      new TextEncoder().encode(draft).byteLength <= MAX_WORKSPACE_DRAFT_BYTES
    ) {
      void AsyncStorage.setItem(key, draft).catch(() => undefined);
    }
  }, [
    draft,
    draftLoaded,
    exactRevision,
    params.server,
    params.workspace,
    workspace,
  ]);

  if (server === null || workspace === null || !exactRevision) {
    return (
      <Screen>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Workspace unavailable
        </Text>
        <Text style={{ color: palette.textMuted }}>
          The exact server, workspace, and revision are not present in the
          admitted catalog.
        </Text>
      </Screen>
    );
  }

  const destination = params.destination;
  let destinationAdmitted = destination === undefined;
  if (destination !== undefined) {
    try {
      admitWorkspaceDeepLink(catalog, {
        serverIdentity: params.server as ServerIdentity,
        workspaceId: workspace.id,
        workspaceRevision: decimalRevision(workspace.revision),
        destination,
        sessionId: null,
        sessionRevision: null,
      });
      destinationAdmitted = true;
    } catch {
      destinationAdmitted = false;
    }
  }
  const granted = (value: WorkspaceDestination) =>
    workspace.navigation.some(
      (grant) =>
        grant.destination === value && grant.revision === workspace.revision,
    );
  const liveDetail =
    status.phase === 'live' &&
    server.authorization === 'active' &&
    detail !== null;
  const routeParams = (value: WorkspaceDestination) => ({
    server: params.server,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: value,
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {workspace.title}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {server.label} · revision {workspace.revision} ·{' '}
          {server.authorization === 'active'
            ? 'current grant'
            : 'cached read only'}
        </Text>
      </View>

      <Section title="Location">
        <Text style={[styles.value, { color: palette.text }]}>
          {server.projects.find((project) => project.id === workspace.projectId)
            ?.label ?? 'Unknown project'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Host:{' '}
          {server.hosts.find((host) => host.id === workspace.hostId)?.label ??
            'Unknown host'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Repository:{' '}
          {workspace.repository?.label ?? 'not reported by Platform v2'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Branch: {workspace.branch?.label ?? 'not reported by Platform v2'}
        </Text>
      </Section>

      <View style={styles.twoColumn}>
        <Section title="External task status">
          {workspace.externalWorkItem === null ? (
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              No typed external work item was reported.
            </Text>
          ) : (
            <>
              <Text style={[styles.value, { color: palette.text }]}>
                {workspace.externalWorkItem.provider}{' '}
                {workspace.externalWorkItem.key}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                {workspace.externalWorkItem.title}
              </Text>
              <Text style={[styles.statusValue, { color: palette.text }]}>
                {workspace.externalWorkItem.status}
              </Text>
            </>
          )}
        </Section>
        <Section title="Orchestration status">
          <Text style={[styles.value, { color: palette.text }]}>
            {workspace.orchestrationStatus}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            Attempt:{' '}
            {workspace.attempt === null
              ? 'not reported'
              : `${workspace.attempt.state} · revision ${workspace.attempt.revision}`}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            Freshness: {workspace.freshness.state} ·{' '}
            {workspace.freshness.observedAt}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {workspace.unreadAttention} unread attention
          </Text>
        </Section>
      </View>

      <Section title="Retained sessions">
        {workspace.sessions.map((session) => {
          const retained = snapshot.sessions.some(
            (candidate) => candidate.target.coordinate.id === session.id,
          );
          const enabled = retained && granted('chat');
          const sessionButton = (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              style={{
                backgroundColor: enabled
                  ? palette.surfaceMuted
                  : palette.background,
                borderRadius: 12,
                gap: 3,
                minHeight: 52,
                opacity: enabled ? 1 : 0.65,
                padding: 12,
              }}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                {session.title}
              </Text>
              <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                {session.state} · revision {session.revision}
                {retained ? '' : ' · not in retained mobile projection'}
              </Text>
            </Pressable>
          );
          return enabled ? (
            <Link
              key={session.id}
              asChild
              href={{
                pathname: '/workspace/[server]/[workspace]/session/[session]',
                params: {
                  server: params.server,
                  workspace: workspace.id,
                  revision: workspace.revision,
                  session: session.id,
                  session_revision: session.revision,
                },
              }}
            >
              {sessionButton}
            </Link>
          ) : (
            <View key={session.id}>{sessionButton}</View>
          );
        })}
        {workspace.sessions.length === 0 && (
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            No typed retained-session relation was reported.
          </Text>
        )}
      </Section>

      <Section title="Read-only destinations">
        <View style={styles.destinations}>
          {(['files', 'preview', 'source_control', 'terminal'] as const).map(
            (value) => (
              <DestinationControl
                key={value}
                destination={value}
                enabled={liveDetail && granted(value)}
                href={{
                  pathname: '/workspace/[server]/[workspace]',
                  params: routeParams(value),
                }}
              />
            ),
          )}
        </View>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Files, preview, source control, and terminal are independent grants.
          Terminal relay is not granted by the current mobile v2 contract.
        </Text>
      </Section>

      {destination !== undefined && (
        <Section title={destinationTitle(destination)}>
          {!destinationAdmitted || !liveDetail ? (
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              This destination is unavailable for the exact current workspace
              grant and revision.
            </Text>
          ) : destination === 'files' ? (
            detail.review?.files.length ? (
              detail.review.files.map((file) => (
                <View key={file.id} style={styles.fileRow}>
                  <Text style={{ color: palette.text, fontWeight: '700' }}>
                    {file.path}
                  </Text>
                  <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                    {file.change} · {file.worktree} · {file.conflict}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: palette.textMuted }}>
                No changed files reported.
              </Text>
            )
          ) : destination === 'preview' ? (
            detail.review?.files
              .filter((file) => file.previewKind !== 'none')
              .map((file) => (
                <Text key={file.id} style={{ color: palette.text }}>
                  {file.path} · {file.previewKind} ·{' '}
                  {file.sanitized ? 'sanitized' : 'not sanitized'}
                </Text>
              ))
          ) : destination === 'source_control' ? (
            <>
              <Text style={{ color: palette.text }}>
                Pull request: {detail.review?.pullRequestId ?? 'not reported'}
              </Text>
              <Text style={{ color: palette.textMuted }}>
                State: {detail.review?.pullRequestState} · review:{' '}
                {detail.review?.reviewDecision} · delivery:{' '}
                {detail.review?.deliveryState}
              </Text>
            </>
          ) : (
            <Text style={{ color: palette.textMuted }}>
              No terminal relay authority is present.
            </Text>
          )}
        </Section>
      )}

      <Section title="Task context draft">
        <TextInput
          accessibilityLabel="Workspace task context draft"
          multiline
          onChangeText={(value) => {
            if (
              new TextEncoder().encode(value).byteLength <=
              MAX_WORKSPACE_DRAFT_BYTES
            )
              setDraft(value);
          }}
          placeholder="Keep notes for a later desktop create or resume action…"
          placeholderTextColor={palette.textMuted}
          style={[
            styles.draft,
            {
              backgroundColor: palette.background,
              borderColor: palette.border,
              color: palette.text,
            },
          ]}
          value={draft}
        />
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {new TextEncoder().encode(draft).byteLength} /{' '}
          {MAX_WORKSPACE_DRAFT_BYTES} bytes · stored locally for this exact
          workspace revision
        </Text>
        <View style={styles.mutations}>
          {['Create from task', 'Resume workspace'].map((label) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={`${label}, unavailable: ${mutation.reason.replaceAll('_', ' ')}`}
              disabled
              style={[
                styles.disabledMutation,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text style={{ color: palette.textMuted, fontWeight: '800' }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Unavailable: the production UI has no authority-bound create/resume
          adapter. No offline mutation is queued.
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  section: {
    borderRadius: 17,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    minWidth: 260,
    padding: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  value: { fontSize: 17, fontWeight: '800', textTransform: 'capitalize' },
  statusValue: { fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  destinations: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fileRow: { gap: 2, paddingVertical: 5 },
  draft: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 100,
    padding: 12,
    textAlignVertical: 'top',
  },
  mutations: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disabledMutation: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    opacity: 0.7,
    paddingHorizontal: 14,
  },
});
