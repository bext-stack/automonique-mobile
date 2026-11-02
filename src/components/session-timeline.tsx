// SPDX-License-Identifier: Elastic-2.0
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SessionEvent } from '@/core/types';
import { useLanguage } from '@/i18n/language';
import { usePalette } from '@/theme/palette';
import { TimelineEventCard } from './timeline-event-card';

type InternalEvent = Extract<SessionEvent, { kind: 'unknown' }>;
type InternalEventGroup = [InternalEvent, ...InternalEvent[]];

function InternalEvents({ events }: { events: InternalEventGroup }) {
  const { t } = useLanguage();
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(0);
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  return (
    <View
      style={{
        borderColor: palette.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        gap: 8,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded(!expanded);
          setVisible(0);
        }}
        style={{ minHeight: 44, justifyContent: 'center', gap: 4 }}
      >
        <Text style={{ color: palette.text, fontWeight: '700' }}>
          {t('Internal events')} · {events.length}
        </Text>
        <Text style={{ color: palette.textMuted }}>
          {t('Provider diagnostics')} · {expanded ? t('Hide') : t('Inspect')}
        </Text>
      </Pressable>
      {expanded && (
        <>
          <Text style={{ color: palette.textMuted }}>
            {t(
              'Internal provider events are grouped here. Messages and run states remain in the conversation.',
            )}
          </Text>
          {[...counts].map(([type, count]) => (
            <Text selectable key={type} style={{ color: palette.textMuted }}>
              {type} × {count}
            </Text>
          ))}
          <Text selectable style={{ color: palette.textMuted, fontSize: 12 }}>
            {t('Cursor range')}: {events[0].cursor} →{' '}
            {(events.at(-1) ?? events[0]).cursor}
          </Text>
          {events.slice(0, visible).map((event) => (
            <TimelineEventCard key={event.id} event={event} diagnostics />
          ))}
          {visible < events.length && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisible(Math.min(visible + 20, events.length))}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.accent }}>
                {visible === 0 ? t('Show raw events') : t('Show next events')} ·{' '}
                {Math.min(20, events.length - visible)}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

export function SessionTimeline({
  events,
  diagnostics,
}: {
  events: readonly SessionEvent[];
  diagnostics: boolean;
}) {
  const rows: (SessionEvent | InternalEventGroup)[] = [];
  for (const event of events) {
    if (!diagnostics && event.kind !== 'message') continue;
    if (event.kind === 'unknown') {
      const previous = rows[rows.length - 1];
      if (Array.isArray(previous)) previous.push(event);
      else rows.push([event]);
    } else rows.push(event);
  }
  return (
    <>
      {rows.map((row) =>
        Array.isArray(row) ? (
          <InternalEvents key={row[0].id} events={row} />
        ) : (
          <TimelineEventCard
            key={row.id}
            event={row}
            diagnostics={diagnostics}
          />
        ),
      )}
    </>
  );
}
