// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Link } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const validText =
    text.trim().length > 0 &&
    new TextEncoder().encode(text).byteLength <=
      snapshot.connection.limits.maxFollowUpBytes;
  const canSubmit = allowed && loaded && !busy && !pending && validText;
  return (
    <Screen bottomInset>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.text }]}
      >
        Run a task
      </Text>
      <Text style={{ color: palette.textMuted }}>
        Ask Monique to create files, run a script, or investigate a problem.
        Open the resulting session to see progress and send follow-ups.
      </Text>
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
      <TextInput
        accessibilityLabel="Task instructions"
        placeholder="What should Monique do?"
        placeholderTextColor={palette.textMuted}
        multiline
        value={text}
        onChangeText={setText}
        editable={allowed && !busy && !pending}
        style={[
          styles.input,
          {
            color: palette.text,
            borderColor: palette.border,
            backgroundColor: palette.surface,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => {
          void run(true);
        }}
        style={[
          styles.button,
          { backgroundColor: palette.accent, opacity: canSubmit ? 1 : 0.45 },
        ]}
      >
        <Text style={{ color: palette.accentText, fontWeight: '800' }}>
          {busy ? 'Checking task…' : 'Start task'}
        </Text>
      </Pressable>
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
            Task started. Open its session to follow progress.
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
              Open task session
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
  title: { fontSize: 28, fontWeight: '800' },
  input: {
    minHeight: 160,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    textAlignVertical: 'top',
    fontSize: 16,
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
