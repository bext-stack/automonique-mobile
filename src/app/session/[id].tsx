// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import {
  announceForAccessibility,
  receiptAnnouncement,
} from '@/core/accessibility';
import {
  useVoiceDictationEvent,
  VoiceDictationModule,
} from '@/core/voice-dictation';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

function draftKey(id: string, scope: string | null): string {
  return scope === null
    ? `automonique.mobile.draft.v1:${id}`
    : `automonique.mobile.draft.v1:${scope}:${id}`;
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, storageScope, busyAction, sendFollowUp, stopRun } =
    useMobile();
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [dictationMessage, setDictationMessage] = useState(
    'Voice is transcribed on this device and stays editable before sending.',
  );
  const dictationBase = useRef('');
  const followUpLimit = snapshot.connection.limits.maxFollowUpBytes;
  const session = snapshot.sessions.find(
    (candidate) => candidate.target.coordinate.id === id,
  );
  const events = id ? (snapshot.timelines[id] ?? []) : [];
  const receipts = snapshot.receipts.filter(
    (receipt) =>
      receipt.target.id === id ||
      receipt.target.id === session?.run?.coordinate.id,
  );

  useVoiceDictationEvent('start', () => {
    setDictating(true);
    setDictationMessage('Listening… speak your follow-up.');
  });
  useVoiceDictationEvent('end', () => {
    setDictating(false);
  });
  useVoiceDictationEvent('result', (event) => {
    const transcript = event.results[0]?.transcript.trim();
    if (!transcript) return;
    setDraft([dictationBase.current, transcript].filter(Boolean).join(' '));
    setDictationMessage(
      event.isFinal
        ? 'Dictation ready. Review or edit it before sending.'
        : 'Listening… the draft will keep updating.',
    );
  });
  useVoiceDictationEvent('error', (event) => {
    setDictating(false);
    setDictationMessage(
      event.error === 'not-allowed'
        ? 'Microphone or speech permission is disabled in system settings.'
        : `Dictation stopped: ${event.error.replaceAll('-', ' ')}. You can keep typing.`,
    );
  });

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      const key = draftKey(id, storageScope);
      let value: string | null;
      try {
        value = await AsyncStorage.getItem(key);
      } catch {
        return;
      }
      if (!active) return;
      if (
        value !== null &&
        new TextEncoder().encode(value).byteLength <= followUpLimit
      ) {
        setDraft(value);
      } else {
        setDraft('');
        if (value !== null) {
          await AsyncStorage.removeItem(key).catch(() => undefined);
        }
      }
      if (active) setLoadedDraftKey(key);
    })();
    return () => {
      active = false;
    };
  }, [followUpLimit, id, storageScope]);

  useEffect(() => {
    if (!id) return;
    const key = draftKey(id, storageScope);
    if (loadedDraftKey !== key) return;
    if (new TextEncoder().encode(draft).byteLength <= followUpLimit) {
      void AsyncStorage.setItem(key, draft).catch(() => undefined);
    } else {
      void AsyncStorage.removeItem(key).catch(() => undefined);
    }
  }, [draft, followUpLimit, id, loadedDraftKey, storageScope]);

  useEffect(
    () => () => {
      VoiceDictationModule.abort();
    },
    [],
  );

  if (!session) {
    return (
      <Screen>
        <Text style={{ color: palette.text }}>
          Session is not present in the bounded projection.
        </Text>
      </Screen>
    );
  }

  const followUpAllowed =
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('follow_up') &&
    session.followUpAllowed &&
    busyAction === null;
  const stopAllowed =
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('stop_run') &&
    session.run !== null &&
    busyAction === null;
  const draftBytes = new TextEncoder().encode(draft.trim()).byteLength;
  const draftWithinLimit = draftBytes <= followUpLimit;

  async function submitFollowUp() {
    const text = draft.trim();
    if (!text || !followUpAllowed || !draftWithinLimit) return;
    try {
      const receipt = await sendFollowUp(session!, text);
      announceForAccessibility(
        receiptAnnouncement(receipt.action, receipt.outcome),
      );
      if (['accepted', 'completed', 'unknown'].includes(receipt.outcome)) {
        setDraft('');
        await AsyncStorage.removeItem(
          draftKey(session!.target.coordinate.id, storageScope),
        ).catch(() => undefined);
      }
    } catch (error) {
      Alert.alert(
        'Follow-up not sent',
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  async function toggleDictation() {
    if (dictating) {
      VoiceDictationModule.stop();
      return;
    }
    if (!followUpAllowed) return;
    try {
      const permission = await VoiceDictationModule.requestPermissionsAsync();
      if (!permission.granted) {
        setDictationMessage(
          permission.canAskAgain
            ? 'Microphone and speech permissions are required for dictation.'
            : 'Microphone or speech permission is disabled in system settings.',
        );
        return;
      }
      if (!VoiceDictationModule.supportsOnDeviceRecognition()) {
        setDictationMessage(
          'On-device speech recognition is unavailable. Use the keyboard so no audio leaves this device.',
        );
        return;
      }
      dictationBase.current = draft.trim();
      VoiceDictationModule.start({
        addsPunctuation: true,
        contextualStrings: ['Automonique', 'Monique'],
        continuous: false,
        interimResults: true,
        lang: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
        maxAlternatives: 1,
        requiresOnDeviceRecognition: true,
      });
    } catch {
      setDictationMessage(
        'Dictation could not start. You can continue with the keyboard.',
      );
    }
  }

  async function requestStop() {
    try {
      const receipt = await stopRun(session!);
      announceForAccessibility(
        `${receiptAnnouncement(receipt.action, receipt.outcome)} for ${session!.run?.coordinate.id ?? 'the selected run'}`,
      );
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
          editable={followUpAllowed}
          multiline
          maxLength={followUpLimit}
          onChangeText={setDraft}
          placeholder={
            followUpAllowed
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
          accessibilityLabel={
            dictating ? 'Stop voice dictation' : 'Start voice dictation'
          }
          accessibilityState={{ disabled: !followUpAllowed }}
          disabled={!followUpAllowed}
          onPress={() => void toggleDictation()}
          style={[
            styles.voice,
            {
              borderColor: dictating ? palette.accent : palette.border,
              opacity: followUpAllowed ? 1 : 0.45,
            },
          ]}
        >
          <Text
            style={{
              color: dictating ? palette.accent : palette.text,
              fontWeight: '800',
            }}
          >
            {dictating ? 'Stop listening' : 'Dictate with voice'}
          </Text>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.voiceStatus, { color: palette.textMuted }]}
        >
          {dictationMessage}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.byteLimit,
            {
              color: draftWithinLimit ? palette.textMuted : palette.danger,
            },
          ]}
        >
          {draftBytes} / {followUpLimit} bytes
          {draftWithinLimit ? '' : ' · too long'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send follow-up"
          accessibilityState={{
            disabled:
              !followUpAllowed ||
              dictating ||
              !draft.trim() ||
              !draftWithinLimit,
          }}
          disabled={
            !followUpAllowed || dictating || !draft.trim() || !draftWithinLimit
          }
          onPress={() => void submitFollowUp()}
          style={[
            styles.primary,
            {
              backgroundColor:
                followUpAllowed && !dictating && draftWithinLimit
                  ? palette.accent
                  : palette.surfaceMuted,
            },
          ]}
        >
          <Text
            style={{
              color:
                followUpAllowed && !dictating && draftWithinLimit
                  ? palette.accentText
                  : palette.textMuted,
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
            accessibilityState={{ disabled: !stopAllowed }}
            disabled={!stopAllowed}
            onPress={() => void requestStop()}
            style={[
              styles.stop,
              { borderColor: palette.danger, opacity: stopAllowed ? 1 : 0.45 },
            ]}
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
  byteLimit: { fontSize: 12, textAlign: 'right' },
  voice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceStatus: { fontSize: 12, lineHeight: 18 },
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
