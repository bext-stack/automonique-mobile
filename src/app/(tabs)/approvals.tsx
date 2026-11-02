// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Link } from 'expo-router';
import { ConnectionBanner } from '@/components/connection-banner';
import { Screen } from '@/components/screen';
import {
  approvalAnnouncement,
  announceForAccessibility,
} from '@/core/accessibility';
import type { ApprovalSummary } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function ApprovalsScreen() {
  return <ApprovalContent />;
}

export function ApprovalContent({
  sessionId,
}: {
  readonly sessionId?: string;
}) {
  const { t, language } = useLanguage();

  const { snapshot, busyAction, decideApproval } = useMobile();
  const palette = usePalette();
  const [observedAt, updateClock] = useState(() => Date.now());
  const [details, setDetails] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => updateClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const actionAllowed =
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('decide_approval');

  function approvalEnabled(
    approval: ApprovalSummary,
    now = observedAt,
  ): boolean {
    const expired =
      approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now;
    return actionAllowed && !expired && busyAction === null;
  }

  async function decide(approval: ApprovalSummary, decision: 'grant' | 'deny') {
    if (!approvalEnabled(approval)) return;
    try {
      const receipt = await decideApproval(approval, decision);
      announceForAccessibility(
        approvalAnnouncement(approval.title, decision, receipt.outcome),
      );
    } catch (error) {
      Alert.alert(
        t('Decision not recorded'),
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  const approvals = snapshot.approvals.filter(
    (a) => !sessionId || a.session.coordinate.id === sessionId,
  );
  const Container = sessionId ? View : Screen;
  if (sessionId && approvals.length === 0) return null;
  return (
    <Container {...(sessionId ? {} : { showConnectionBanner: false })}>
      {!sessionId && <ConnectionBanner compact />}
      {approvals.length > 0 && (
        <View style={styles.heading}>
          <Text style={[styles.title, { color: palette.text }]}>
            {approvals.length} {t('decisions to review')}
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            {t('Review the impact before approving.')}
          </Text>
        </View>
      )}
      {approvals.length === 0 && (
        <View
          style={[
            styles.empty,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {snapshot.connection.phase === 'live'
              ? t('You’re caught up')
              : t('Saved status')}
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            {t('No bounded approvals are pending for this device.')}
          </Text>
          <Link href="/(tabs)/work" asChild>
            <Pressable
              accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.accent, fontSize: 14 }}>
                {t('View ticket queue')} →
              </Text>
            </Pressable>
          </Link>
        </View>
      )}
      {!actionAllowed && approvals.length > 0 && (
        <Text style={[styles.detail, { color: palette.textMuted }]}>
          {t('Approval decisions are read only for the current connection.')}
        </Text>
      )}
      {approvals.map((approval) => (
        <View
          key={approval.target.coordinate.id}
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              {approval.requester}
            </Text>
            <Text
              style={{
                color: approvalEnabled(approval)
                  ? palette.warning
                  : palette.textMuted,
                fontSize: 12,
              }}
            >
              {approval.expiresAt &&
              Date.parse(approval.expiresAt) <= observedAt
                ? t('Expired')
                : t('Awaiting decision')}
            </Text>
          </View>
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {approval.title}
          </Text>
          <Text style={[styles.detail, { color: palette.text }]}>
            {approval.detail}
          </Text>
          <View
            style={{
              backgroundColor: palette.surfaceMuted,
              padding: 10,
              borderRadius: 10,
              gap: 4,
            }}
          >
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 11,
                fontWeight: '700',
              }}
            >
              {t('Impact')}
            </Text>
            <Text style={[styles.detail, { color: palette.text }]}>
              {approval.impact}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              expanded: details === approval.target.coordinate.id,
            }}
            onPress={() =>
              setDetails(
                details === approval.target.coordinate.id
                  ? null
                  : approval.target.coordinate.id,
              )
            }
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              {t('Decision details')}{' '}
              {details === approval.target.coordinate.id ? '−' : '+'}
            </Text>
          </Pressable>
          {details === approval.target.coordinate.id && (
            <Text style={[styles.meta, { color: palette.textMuted }]}>
              {t('revision') + ' '}
              {approval.target.revision} · {approval.requester}
              {approval.expiresAt
                ? ` · ${t('Expires')} ${approval.expiresAt}`
                : ''}
            </Text>
          )}
          <Link
            href={{
              pathname: '/session/[id]',
              params: { id: approval.session.coordinate.id },
            }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.accent, fontSize: 13 }}>
                {t('Open conversation')} →
              </Text>
            </Pressable>
          </Link>
          <View style={styles.actions}>
            {(['deny', 'grant'] as const).map((decision) => (
              <Pressable
                key={decision}
                accessibilityRole="button"
                accessibilityLabel={
                  language === 'fr'
                    ? `${decision === 'grant' ? t('Approve') : t('Deny')} ${approval.title}, révision ${approval.target.revision}`
                    : `${decision} ${approval.title} at revision ${approval.target.revision}`
                }
                accessibilityState={{
                  disabled: !approvalEnabled(approval),
                }}
                disabled={!approvalEnabled(approval)}
                onPress={() => {
                  if (approvalEnabled(approval, Date.now()))
                    void decide(approval, decision);
                }}
                style={[
                  styles.action,
                  {
                    backgroundColor:
                      decision === 'grant' ? palette.accent : palette.surface,
                    borderColor:
                      decision === 'grant' ? palette.accent : palette.danger,
                    opacity: approvalEnabled(approval) ? 1 : 0.45,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      decision === 'grant'
                        ? palette.accentText
                        : palette.danger,
                    fontWeight: '800',
                  }}
                >
                  {decision === 'grant' ? t('Approve') : t('Deny')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Container>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 7 },
  cardTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
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
