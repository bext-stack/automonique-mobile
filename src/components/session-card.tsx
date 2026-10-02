// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionSummary } from '@/core/types';
import { usePalette } from '@/theme/palette';

function stateLabel(session: SessionSummary): string {
  if (session.attachable) return session.state;
  return session.state === 'completed' ? 'ended' : 'retained';
}

function observedLabel(observedAt: string): string | null {
  const time = Date.parse(observedAt);
  return Number.isNaN(time)
    ? null
    : new Date(time).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

export function SessionCard({ session }: { readonly session: SessionSummary }) {
  const palette = usePalette();
  const observed = observedLabel(session.observedAt);
  const [pressed, setPressed] = useState(false);
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
        accessibilityLabel={`Open session ${session.title}, ${stateLabel(session)}`}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
          pressed && styles.pressed,
        ])}
      >
        <View style={styles.header}>
          <Text
            numberOfLines={2}
            style={[styles.title, { color: palette.text }]}
          >
            {session.title}
          </Text>
          <Text style={[styles.state, { color: palette.accent }]}>
            {stateLabel(session)}
          </Text>
        </View>
        <Text
          style={[styles.identity, { color: palette.textMuted }]}
          numberOfLines={1}
        >
          {observed === null ? '' : `${observed} · `}
          {session.target.coordinate.id}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            {session.followUpAllowed
              ? 'Ready for follow-up'
              : session.attachable
                ? 'Live session'
                : 'Retained history'}
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700', flex: 1 },
  state: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  identity: { fontSize: 12 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
  },
  meta: { fontSize: 13 },
});
