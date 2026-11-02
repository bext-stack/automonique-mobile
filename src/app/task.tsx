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

export default function TaskScreen({
  bottomInset = true,
}: {
  readonly bottomInset?: boolean;
}) {
  const mobile = useMobile();
  // Remount state and abort requests when the selected device/server changes.
  return (
    <TaskComposer
      key={mobile.storageScope ?? 'unpaired'}
      bottomInset={bottomInset}
    />
  );
}
function TaskComposer({ bottomInset }: { readonly bottomInset: boolean }) {
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
      bottomInset={bottomInset}
      showConnectionBanner={
        snapshot.connection.phase !== 'live' || snapshot.connection.synthetic
      }
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
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          What’s on your mind?
        </Text>
        <View style={styles.suggestions}>
          {[
            'Help me plan a change',
            'Help me investigate a problem',
            'Review an idea with me',
          ].map((prompt, index) => (
            <Pressable
              key={prompt}
              accessibilityRole="button"
              accessibilityLabel={prompt}
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
                {
                  ['Plan a change', 'Investigate a problem', 'Explore an idea'][
                    index
                  ]
                }
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.scope, { color: palette.textMuted }]}>
          A new conversation in an isolated workspace.
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
        {handle?.state === 'started' && !session && (
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
              styles.resume,
              { borderColor: palette.border },
            ])}
          >
            <Text
              style={{
                color: palette.textMuted,
                fontWeight: '500',
                fontSize: 14,
              }}
            >
              Continue conversation
            </Text>
            <Text style={{ color: palette.textMuted }}>→</Text>
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
    gap: 20,
    paddingVertical: 20,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  scope: { fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 310 },
  suggestions: {
    gap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 380,
  },
  suggestion: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resume: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
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
