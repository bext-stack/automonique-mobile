// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '@/components/connection-banner';
import { Screen } from '@/components/screen';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.metric,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.metricValue, { color: palette.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

export default function OverviewScreen() {
  const { snapshot } = useMobile();
  const palette = usePalette();
  const running = snapshot.sessions.filter((session) => session.run !== null);
  const active = snapshot.sessions.filter(
    (session) => session.state === 'active' || session.state === 'waiting',
  );
  const unsettled = snapshot.receipts.filter(
    (receipt) =>
      receipt.outcome === 'accepted' || receipt.outcome === 'unknown',
  );
  const lost = snapshot.sessions.filter((session) => session.state === 'lost');
  const attentionCount =
    snapshot.approvals.length +
    unsettled.length +
    lost.length +
    (snapshot.connection.phase === 'live' ? 0 : 1);

  return (
    <Screen showConnectionBanner={false}>
      <View style={styles.hero}>
        <Text style={[styles.eyebrow, { color: palette.accent }]}>
          OPERATOR
        </Text>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Your Automonique
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          A scoped view of the work and decisions this phone is authorized to
          access.
        </Text>
      </View>

      <ConnectionBanner />

      <View style={styles.metrics}>
        <Metric label="Active" value={active.length} />
        <Metric label="Running" value={running.length} />
        <Metric label="Approvals" value={snapshot.approvals.length} />
        <Metric label="Receipts" value={unsettled.length} />
      </View>

      <View
        style={[
          styles.attention,
          {
            backgroundColor:
              attentionCount > 0 ? palette.warningSurface : palette.surface,
            borderColor: attentionCount > 0 ? palette.warning : palette.border,
          },
        ]}
      >
        <View style={styles.attentionHeading}>
          <View style={styles.grow}>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>
              Needs attention
            </Text>
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              {attentionCount === 0
                ? 'No pending decisions, uncertain commands, or lost sessions.'
                : `${attentionCount} item${attentionCount === 1 ? '' : 's'} to review.`}
            </Text>
          </View>
          <Text style={[styles.attentionCount, { color: palette.text }]}>
            {attentionCount}
          </Text>
        </View>

        {snapshot.approvals.length > 0 && (
          <Link href="/(tabs)/approvals" asChild>
            <Pressable
              accessibilityRole="button"
              style={[styles.rowLink, { borderColor: palette.warning }]}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                Review {snapshot.approvals.length} pending approval
                {snapshot.approvals.length === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.arrow, { color: palette.text }]}>›</Text>
            </Pressable>
          </Link>
        )}
        {unsettled.length > 0 && (
          <Link href="/(tabs)/activity" asChild>
            <Pressable
              accessibilityRole="button"
              style={[styles.rowLink, { borderColor: palette.warning }]}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                Reconcile {unsettled.length} uncertain command
                {unsettled.length === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.arrow, { color: palette.text }]}>›</Text>
            </Pressable>
          </Link>
        )}
        {lost.length > 0 && (
          <Link href="/(tabs)/sessions" asChild>
            <Pressable
              accessibilityRole="button"
              style={[styles.rowLink, { borderColor: palette.warning }]}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                Inspect {lost.length} unavailable session
                {lost.length === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.arrow, { color: palette.text }]}>›</Text>
            </Pressable>
          </Link>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>
          Recent sessions
        </Text>
        {snapshot.sessions.slice(0, 3).map((session) => (
          <Link
            key={session.target.coordinate.id}
            href={{
              pathname: '/session/[id]',
              params: { id: session.target.coordinate.id },
            }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              style={[
                styles.sessionRow,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: palette.text }]}>
                  {session.title}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]}>
                  {session.run === null ? 'No active run' : 'Run in progress'} ·{' '}
                  {session.state}
                </Text>
              </View>
              <Text style={[styles.arrow, { color: palette.textMuted }]}>
                ›
              </Text>
            </Pressable>
          </Link>
        ))}
        {snapshot.sessions.length === 0 && (
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            This credential has no session scope yet.
          </Text>
        )}
        {snapshot.sessions.length > 3 && (
          <Link href="/(tabs)/sessions" asChild>
            <Pressable
              accessibilityRole="button"
              style={[styles.secondary, { borderColor: palette.border }]}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                View all sessions
              </Text>
            </Pressable>
          </Link>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 4 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '900' },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 21 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  metricValue: { fontSize: 27, lineHeight: 31, fontWeight: '900' },
  metricLabel: { fontSize: 12, fontWeight: '700' },
  attention: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 10 },
  attentionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  attentionCount: { fontSize: 30, fontWeight: '900' },
  grow: { flex: 1, gap: 3 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: '800' },
  rowLink: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  arrow: { fontSize: 24, lineHeight: 28 },
  sessionRow: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meta: { fontSize: 12, lineHeight: 17 },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
