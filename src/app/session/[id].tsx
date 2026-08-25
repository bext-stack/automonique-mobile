// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ReceiptCard } from '@/components/receipt-card';
import { Screen } from '@/components/screen';
import { TimelineEventCard } from '@/components/timeline-event-card';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

function draftKey(id: string): string {
  return `automonique.mobile.draft.v1:${id}`;
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, busyAction, sendFollowUp, stopRun } = useMobile();
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const session = snapshot.sessions.find(
    (candidate) => candidate.target.coordinate.id === id,
  );
  const events = id ? (snapshot.timelines[id] ?? []) : [];
  const receipts = snapshot.receipts.filter(
    (receipt) =>
      receipt.target.id === id ||
      receipt.target.id === session?.run?.coordinate.id,
  );

  useEffect(() => {
    if (!id) return;
    void AsyncStorage.getItem(draftKey(id)).then((value) =>
      setDraft(value ?? ''),
    );
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void AsyncStorage.setItem(draftKey(id), draft);
  }, [draft, id]);

  if (!session) {
    return (
      <Screen>
        <Text style={{ color: palette.text }}>
          Session is not present in the bounded projection.
        </Text>
      </Screen>
    );
  }

  const writable =
    snapshot.connection.mutationsAllowed &&
    session.followUpAllowed &&
    busyAction === null;

  async function submitFollowUp() {
    const text = draft.trim();
    if (!text || !writable) return;
    try {
      await sendFollowUp(session!, text);
      setDraft('');
      await AsyncStorage.removeItem(draftKey(session!.target.coordinate.id));
    } catch (error) {
      Alert.alert(
        'Follow-up not sent',
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  async function requestStop() {
    try {
      await stopRun(session!);
    } catch (error) {
      Alert.alert(
        'Run not stopped',
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {session.title}
        </Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>
          {session.target.coordinate.authority}/{session.target.coordinate.kind}
          /{session.target.coordinate.id}
        </Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>
          revision {session.target.revision} · cursor {session.lastCursor}
        </Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>
          run {session.run?.coordinate.id ?? 'none'}
        </Text>
      </View>

      <View style={styles.timeline}>
        <Text
          accessibilityRole="header"
          style={[styles.section, { color: palette.text }]}
        >
          Timeline
        </Text>
        {events.map((event) => (
          <TimelineEventCard key={event.id} event={event} />
        ))}
      </View>

      <View
        style={[
          styles.composer,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.section, { color: palette.text }]}
        >
          Exact-session follow-up
        </Text>
        <TextInput
          accessibilityLabel="Follow-up message"
          editable={writable}
          multiline
          maxLength={4096}
          onChangeText={setDraft}
          placeholder={
            writable
              ? 'Send a bound follow-up…'
              : 'Read only while stale or unauthorized'
          }
          placeholderTextColor={palette.textMuted}
          style={[
            styles.input,
            { color: palette.text, borderColor: palette.border },
          ]}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !writable || !draft.trim() }}
          disabled={!writable || !draft.trim()}
          onPress={() => void submitFollowUp()}
          style={[
            styles.primary,
            {
              backgroundColor: writable ? palette.accent : palette.surfaceMuted,
            },
          ]}
        >
          <Text
            style={{
              color: writable ? palette.accentText : palette.textMuted,
              fontWeight: '800',
            }}
          >
            Send follow-up
          </Text>
        </Pressable>
        {session.run && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop exact run ${session.run.coordinate.id}`}
            accessibilityState={{ disabled: !writable }}
            disabled={!writable}
            onPress={() => void requestStop()}
            style={[styles.stop, { borderColor: palette.danger }]}
          >
            <Text style={{ color: palette.danger, fontWeight: '800' }}>
              Stop exact run
            </Text>
          </Pressable>
        )}
      </View>

      {receipts.length > 0 && (
        <View style={styles.timeline}>
          <Text
            accessibilityRole="header"
            style={[styles.section, { color: palette.text }]}
          >
            Durable receipts
          </Text>
          {receipts.map((receipt) => (
            <ReceiptCard key={receipt.id} receipt={receipt} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  meta: { fontSize: 12 },
  section: { fontSize: 19, fontWeight: '800' },
  timeline: { gap: 11 },
  composer: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 },
  input: {
    minHeight: 104,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  primary: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
