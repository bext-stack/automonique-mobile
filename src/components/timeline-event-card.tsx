// SPDX-License-Identifier: Elastic-2.0

import { StyleSheet, Text, View } from 'react-native';

import type { SessionEvent } from '@/core/types';
import { usePalette } from '@/theme/palette';

function eventContent(event: SessionEvent): { title: string; body: string } {
  switch (event.kind) {
    case 'message':
      return {
        title: event.role === 'user' ? 'Operator' : 'Automonique',
        body: event.text,
      };
    case 'tool':
      return {
        title: `${event.name} · ${event.state}`,
        body: event.publicText ?? 'No public output',
      };
    case 'run_state':
      return { title: 'Run state', body: event.state };
    case 'unknown':
      return { title: 'Unknown event', body: event.eventType };
  }
}

export function TimelineEventCard({ event }: { readonly event: SessionEvent }) {
  const palette = usePalette();
  const content = eventContent(event);
  const preview = event.provenance === 'preview';
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>
          {content.title}
        </Text>
        <Text
          style={[
            styles.provenance,
            { color: preview ? palette.preview : palette.textMuted },
          ]}
        >
          {event.provenance}
        </Text>
      </View>
      <Text style={[styles.body, { color: palette.text }]}>{content.body}</Text>
      <Text style={[styles.cursor, { color: palette.textMuted }]}>
        cursor {event.cursor}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 14, fontWeight: '800' },
  provenance: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 22 },
  cursor: { fontSize: 11 },
});
