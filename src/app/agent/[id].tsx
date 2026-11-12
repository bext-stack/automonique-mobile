// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  INITIAL_AGENT_CALL_STATE,
  startAgentCall,
  type AgentCallHandle,
  type AgentCallState,
  type CallSocket,
} from '@/core/agent-call';
import {
  callAudioAvailable,
  createCallAudio,
  requestCallMicrophone,
} from '@/core/call-audio';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { usePalette } from '@/theme/palette';

type Setup =
  | { readonly step: 'preparing' }
  | { readonly step: 'in_call'; readonly sessionId: string }
  | { readonly step: 'failed'; readonly reason: string };

const OPEN_ATTEMPTS = 30;
const OPEN_RETRY_MS = 2000;

const PHASE_LABEL: Record<AgentCallState['phase'], string> = {
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'The agent is thinking…',
  speaking: 'The agent is speaking',
  ended: 'Call ended',
};

const REASON_LABEL: Record<string, string> = {
  hung_up: 'You ended the call.',
  call_silence_limit: 'The call ended after a long silence.',
  call_duration_limit: 'The call reached its maximum length.',
  mobile_credential_invalid:
    'This phone is no longer authorized. Check the connection settings.',
  mobile_call_unconfigured: 'Voice calls are not set up on this server.',
  mobile_call_busy: 'Too many calls are in progress. Try again shortly.',
  agent_call_microphone_unavailable: 'The microphone could not be started.',
  agent_call_microphone_denied:
    'Microphone access was declined. Allow it in system settings to call an agent.',
  agent_call_unavailable_here: 'Voice calls are not available in this build.',
  agent_session_pending:
    'The agent’s conversation is still being prepared. Try again in a moment.',
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

export default function AgentCallScreen() {
  const { t, language } = useLanguage();
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const agentId = params.id;
  const { agentsGateway, refreshProjection } = useMobile();
  const lifecycle = useMobileLifecycle();
  const origin = lifecycle.state.profile?.origin ?? null;
  const [setup, setSetup] = useState<Setup>({ step: 'preparing' });
  const [call, setCall] = useState<AgentCallState>(INITIAL_AGENT_CALL_STATE);
  const [attempt, setAttempt] = useState(0);
  const handle = useRef<AgentCallHandle | null>(null);
  const refresh = useRef(refreshProjection);
  useEffect(() => {
    refresh.current = refreshProjection;
  }, [refreshProjection]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fail = (reason: string) => {
      if (!signal.aborted) setSetup({ step: 'failed', reason });
    };
    async function begin() {
      if (!agentsGateway || origin === null)
        return fail('mobile_credential_invalid');
      if (!callAudioAvailable()) return fail('agent_call_unavailable_here');
      // Ask before anything is sent: a declined microphone starts no session.
      if (!(await requestCallMicrophone())) {
        return fail('agent_call_microphone_denied');
      }
      let sessionId: string | null = null;
      for (
        let index = 0;
        index < OPEN_ATTEMPTS && sessionId === null;
        index += 1
      ) {
        const opened = await agentsGateway.open(agentId, signal);
        if (opened.state === 'open') sessionId = opened.sessionId;
        else await wait(OPEN_RETRY_MS, signal);
      }
      if (sessionId === null) return fail('agent_session_pending');
      // The server just granted this session to the phone; pick it up so the
      // conversation is readable after the call.
      void refresh.current();
      const ticket = await agentsGateway.callTicket(agentId, signal);
      if (signal.aborted) return;
      setCall(INITIAL_AGENT_CALL_STATE);
      setSetup({ step: 'in_call', sessionId });
      handle.current = startAgentCall({
        origin,
        path: ticket.path,
        ticket: ticket.ticket,
        language,
        audio: createCallAudio(),
        // React Native's WebSocket carries the paired origin's TLS policy.
        openSocket: (url) => new WebSocket(url) as unknown as CallSocket,
        onState: (state) => {
          if (!signal.aborted) setCall(state);
        },
      });
    }
    begin().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      fail(message in REASON_LABEL ? message : 'agent_call_connection_failed');
    });
    return () => {
      controller.abort();
      // Leaving the screen ends the call; nothing keeps listening unseen.
      handle.current?.hangUp();
      handle.current = null;
    };
    // `language` is read once per call on purpose: switching the interface
    // language must not drop a call in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, agentsGateway, origin, attempt]);

  const ended = setup.step === 'failed' || call.phase === 'ended';
  const reason = setup.step === 'failed' ? setup.reason : call.endReason;
  const status =
    setup.step === 'preparing'
      ? 'Preparing the call…'
      : setup.step === 'failed'
        ? 'Call ended'
        : PHASE_LABEL[call.phase];

  return (
    <Screen bottomInset showConnectionBanner={false} followTail>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {params.name ?? agentId}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: palette.accent }]}
        >
          {t(status)}
        </Text>
        {ended && reason !== null && (
          <Text accessibilityRole="alert" style={{ color: palette.textMuted }}>
            {t(REASON_LABEL[reason] ?? 'The call was interrupted.')}
          </Text>
        )}
        {!ended && (
          <Text style={[styles.note, { color: palette.textMuted }]}>
            {t(
              'Your voice is streamed to your server and its speech provider for this call. Nothing you say can approve a request; approvals still need a tap.',
            )}
          </Text>
        )}
      </View>

      {call.lines.map((line, index) => (
        <View
          key={index}
          style={[
            styles.line,
            {
              alignSelf: line.role === 'operator' ? 'flex-end' : 'flex-start',
              backgroundColor:
                line.role === 'operator' ? palette.accent : palette.surface,
            },
          ]}
        >
          <Text
            selectable
            style={{
              color:
                line.role === 'operator' ? palette.accentText : palette.text,
              fontSize: 16,
              lineHeight: 22,
            }}
          >
            {line.text}
          </Text>
        </View>
      ))}
      {call.partial !== '' && (
        <Text style={[styles.partial, { color: palette.textMuted }]}>
          {call.partial}
        </Text>
      )}

      <View style={styles.controls}>
        {!ended && setup.step === 'in_call' && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: call.muted }}
            onPress={() => handle.current?.setMuted(!call.muted)}
            style={[styles.button, { backgroundColor: palette.surfaceMuted }]}
          >
            <Text style={[styles.buttonText, { color: palette.text }]}>
              {call.muted ? t('Unmute') : t('Mute')}
            </Text>
          </Pressable>
        )}
        {!ended ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              handle.current?.hangUp();
              if (setup.step === 'preparing') {
                setSetup({ step: 'failed', reason: 'hung_up' });
              }
            }}
            style={[styles.button, { backgroundColor: palette.danger }]}
          >
            <Text style={[styles.buttonText, { color: palette.accentText }]}>
              {t('Hang up')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSetup({ step: 'preparing' });
              setAttempt((value) => value + 1);
            }}
            style={[styles.button, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.buttonText, { color: palette.accentText }]}>
              {t('Call again')}
            </Text>
          </Pressable>
        )}
      </View>
      {setup.step === 'in_call' && (
        <Link
          href={{ pathname: '/session/[id]', params: { id: setup.sessionId } }}
          style={[styles.link, { color: palette.accent }]}
        >
          {t('Open the written conversation')}
        </Link>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 6, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  status: { fontSize: 18, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18 },
  line: { borderRadius: 14, marginBottom: 8, maxWidth: '88%', padding: 12 },
  partial: { fontSize: 15, fontStyle: 'italic', marginBottom: 8 },
  controls: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
  link: { fontSize: 15, marginTop: 16, textAlign: 'center' },
});
