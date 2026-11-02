// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApprovalContent } from '../(tabs)/approvals';
import { ChatComposer } from '@/components/chat-composer';
import { ReceiptCard } from '@/components/receipt-card';
import { Screen } from '@/components/screen';
import { SessionTimeline } from '@/components/session-timeline';
import {
  announceForAccessibility,
  receiptAnnouncement,
} from '@/core/accessibility';
import {
  useVoiceDictationEvent,
  VoiceDictationModule,
} from '@/core/voice-dictation';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

function draftKey(id: string, scope: string | null): string {
  return scope === null
    ? `automonique.mobile.draft.v1:${id}`
    : `automonique.mobile.draft.v1:${scope}:${id}`;
}

export default function SessionScreen() {
  const { t, language } = useLanguage();

  const params = useLocalSearchParams<{
    id: string;
    scope_server?: string;
    scope_tenant?: string;
    scope_workspace?: string;
    scope_workspace_revision?: string;
    scope_work_session?: string;
    scope_relation_revision?: string;
    scope_authority?: string;
    scope_kind?: string;
    scope_session_revision?: string;
    scope_principal_generation?: string;
    scope_authorization_revision?: string;
  }>();
  const { id } = params;
  const { snapshot, storageScope, busyAction, sendFollowUp, stopRun } =
    useMobile();
  const { state: lifecycleState } = useMobileLifecycle();
  const {
    catalog,
    findServer,
    findWorkspace,
    status: workspaceStatus,
  } = useWorkspaces();
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [details, setDetails] = useState(false);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [dictationMessage, setDictationMessage] = useState(
    'Voice is transcribed on this device and stays editable before sending.',
  );
  const dictationBase = useRef('');
  const followUpLimit = snapshot.connection.limits.maxFollowUpBytes;
  const candidateSession = snapshot.sessions.find(
    (candidate) => candidate.target.coordinate.id === id,
  );
  const scopeRequested = params.scope_server !== undefined;
  const scopedServer =
    params.scope_server === undefined ? null : findServer(params.scope_server);
  const scopedWorkspace =
    params.scope_server === undefined || params.scope_workspace === undefined
      ? null
      : findWorkspace(params.scope_server, params.scope_workspace);
  const scopedRelation = scopedWorkspace?.sessions.find(
    (relation) =>
      relation.id === params.scope_work_session && relation.target.id === id,
  );
  const scopeValid =
    !scopeRequested ||
    (params.scope_server !== undefined &&
      params.scope_tenant !== undefined &&
      params.scope_workspace !== undefined &&
      params.scope_workspace_revision !== undefined &&
      params.scope_work_session !== undefined &&
      params.scope_relation_revision !== undefined &&
      params.scope_authority !== undefined &&
      params.scope_kind !== undefined &&
      params.scope_session_revision !== undefined &&
      params.scope_principal_generation !== undefined &&
      params.scope_authorization_revision !== undefined &&
      lifecycleState.phase === 'ready' &&
      lifecycleState.profile?.serverIdentity === params.scope_server &&
      catalog.phase === 'live' &&
      workspaceStatus.phase === 'live' &&
      scopedServer?.authorization === 'active' &&
      scopedServer.actions.includes('workspace_read') &&
      scopedServer.tenantId === params.scope_tenant &&
      scopedServer.principalGeneration === params.scope_principal_generation &&
      scopedServer.authorizationRevision ===
        params.scope_authorization_revision &&
      scopedWorkspace?.revision === params.scope_workspace_revision &&
      !scopedServer.staleProjectIds.includes(scopedWorkspace.projectId) &&
      scopedWorkspace.navigation.some(
        (grant) =>
          grant.destination === 'chat' &&
          grant.revision === scopedWorkspace.revision,
      ) &&
      scopedRelation?.revision === params.scope_relation_revision &&
      scopedRelation.target.authority === params.scope_authority &&
      scopedRelation.target.kind === params.scope_kind &&
      scopedRelation.target.id === id &&
      candidateSession?.target.coordinate.authority ===
        params.scope_authority &&
      candidateSession.target.coordinate.kind === params.scope_kind &&
      candidateSession.target.coordinate.id === id &&
      candidateSession.target.revision === params.scope_session_revision);
  const session = scopeValid ? candidateSession : undefined;
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
      <Screen bottomInset>
        <Text style={{ color: palette.text }}>
          {scopeRequested
            ? t(
                'The exact scoped session is no longer current. Return to the workspace and refresh before continuing.',
              )
            : t('Session is not present in the bounded projection.')}
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
        t('Follow-up not sent'),
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
        lang: language === 'fr' ? 'fr-FR' : 'en-US',
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
        t('Run not stopped'),
        error instanceof Error ? error.message : 'unknown_error',
      );
    }
  }

  const composer = (
    <ChatComposer
      value={draft}
      onChangeText={setDraft}
      inputLabel="Follow-up message"
      sendLabel="Send follow-up"
      editable={followUpAllowed}
      maxLength={followUpLimit}
      placeholder={
        followUpAllowed
          ? t('Message Monique…')
          : t('Replies unavailable — check connection')
      }
      canSend={
        followUpAllowed && !dictating && !!draft.trim() && draftWithinLimit
      }
      busy={busyAction !== null}
      onSend={() => void submitFollowUp()}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            dictating ? t('Stop voice dictation') : t('Start voice dictation')
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
            {dictating ? t('■ Stop listening') : t('◉ Voice')}
          </Text>
        </Pressable>
      }
    >
      {(dictating || !dictationMessage.startsWith('Voice is transcribed')) && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.voiceStatus, { color: palette.textMuted }]}
        >
          {t(dictationMessage)}
        </Text>
      )}
      {draftBytes > followUpLimit * 0.8 && (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.byteLimit,
            {
              color: draftWithinLimit ? palette.textMuted : palette.danger,
            },
          ]}
        >
          {draftBytes} / {followUpLimit} {' ' + t('bytes')}
          {draftWithinLimit ? '' : t(' · too long')}
        </Text>
      )}
      {session.run && session.state === 'active' && (
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
            {t('Stop response')}
          </Text>
        </Pressable>
      )}
    </ChatComposer>
  );
  return (
    <Screen key={id} bottomInset footer={composer} followTail={!details}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={[styles.title, { color: palette.text }]}
        >
          {session.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: details }}
          onPress={() => setDetails(!details)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.textMuted }}>
            {details ? t('Hide details') : t('Conversation details')}
          </Text>
        </Pressable>
        {details && (
          <View>
            {' '}
            <Text style={[styles.meta, { color: palette.textMuted }]}>
              {session.target.coordinate.authority}/
              {session.target.coordinate.kind}/{session.target.coordinate.id}
            </Text>
            <Text style={[styles.meta, { color: palette.textMuted }]}>
              {t('revision') + ' '}
              {session.target.revision} {' ' + t('· cursor') + ' '}
              {session.lastCursor}
            </Text>
            <Text style={[styles.meta, { color: palette.textMuted }]}>
              {t('run') + ' '}
              {session.run?.coordinate.id ?? 'none'}
            </Text>
          </View>
        )}
      </View>

      <Text
        accessibilityLiveRegion="polite"
        style={{ color: palette.textMuted }}
      >
        {!session.attachable
          ? t('Conversation saved')
          : session.state === 'active'
            ? t('Monique is working…')
            : session.state === 'lost'
              ? t('Run status unavailable. Check Details before retrying.')
              : session.state === 'waiting'
                ? t('Waiting for a decision')
                : t('Conversation saved')}
      </Text>
      <View style={styles.timeline}>
        {events.filter((event) => event.kind === 'message').length === 0 && (
          <Text
            style={{
              color: palette.textMuted,
              paddingVertical: 24,
              textAlign: 'center',
            }}
          >
            {session.state === 'active'
              ? t('Monique is preparing a response…')
              : t('No messages available yet.')}
          </Text>
        )}
        <SessionTimeline
          key={`${id}:${details}`}
          events={events}
          diagnostics={details}
        />
      </View>

      <ApprovalContent sessionId={id} />

      {details && receipts.length > 0 && (
        <View style={styles.timeline}>
          <Text
            accessibilityRole="header"
            style={[styles.section, { color: palette.text }]}
          >
            {t('Durable receipts')}
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
  title: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  meta: { fontSize: 12 },
  section: { fontSize: 19, fontWeight: '800' },
  timeline: { gap: 11 },
  byteLimit: { fontSize: 12, textAlign: 'right' },
  voice: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceStatus: { fontSize: 12, lineHeight: 18 },
  stop: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
