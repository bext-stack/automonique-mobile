// SPDX-License-Identifier: Elastic-2.0

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  approvalAnnouncement,
  announceForAccessibility,
} from '@/core/accessibility';
import type { ApprovalSummary } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function ApprovalsScreen() {
  const { snapshot, busyAction, decideApproval } = useMobile();
  const palette = usePalette();
  const [observedAt] = useState(() => Date.now());
  const actionAllowed =
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('decide_approval');

  function approvalEnabled(approval: ApprovalSummary): boolean {
    const expired =
      approval.expiresAt !== null &&
      Date.parse(approval.expiresAt) <= observedAt;
    return actionAllowed && !expired && busyAction === null;
  }

  async function decide(approval: ApprovalSummary, decision: 'grant' | 'deny') {
    try {
      const receipt = await decideApproval(approval, decision);
      announceForAccessibility(
        approvalAnnouncement(approval.title, decision, receipt.outcome),
      );
    } catch (error) {
      Alert.alert(
        'Decision not recorded',
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Approvals
        </Text>
        <Text style={[styles.detail, { color: palette.textMuted }]}>
          Exact, revision-bound decisions from your authorized sessions.
        </Text>
      </View>
      {snapshot.approvals.length === 0 && (
        <View
          style={[
            styles.empty,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            You’re caught up
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            No bounded approvals are pending for this device.
          </Text>
        </View>
      )}
      {!actionAllowed && snapshot.approvals.length > 0 && (
        <Text style={[styles.detail, { color: palette.textMuted }]}>
          Approval decisions are read only for the current connection.
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
                accessibilityState={{
                  disabled: !approvalEnabled(approval),
                }}
                disabled={!approvalEnabled(approval)}
                onPress={() => void decide(approval, decision)}
                style={[
                  styles.action,
                  {
                    borderColor:
                      decision === 'grant' ? palette.accent : palette.danger,
                    opacity: approvalEnabled(approval) ? 1 : 0.45,
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
  heading: { gap: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 7 },
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
