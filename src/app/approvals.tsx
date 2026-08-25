// SPDX-License-Identifier: Elastic-2.0

import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import type { ApprovalSummary } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function ApprovalsScreen() {
  const { snapshot, busyAction, decideApproval } = useMobile();
  const palette = usePalette();
  const enabled = snapshot.connection.mutationsAllowed && busyAction === null;

  async function decide(approval: ApprovalSummary, decision: 'grant' | 'deny') {
    try {
      await decideApproval(approval, decision);
    } catch (error) {
      Alert.alert(
        'Decision not recorded',
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  return (
    <Screen>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.text }]}
      >
        Pending approvals
      </Text>
      {snapshot.approvals.length === 0 && (
        <Text style={{ color: palette.textMuted }}>
          No bounded approvals are pending.
        </Text>
      )}
      {snapshot.approvals.map((approval) => (
        <View
          key={approval.target.coordinate.id}
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {approval.title}
          </Text>
          <Text style={[styles.detail, { color: palette.text }]}>
            {approval.detail}
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            {approval.impact}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            revision {approval.target.revision} · {approval.requester}
          </Text>
          <View style={styles.actions}>
            {(['deny', 'grant'] as const).map((decision) => (
              <Pressable
                key={decision}
                accessibilityRole="button"
                accessibilityLabel={`${decision} ${approval.title} at revision ${approval.target.revision}`}
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                onPress={() => void decide(approval, decision)}
                style={[
                  styles.action,
                  {
                    borderColor:
                      decision === 'grant' ? palette.accent : palette.danger,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      decision === 'grant' ? palette.accent : palette.danger,
                    fontWeight: '800',
                  }}
                >
                  {decision}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  cardTitle: { fontSize: 18, fontWeight: '800' },
  detail: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 11 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
