// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  admitReviewDeepLink,
  projectAttentionNodes,
  workspaceForDetail,
} from '@/core/review-attention';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

const labels = {
  needs_you: 'Needs You',
  working: 'Working',
  blocked: 'Blocked',
  done: 'Done',
} as const;

export default function AttentionScreen() {
  const palette = usePalette();
  const {
    catalog,
    details,
    notificationPermission,
    requestReviewNotificationPermission,
    status,
  } = useWorkspaces();
  const rows = details.flatMap((detail) => {
    const workspace = workspaceForDetail(catalog, detail);
    if (workspace === null || detail.review === null) return [];
    const nodes = projectAttentionNodes(detail.review.snapshot, detail.lineage);
    let href: ReturnType<typeof admitReviewDeepLink> | null = null;
    try {
      href = admitReviewDeepLink(catalog, details, {
        serverIdentity: detail.serverIdentity,
        workspaceId: workspace.id,
        workspaceRevision: workspace.revision,
        reviewRevision: detail.review.revision,
        fileId: null,
        hunkId: null,
      });
    } catch {
      href = null;
    }
    return nodes.map((node) => ({ detail, href, node, workspace }));
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Attention
        </Text>
        <Text style={[styles.detail, { color: palette.textMuted }]}>
          Typed review and nested-agent state from current delegated projects.
        </Text>
      </View>
      {status.phase !== 'live' && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.warning, { color: palette.warning }]}
        >
          Cached attention is read only. Refresh the exact server grant before
          acting.
        </Text>
      )}
      <View
        style={[
          styles.permission,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Local review notifications
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            {notificationPermission === 'granted'
              ? 'Granted. Background Needs You notifications carry only exact, revalidated workspace coordinates.'
              : notificationPermission === 'denied'
                ? 'Unavailable. Change notification permission in device settings if desired.'
                : 'Permission is requested only from this explicit button.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enable local review notifications"
          accessibilityState={{
            disabled: notificationPermission !== 'undetermined',
          }}
          disabled={notificationPermission !== 'undetermined'}
          onPress={() => void requestReviewNotificationPermission()}
          style={[
            styles.permissionButton,
            {
              borderColor: palette.accent,
              opacity: notificationPermission === 'undetermined' ? 1 : 0.55,
            },
          ]}
        >
          <Text style={{ color: palette.accent, fontWeight: '800' }}>
            {notificationPermission === 'granted' ? 'Enabled' : 'Enable'}
          </Text>
        </Pressable>
      </View>
      {rows.map(({ detail, href, node, workspace }) => {
        const card = (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: href === null }}
            disabled={href === null}
            style={[
              styles.card,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                marginLeft: Math.min(node.depth, 4) * 12,
                opacity: href === null ? 0.65 : 1,
              },
            ]}
          >
            <View style={styles.row}>
              <Text style={[styles.cardTitle, { color: palette.text }]}>
                {labels[node.state]}
              </Text>
              {node.unread > 0 && (
                <View
                  accessibilityLabel={`${node.unread} unread`}
                  style={[styles.badge, { backgroundColor: palette.accent }]}
                >
                  <Text
                    style={{ color: palette.accentText, fontWeight: '900' }}
                  >
                    {node.unread}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ color: palette.text }}>{node.label}</Text>
            <Text style={[styles.meta, { color: palette.textMuted }]}>
              {workspace.title} · {node.kind} revision {node.revision} · review{' '}
              {detail.review!.revision}
            </Text>
          </Pressable>
        );
        return href === null ? (
          <View key={`${workspace.id}:${node.key}`}>{card}</View>
        ) : (
          <Link
            key={`${workspace.id}:${node.key}`}
            asChild
            href={{ pathname: href.pathname, params: href.params }}
          >
            {card}
          </Link>
        );
      })}
      {rows.length === 0 && (
        <View
          style={[
            styles.empty,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            No bounded attention records
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            The current delegated workspace inventory has no review attention.
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  detail: { fontSize: 14, lineHeight: 20 },
  warning: { fontSize: 13, fontWeight: '700', lineHeight: 19 },
  permission: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 14,
  },
  permissionButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    minHeight: 76,
    padding: 14,
  },
  empty: { borderRadius: 18, borderWidth: 1, gap: 7, padding: 18 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 11, lineHeight: 16 },
  badge: {
    borderRadius: 10,
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
});
