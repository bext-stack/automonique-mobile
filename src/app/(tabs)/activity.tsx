// SPDX-License-Identifier: Elastic-2.0

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ReceiptCard } from '@/components/receipt-card';
import { Screen } from '@/components/screen';
import type { SessionEvent } from '@/core/types';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

type ActivityFilter = 'all' | 'events' | 'receipts';

function eventSummary(event: SessionEvent): string {
  switch (event.kind) {
    case 'message':
      return `${event.role === 'user' ? 'Operator' : 'Automonique'} message`;
    case 'tool':
      return `${event.name} · ${event.state.replaceAll('_', ' ')}`;
    case 'run_state':
      return `Run ${event.state.replaceAll('_', ' ')}`;
    case 'unknown':
      return `Unknown server event · ${event.eventType}`;
  }
}

export default function ActivityScreen() {
  const { snapshot } = useMobile();
  const palette = usePalette();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const sessionNames = new Map(
    snapshot.sessions.map((session) => [
      session.target.coordinate.id,
      session.title,
    ]),
  );
  const events = Object.entries(snapshot.timelines)
    .flatMap(([sessionId, timeline]) =>
      timeline.map((event) => ({ event, sessionId })),
    )
    .sort(
      (left, right) =>
        Date.parse(right.event.createdAt) - Date.parse(left.event.createdAt),
    );
  const showEvents = filter === 'all' || filter === 'events';
  const showReceipts = filter === 'all' || filter === 'receipts';
  const empty =
    (showEvents ? events.length : 0) +
      (showReceipts ? snapshot.receipts.length : 0) ===
    0;

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Activity
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          Sanitized session events and durable command outcomes from this
          device’s bounded projection.
        </Text>
      </View>

      <View accessibilityRole="tablist" style={styles.filters}>
        {(['all', 'events', 'receipts'] as const).map((value) => (
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

      {showReceipts && snapshot.receipts.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>
            Command receipts
          </Text>
          {[...snapshot.receipts].reverse().map((receipt) => (
            <ReceiptCard
              key={receipt.id ?? receipt.idempotencyKey}
              receipt={receipt}
            />
          ))}
        </View>
      )}

      {showEvents && events.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>
            Session timeline
          </Text>
          {events.map(({ event, sessionId }) => (
            <View
              key={`${sessionId}:${event.id}`}
              accessibilityRole="summary"
              style={[
                styles.event,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.eventHeading}>
                <Text style={[styles.eventTitle, { color: palette.text }]}>
                  {eventSummary(event)}
                </Text>
                <Text style={[styles.provenance, { color: palette.accent }]}>
                  {event.provenance}
                </Text>
              </View>
              <Text style={[styles.meta, { color: palette.textMuted }]}>
                {sessionNames.get(sessionId) ?? sessionId} ·{' '}
                {new Date(event.createdAt).toLocaleString()}
              </Text>
              {event.kind === 'message' && (
                <Text
                  numberOfLines={3}
                  style={[styles.copy, { color: palette.text }]}
                >
                  {event.text}
                </Text>
              )}
              {event.kind === 'tool' && event.publicText !== null && (
                <Text style={[styles.copy, { color: palette.textMuted }]}>
                  {event.publicText}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {empty && (
        <View
          style={[
            styles.empty,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: palette.text }]}>
            No activity yet
          </Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            Activity appears after an authorized session is attached or a
            command produces a receipt.
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 20 },
  filters: { flexDirection: 'row', gap: 8 },
  filter: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 10 },
  sectionTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  event: { borderWidth: 1, borderRadius: 15, padding: 14, gap: 7 },
  eventHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eventTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  provenance: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  meta: { fontSize: 11, lineHeight: 16 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 7 },
});
