// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionSummary } from '@/core/types';
import { usePalette } from '@/theme/palette';

export function SessionCard({ session }: { readonly session: SessionSummary }) {
  const palette = usePalette();
  return (
    <Link
      href={{
        pathname: '/session/[id]',
        params: { id: session.target.coordinate.id },
      }}
      asChild
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open session ${session.title}, ${session.state}`}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>
            {session.title}
          </Text>
          <Text style={[styles.state, { color: palette.accent }]}>
            {session.state}
          </Text>
        </View>
        <Text
          style={[styles.identity, { color: palette.textMuted }]}
          numberOfLines={1}
        >
          {session.target.coordinate.id} · rev {session.target.revision}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            {session.attachable ? 'Attachable' : 'Read only'}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            cursor {session.lastCursor}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 9,
    minHeight: 116,
  },
  pressed: { opacity: 0.72 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  state: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  identity: { fontSize: 12 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  meta: { fontSize: 13 },
});
