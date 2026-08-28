// SPDX-License-Identifier: Elastic-2.0

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PreparedWorkspaceMutation } from '@/core/workspace-v2-gateway';
import { usePalette } from '@/theme/palette';

export interface WorkspaceMutationAuthorityPreview {
  readonly serverIdentity: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly workspaceRevision: string;
  readonly externalWorkItem: {
    readonly provider: string;
    readonly key: string;
    readonly title: string;
  };
}

const AUTHORITY_AXES = [
  'filesystem',
  'network',
  'providers',
  'models',
  'tools',
  'credentials',
] as const;

export function WorkspaceMutationConfirmation({
  prepared,
  authorityPreview,
  busy = false,
  onConfirm,
  onDeny,
}: {
  readonly prepared: PreparedWorkspaceMutation;
  readonly authorityPreview: WorkspaceMutationAuthorityPreview;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onDeny: () => void;
}) {
  const palette = usePalette();
  const { preview } = prepared;
  const authority = AUTHORITY_AXES.map((axis) => ({
    axis,
    inherited: preview.inherited_authority[axis].length,
    effective: preview.effective_authority[axis].length,
  })).filter((entry) => entry.inherited > 0 || entry.effective > 0);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel="Workspace authority preview"
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.warning },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.text }]}
      >
        Confirm workspace change
      </Text>
      <Text style={[styles.copy, { color: palette.textMuted }]}>
        This is a server-issued preview. Nothing runs until you confirm this
        exact revision.
      </Text>
      <View style={styles.details}>
        <Text style={[styles.detail, { color: palette.text }]}>
          Action · {preview.proposal.intent.kind.replaceAll('_', ' ')}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Project · {prepared.project}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Server · {authorityPreview.serverIdentity}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Workspace · {authorityPreview.workspaceId} revision{' '}
          {authorityPreview.workspaceRevision}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          External task · {authorityPreview.externalWorkItem.provider} /{' '}
          {authorityPreview.externalWorkItem.key} ·{' '}
          {authorityPreview.externalWorkItem.title}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Result · {preview.resulting.label} ({preview.resulting.lifecycle})
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Preview revision · {preview.preview.revision.toString()}
        </Text>
        <Text style={[styles.detail, { color: palette.text }]}>
          Server approval · {preview.approval.replaceAll('_', ' ')}
        </Text>
      </View>
      <View
        accessibilityLabel="Effective workspace authority"
        style={[styles.authority, { backgroundColor: palette.surfaceMuted }]}
      >
        <Text style={[styles.authorityTitle, { color: palette.text }]}>
          Authority ceiling
        </Text>
        {authority.length === 0 ? (
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            No authority grants requested.
          </Text>
        ) : (
          authority.map((entry) => (
            <Text
              key={entry.axis}
              style={[styles.meta, { color: palette.textMuted }]}
            >
              {entry.axis} · {entry.effective} effective of {entry.inherited}{' '}
              inherited
            </Text>
          ))
        )}
      </View>
      <Text style={[styles.meta, { color: palette.textMuted }]}>
        Expires {new Date(Number(preview.expires_at_ms)).toISOString()}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deny workspace change"
          disabled={busy}
          onPress={onDeny}
          style={[
            styles.secondary,
            { borderColor: palette.border },
            busy && styles.disabled,
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>Deny</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm exact workspace change"
          disabled={busy}
          onPress={onConfirm}
          style={[
            styles.primary,
            { backgroundColor: palette.accent },
            busy && styles.disabled,
          ]}
        >
          <Text style={{ color: palette.accentText, fontWeight: '800' }}>
            Confirm exact change
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  copy: { fontSize: 14, lineHeight: 20 },
  details: { gap: 5 },
  detail: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  authority: { borderRadius: 12, padding: 12, gap: 4 },
  authorityTitle: { fontSize: 13, fontWeight: '800' },
  meta: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10 },
  secondary: {
    minHeight: 48,
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    minHeight: 48,
    flex: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
});
