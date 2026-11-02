// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '@/components/connection-banner';
import { Screen } from '@/components/screen';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

function Metric({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: number;
  readonly href: Href;
}) {
  const { t } = useLanguage();
  const palette = usePalette();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t(label)}: ${value}`}
        style={styles.metric}
      >
        <Text style={[styles.metricValue, { color: palette.text }]}>
          {value}
        </Text>
        <Text style={[styles.metricLabel, { color: palette.textMuted }]}>
          {t(label)}
        </Text>
      </Pressable>
    </Link>
  );
}

export default function OverviewScreen() {
  const { t, language } = useLanguage();

  const { snapshot } = useMobile();
  const palette = usePalette();
  const running = snapshot.sessions.filter(
    (session) => session.run !== null && session.state === 'active',
  );
  const active = snapshot.sessions.filter(
    (session) => session.state === 'active' || session.state === 'waiting',
  );
  const unsettled = snapshot.receipts.filter(
    (receipt) =>
      receipt.outcome === 'accepted' || receipt.outcome === 'unknown',
  );
  const lost = snapshot.sessions.filter(
    (session) => session.state === 'lost' && session.attachable,
  );
  const attentionCount =
    snapshot.approvals.length + unsettled.length + lost.length;

  return (
    <Screen showConnectionBanner={false}>
      <ConnectionBanner compact />

      <View
        style={[
          styles.metrics,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Metric label="Active" value={active.length} href="/(tabs)/sessions" />
        <Metric
          label="Running"
          value={running.length}
          href="/(tabs)/sessions"
        />
        <Metric
          label="Approvals"
          value={snapshot.approvals.length}
          href="/(tabs)/approvals"
        />
        <Metric
          label="Receipts"
          value={unsettled.length}
          href="/(tabs)/activity"
        />
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
              {attentionCount > 0
                ? t('Needs attention')
                : snapshot.connection.phase === 'live'
                  ? t('You’re caught up')
                  : t('Saved status')}
            </Text>
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              {attentionCount === 0
                ? snapshot.connection.phase === 'live'
                  ? t(
                      'No pending decisions, uncertain commands, or lost sessions.',
                    )
                  : t('Reconnect to update these counts.')
                : language === 'fr'
                  ? `${attentionCount} élément${attentionCount === 1 ? '' : 's'} à vérifier.`
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
              style={StyleSheet.flatten([
                styles.rowLink,
                { borderColor: palette.warning },
              ])}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                {t('Review') + ' '}
                {snapshot.approvals.length} {' ' + t('pending approval')}
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
              style={StyleSheet.flatten([
                styles.rowLink,
                { borderColor: palette.warning },
              ])}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                {t('Reconcile') + ' '}
                {unsettled.length} {' ' + t('uncertain command')}
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
              style={StyleSheet.flatten([
                styles.rowLink,
                { borderColor: palette.warning },
              ])}
            >
              <Text style={[styles.rowTitle, { color: palette.text }]}>
                {t('Inspect') + ' '}
                {lost.length} {' ' + t('unavailable session')}
                {lost.length === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.arrow, { color: palette.text }]}>›</Text>
            </Pressable>
          </Link>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>
          {t('Recent sessions')}
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
              style={StyleSheet.flatten([
                styles.sessionRow,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ])}
            >
              <View style={styles.grow}>
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, { color: palette.text }]}
                >
                  {session.title}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]}>
                  {!session.attachable
                    ? t('Saved conversation')
                    : session.run !== null && session.state === 'active'
                      ? t('Run in progress')
                      : t(session.state)}
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
            {t('This credential has no session scope yet.')}
          </Text>
        )}
        {snapshot.sessions.length > 3 && (
          <Link href="/(tabs)/sessions" asChild>
            <Pressable
              accessibilityRole="button"
              style={StyleSheet.flatten([
                styles.secondary,
                { borderColor: palette.border },
              ])}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                {t('View all sessions')}
              </Text>
            </Pressable>
          </Link>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 12, lineHeight: 18 },
  metrics: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 3,
  },
  metricValue: { fontSize: 24, lineHeight: 28, fontWeight: '700' },
  metricLabel: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
  attention: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  attentionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  attentionCount: { fontSize: 24, fontWeight: '700' },
  grow: { flex: 1, gap: 3 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
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
    minHeight: 60,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
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
