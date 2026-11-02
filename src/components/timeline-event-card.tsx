// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SessionEvent } from '@/core/types';
import { usePalette } from '@/theme/palette';

function eventContent(event: SessionEvent): { title: string; body: string } {
  switch (event.kind) {
    case 'message':
      return {
        title: event.role === 'user' ? 'You' : 'Monique',
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

export function TimelineEventCard({
  event,
  diagnostics = false,
}: {
  readonly event: SessionEvent;
  readonly diagnostics?: boolean;
}) {
  const { t } = useLanguage();

  const palette = usePalette();
  const content = eventContent(event);
  const preview = event.provenance === 'preview';
  const assistant = event.kind === 'message' && event.role !== 'user';
  return (
    <View
      style={[
        styles.card,
        event.kind === 'message' && {
          alignSelf: event.role === 'user' ? 'flex-end' : 'stretch',
          maxWidth: event.role === 'user' ? '92%' : '100%',
        },
        {
          backgroundColor: assistant ? 'transparent' : palette.surfaceMuted,
          borderColor: palette.border,
        },
        assistant && { borderWidth: 0, paddingHorizontal: 2 },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>
          {event.kind === 'message' ? t(content.title) : content.title}
        </Text>
        {(diagnostics || preview || event.provenance === 'synthetic') && (
          <Text
            style={[
              styles.provenance,
              { color: preview ? palette.preview : palette.textMuted },
            ]}
          >
            {event.provenance}
          </Text>
        )}
      </View>
      {content.body
        .split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g)
        .filter(Boolean)
        .map((part, index) => {
          if (part.startsWith('```')) {
            const newline = part.indexOf('\n');
            const language = part.slice(3, newline).trim();
            const code = part
              .slice(newline + 1)
              .replace(/```$/, '')
              .trimEnd();
            return (
              <View
                key={index}
                style={[
                  styles.code,
                  {
                    backgroundColor: palette.surfaceMuted,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                  {language || 'Code'}
                </Text>
                <ScrollView horizontal>
                  <Text
                    selectable
                    style={[styles.codeText, { color: palette.text }]}
                  >
                    {code}
                  </Text>
                </ScrollView>
              </View>
            );
          }
          return (
            <Text
              key={index}
              selectable
              style={[styles.body, { color: palette.text }]}
            >
              {part.trim()}
            </Text>
          );
        })}
      {diagnostics && (
        <Text style={[styles.cursor, { color: palette.textMuted }]}>
          {t('cursor') + ' '}
          {event.cursor}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0,
    borderRadius: 20,
    padding: 14,
    gap: 8,
    marginVertical: 4,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 14, fontWeight: '800' },
  provenance: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  body: { fontSize: 16, lineHeight: 25 },
  code: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  cursor: { fontSize: 11 },
});
