// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ReceiptCard } from '@/components/receipt-card';
import { Screen } from '@/components/screen';
import { SessionCard } from '@/components/session-card';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function SessionsScreen() {
  const { snapshot, setConnectionPhase } = useMobile();
  const palette = usePalette();
  const stale = snapshot.connection.phase !== 'live';
  const transportLabel = snapshot.connection.synthetic
    ? 'Synthetic development transport'
    : `${stale ? 'Read-only' : 'Live'} SDK transport`;
  const simulationControlVisible =
    snapshot.connection.synthetic &&
    (!stale ||
      snapshot.connection.label === 'Simulated connectivity loss — read only');
  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.eyebrow, { color: palette.accent }]}
          >
            OPERATIONS
          </Text>
          <Text style={[styles.title, { color: palette.text }]}>Sessions</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {transportLabel} · bounded, authority-qualified activity.
          </Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable
            accessibilityRole="button"
            style={[styles.secondary, { borderColor: palette.border }]}
          >
            <Text style={{ color: palette.text }}>Connection</Text>
          </Pressable>
        </Link>
      </View>

      {simulationControlVisible && (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: stale }}
          accessibilityLabel="Simulate offline read-only mode"
          onPress={() => setConnectionPhase(stale ? 'live' : 'stale')}
          style={[styles.mode, { backgroundColor: palette.surfaceMuted }]}
        >
          <Text style={[styles.modeText, { color: palette.text }]}>
            {stale
              ? 'Resume synthetic connection'
              : 'Simulate connectivity loss'}
          </Text>
        </Pressable>
      )}

      <View style={styles.list}>
        {snapshot.sessions.map((session) => (
          <SessionCard key={session.target.coordinate.id} session={session} />
        ))}
      </View>

      <Link href="/approvals" asChild>
        <Pressable
          accessibilityRole="button"
          style={[styles.primary, { backgroundColor: palette.accent }]}
        >
          <Text style={[styles.primaryText, { color: palette.accentText }]}>
            Review approvals ({snapshot.approvals.length})
          </Text>
        </Pressable>
      </Link>

      {snapshot.receipts.length > 0 && (
        <View style={styles.list}>
          <Text
            accessibilityRole="header"
            style={[styles.section, { color: palette.text }]}
          >
            Recent receipts
          </Text>
          {snapshot.receipts
            .slice(-3)
            .reverse()
            .map((receipt) => (
              <ReceiptCard
                key={receipt.id ?? receipt.idempotencyKey}
                receipt={receipt}
              />
            ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingCopy: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  subtitle: { fontSize: 14 },
  list: { gap: 12 },
  mode: { padding: 13, borderRadius: 12, alignItems: 'center' },
  modeText: { fontWeight: '700' },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontWeight: '800' },
  secondary: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  section: { fontSize: 20, fontWeight: '800' },
});
