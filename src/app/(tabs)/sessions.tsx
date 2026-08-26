// SPDX-License-Identifier: Elastic-2.0

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { SessionCard } from '@/components/session-card';
import type { SessionSummary } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

type SessionFilter = 'all' | 'active' | 'waiting' | 'completed';

function matchesFilter(
  session: SessionSummary,
  filter: SessionFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'completed') {
    return session.state === 'completed' || session.state === 'lost';
  }
  return session.state === filter;
}

export default function SessionsScreen() {
  const { snapshot } = useMobile();
  const palette = usePalette();
  const [filter, setFilter] = useState<SessionFilter>('all');
  const filtered = snapshot.sessions.filter((session) =>
    matchesFilter(session, filter),
  );

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Sessions
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {snapshot.sessions.length} authorized · {filtered.length} shown
        </Text>
      </View>

      <View accessibilityRole="tablist" style={styles.filters}>
        {(['all', 'active', 'waiting', 'completed'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === value }}
            onPress={() => setFilter(value)}
            style={[
              styles.filter,
              {
                backgroundColor:
                  filter === value ? palette.accent : palette.surface,
                borderColor: filter === value ? palette.accent : palette.border,
              },
            ]}
          >
            <Text
              style={{
                color:
                  filter === value ? palette.accentText : palette.textMuted,
                fontSize: 12,
                fontWeight: '800',
                textTransform: 'capitalize',
              }}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.list}>
        {filtered.map((session) => (
          <SessionCard key={session.target.coordinate.id} session={session} />
        ))}
        {filtered.length === 0 && (
          <View
            style={[
              styles.empty,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              No {filter === 'all' ? '' : `${filter} `}sessions
            </Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              The server only returns sessions authorized for this device.
            </Text>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 3 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: 12 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
});
