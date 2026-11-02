// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChatComposer } from '@/components/chat-composer';
import { Screen } from '@/components/screen';
import { createTaskExecution, type TaskHandle } from '@/core/task-execution';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function TaskScreen() {
  const mobile = useMobile();
  // Remount state and abort requests when the selected device/server changes.
  return <TaskComposer key={mobile.storageScope ?? 'unpaired'} />;
}
function TaskComposer() {
  const {
    snapshot,
    storageScope,
    taskGateway,
    projectionReady,
    refreshProjection,
  } = useMobile();
  const palette = usePalette();
  const [text, setText] = useState('');
  const [handle, setHandle] = useState<TaskHandle | null>(null);
  const [loadedExecution, setLoadedExecution] = useState<ReturnType<
    typeof createTaskExecution
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const openCreatedConversation = useRef(false);
  const lifetime = useRef(new AbortController());
  const execution = useMemo(
    () =>
      storageScope && taskGateway
        ? createTaskExecution(
            storageScope,
            AsyncStorage,
            taskGateway,
            Crypto.randomUUID,
          )
        : null,
    [storageScope, taskGateway],
  );
  const loaded = execution !== null && loadedExecution === execution;
  const refresh = useRef(refreshProjection);
  refresh.current = refreshProjection;
  const allowed =
    !!execution &&
    projectionReady &&
    snapshot.connection.phase === 'live' &&
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('start_task');
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void execution
      ?.read()
      .then((value) => {
        if (!controller.signal.aborted) {
          setHandle(value);
          setLoadedExecution(execution);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Task recovery is unavailable. Reconnect before starting work.',
          );
      });
    return () => controller.abort();
  }, [execution]);
  useEffect(() => {
    if (!execution || !loaded || !allowed || handle?.state !== 'pending')
      return;
    const timer = setInterval(() => {
      void run(false);
    }, 5000);
    return () => clearInterval(timer);
  });
  async function run(submit: boolean) {
    if (!execution || !loaded || !allowed || inFlight.current) return;
    inFlight.current = true;
    if (submit) openCreatedConversation.current = true;
    setBusy(true);
    setError(null);
    const signal = lifetime.current.signal;
    try {
      const next = submit
        ? await execution.submit(
            text,
            snapshot.connection.limits.maxFollowUpBytes,
            signal,
          )
        : await execution.reconcile(signal);
      if (signal.aborted) return;
      setHandle(next);
      if (submit && next?.state !== 'failed') setText('');
      if (next?.state === 'started') await refresh.current();
    } catch {
      if (!signal.aborted) {
        // A persisted pending receipt still blocks a second submission.
        try {
          setHandle(await execution.read());
        } catch {}
        setError(
          'Could not confirm the task. Check its status before trying again.',
        );
      }
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  const granted = snapshot.connection.allowedActions.includes('start_task');
  const pending = handle?.state === 'pending';
  const session = snapshot.sessions.find(
    (entry) => entry.target.coordinate.id === handle?.sessionId,
  );
  useEffect(() => {
    if (
      session &&
      handle?.state === 'started' &&
      openCreatedConversation.current
    ) {
      openCreatedConversation.current = false;
      router.push({
        pathname: '/session/[id]',
        params: { id: session.target.coordinate.id },
      });
    }
  }, [session, handle]);
  const validText =
    text.trim().length > 0 &&
    new TextEncoder().encode(text).byteLength <=
      snapshot.connection.limits.maxFollowUpBytes;
  const canSubmit = allowed && loaded && !busy && !pending && validText;
  return (
    <Screen
      bottomInset
      contentContainerStyle={{ flexGrow: 1 }}
      footer={
        <ChatComposer
          value={text}
          onChangeText={setText}
          editable={allowed && !busy && !pending}
          canSend={canSubmit}
          busy={busy || pending}
          onSend={() => void run(true)}
        />
      }
    >
      <View style={styles.welcome}>
        <View style={[styles.mark, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={{ color: palette.accent, fontSize: 28 }}>✳</Text>
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          What can I help with?
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Think it through. Build something. Get work done.
        </Text>
        <View style={styles.suggestions}>
          {[
            'Help me plan a change',
            'Help me investigate a problem',
            'Review an idea with me',
          ].map((prompt) => (
            <Pressable
              key={prompt}
              accessibilityRole="button"
              disabled={!allowed || busy || pending}
              accessibilityState={{ disabled: !allowed || busy || pending }}
              onPress={() => setText(prompt + ': ')}
              style={({ pressed }) => [
                styles.suggestion,
                {
                  borderColor: palette.border,
                  backgroundColor: pressed
                    ? palette.surfaceMuted
                    : palette.surface,
                },
              ]}
            >
              <Text style={{ color: palette.text, fontSize: 14 }}>
                {prompt}
              </Text>
              <Text style={{ color: palette.textMuted }}>↗</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.scope, { color: palette.textMuted }]}>
          Monique works in an isolated workspace. Use Work for project tickets.
        </Text>
      </View>
      {!granted && (
        <Text style={{ color: palette.textMuted }}>
          This device cannot start tasks yet. Create a new pairing invitation in
          the dashboard with “Allow this phone to start tasks” enabled, then
          pair this phone.
        </Text>
      )}
      {granted && !allowed && (
        <Text style={{ color: palette.textMuted }}>
          Reconnect to start work or check task status.
        </Text>
      )}
      <View accessibilityLiveRegion="polite" style={styles.status}>
        {pending && (
          <Text style={{ color: palette.text }}>
            Waiting for confirmation. The app will check the saved receipt; it
            will not submit the task again.
          </Text>
        )}
        {handle?.state === 'failed' && (
          <Text style={{ color: palette.text }}>
            The server declined this task. You can edit the instructions and try
            again.
          </Text>
        )}
        {handle?.state === 'started' && (
          <Text style={{ color: palette.text }}>
            Your conversation is ready. Open it to follow the reply and keep
            chatting.
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={{ color: palette.text }}>
            {error}
          </Text>
        )}
      </View>
      {pending && (
        <Pressable
          accessibilityRole="button"
          disabled={!allowed || busy}
          onPress={() => {
            void run(false);
          }}
          style={styles.button}
        >
          <Text style={{ color: palette.accent }}>Check task status</Text>
        </Pressable>
      )}
      {session && (
        <Link
          href={{
            pathname: '/session/[id]',
            params: { id: session.target.coordinate.id },
          }}
          asChild
        >
          <Pressable
            accessibilityRole="button"
            style={StyleSheet.flatten([
              styles.button,
              { backgroundColor: palette.accent },
            ])}
          >
            <Text style={{ color: palette.accentText, fontWeight: '800' }}>
              Continue conversation
            </Text>
          </Pressable>
        </Link>
      )}
      {(!allowed || (handle?.state === 'started' && !session)) && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void refreshProjection();
          }}
          style={styles.button}
        >
          <Text style={{ color: palette.accent }}>Refresh connection</Text>
        </Pressable>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  welcome: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 24,
  },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  scope: { fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 310 },
  suggestions: { gap: 8, width: '100%', maxWidth: 380, marginVertical: 8 },
  suggestion: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  button: {
    minHeight: 48,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { gap: 8 },
});
