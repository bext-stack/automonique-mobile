// SPDX-License-Identifier: Elastic-2.0

import { workFeedBlocks, readableWorkDate } from '@/core/work-presentation';
import { useFocusEffect } from 'expo-router';
import { SlackMessage } from '@/components/slack-message';
import { useLanguage } from '@/i18n/language';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MobileWorkTicket } from '@automonique/sdk';
import { SectionTabs } from '@/components/section-tabs';
import { ConnectionBanner } from '@/components/connection-banner';
import { Screen } from '@/components/screen';
import {
  createWorkExecution,
  isWorkNotApplied,
  type WorkIntent,
} from '@/core/work-execution';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export default function WorkScreen() {
  const { storageScope, snapshot, projectionReady } = useMobile();
  return (
    <WorkContent
      key={`${storageScope ?? 'unpaired'}:${snapshot.connection.phase}:${projectionReady}:${snapshot.connection.mutationsAllowed}`}
    />
  );
}
function WorkContent() {
  const { t, language } = useLanguage();

  const { workGateway, storageScope, snapshot, projectionReady } = useMobile();
  const palette = usePalette();
  const [section, setSection] = useState<'tickets' | 'slack' | 'new'>(
    'tickets',
  );
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [slackQuery, setSlackQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selectedTicket !== null) {
          setSelectedTicket(null);
          return true;
        }
        if (section !== 'tickets') {
          setSection('tickets');
          return true;
        }
        return false;
      });
      return () => listener.remove();
    }, [selectedTicket, section]),
  );
  const [channel, setChannel] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [tickets, setTickets] = useState<readonly MobileWorkTicket[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [issue, setIssue] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<WorkIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [channelError, setChannelError] = useState('');
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueError, setQueueError] = useState('');
  const active = useRef(false);
  const lifetime = useRef(new AbortController());
  const execution = useMemo(
    () =>
      workGateway && storageScope
        ? createWorkExecution(
            storageScope,
            AsyncStorage,
            workGateway,
            Crypto.randomUUID,
          )
        : null,
    [workGateway, storageScope],
  );
  const allowed =
    !!workGateway &&
    projectionReady &&
    snapshot.connection.phase === 'live' &&
    snapshot.connection.mutationsAllowed &&
    snapshot.connection.allowedActions.includes('manage_work');
  const reload = useCallback(
    async (signal: AbortSignal) => {
      if (!workGateway) return;
      const [feed, queue] = await Promise.allSettled([
        workGateway.request({ action: 'channel' }, signal),
        workGateway.request({ action: 'snapshot' }, signal),
      ]);
      if (signal.aborted) return;
      setQueueLoaded(true);
      if (feed.status === 'fulfilled' && feed.value.kind === 'channel') {
        setChannel({ name: feed.value.channel, text: feed.value.text });
        setChannelError('');
      } else {
        setChannel(null);
        setChannelError('Channel unavailable. Refresh to try again.');
      }
      if (queue.status === 'fulfilled' && queue.value.kind === 'queue') {
        setTickets(queue.value.items);
        setHasMore(queue.value.hasMore);
        setQueueError('');
      } else {
        setTickets([]);
        setQueueError('Queue unavailable. No ticket state could be verified.');
      }
    },
    [workGateway],
  );
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (execution && allowed) {
      void execution
        .read()
        .then((value) => {
          if (!controller.signal.aborted) {
            setPending(value !== null);
            setLoaded(true);
            void reload(controller.signal);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setMessage(
              'Recovery storage unavailable. Queue actions are disabled.',
            );
        });
    }
    return () => controller.abort();
  }, [execution, allowed, reload]);
  async function run(retry: boolean) {
    if (
      !execution ||
      !allowed ||
      !loaded ||
      active.current ||
      (!retry && !confirm)
    )
      return;
    active.current = true;
    setBusy(true);
    setMessage('');
    const signal = lifetime.current.signal;
    try {
      const result = retry
        ? await execution.retry(signal)
        : await execution.submit(confirm!, signal);
      if (signal.aborted) return;
      setPending(false);
      setConfirm(null);
      setReason('');
      setIssue('');
      if (result.kind === 'receipt')
        setMessage(`Manage confirmed: ${result.status.replaceAll('_', ' ')}.`);
      await reload(signal);
    } catch (error) {
      if (signal.aborted) return;
      try {
        setPending((await execution.read()) !== null);
      } catch {
        setLoaded(false);
      }
      setConfirm(null);
      setMessage(
        !retry && isWorkNotApplied(error)
          ? 'Manage did not apply this request. Check the ticket and refresh the queue before trying again.'
          : 'No confirmed result. Refresh the queue before retrying the same request; a retry keeps its original request key.',
      );
    } finally {
      active.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  const disabled = !allowed || !loaded || busy || pending;
  const textStyle = { color: palette.text };
  const inputStyle = [
    styles.input,
    { color: palette.text, borderColor: palette.border },
  ];
  return (
    <Screen
      key={`${section}:${selectedTicket ?? 'list'}`}
      showConnectionBanner={false}
    >
      <ConnectionBanner compact />
      <SectionTabs
        value={section}
        onChange={(next) => {
          setSection(next);
          setSelectedTicket(null);
        }}
        items={[
          { id: 'tickets', label: t('Tickets') },
          { id: 'slack', label: 'Slack' },
          { id: 'new', label: t('New ticket') },
        ]}
      />
      {!workGateway ? (
        <Text style={textStyle}>
          {t(
            'Pair this phone with “Read Slack and manage tickets” enabled in the dashboard. Existing phone permissions stay unchanged.',
          )}
        </Text>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Text style={{ color: palette.textMuted, fontSize: 12, flex: 1 }}>
              {section === 'tickets'
                ? selectedTicket
                  ? t('Ticket details')
                  : `${tickets.length} ${t('tickets')} · ${tickets.filter((ticket) => ticket.job_status === 'pending_approval').length} ${t('to approve')}`
                : section === 'slack'
                  ? t('Recent messages · refresh for updates')
                  : t(
                      'Creates a pending gate. Approve it separately to release work.',
                    )}
            </Text>
            <WorkButton
              label={t('Refresh')}
              onPress={() => void reload(lifetime.current.signal)}
              disabled={!allowed || busy}
            />
          </View>
          {!allowed && (
            <Text style={textStyle}>
              {t('Reconnect to read Slack and manage work.')}
            </Text>
          )}
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={textStyle}>
              {message && t(message)}
            </Text>
          )}
          {pending && (
            <View style={[styles.card, { borderColor: palette.border }]}>
              <Text style={textStyle}>
                {t(
                  'An earlier request needs confirmation. New queue actions are paused.',
                )}
              </Text>
              {
                <WorkButton
                  label={t('Retry same request')}
                  onPress={() => {
                    void run(true);
                  }}
                  disabled={!allowed || !loaded || busy}
                />
              }
            </View>
          )}
          {section === 'slack' && (
            <>
              <Text style={[styles.heading, textStyle]}>
                {channel ? `#${channel.name}` : t('Slack channel')}
              </Text>

              {!!channelError && (
                <Text style={textStyle}>{t(channelError)}</Text>
              )}
              <TextInput
                accessibilityLabel={t('Search messages')}
                placeholder={t('Search messages')}
                placeholderTextColor={palette.textMuted}
                value={slackQuery}
                onChangeText={setSlackQuery}
                style={inputStyle}
              />
              <Text style={{ color: palette.textMuted, fontSize: 11 }}>
                {t('Long-press text to select or copy.')}
              </Text>
              {channel &&
                (channel.text ? (
                  workFeedBlocks(channel.text)
                    .filter(
                      (block) =>
                        !slackQuery.trim() ||
                        `${block.author ?? ''} ${block.text}`
                          .toLowerCase()
                          .includes(slackQuery.trim().toLowerCase()),
                    )
                    .map((block, index) => (
                      <SlackMessage
                        key={`${block.timestamp ?? 'intro'}:${index}`}
                        block={block}
                        canPrepare={!disabled}
                        onError={() => setMessage('Could not open this link.')}
                        onPrepareTicket={(url) => {
                          setIssue(url);
                          setSelectedTicket(null);
                          setSection('new');
                        }}
                      />
                    ))
                ) : (
                  <Text style={textStyle}>{t('No recent messages.')}</Text>
                ))}
              {channel &&
                slackQuery.trim() &&
                !workFeedBlocks(channel.text).some((block) =>
                  `${block.author ?? ''} ${block.text}`
                    .toLowerCase()
                    .includes(slackQuery.trim().toLowerCase()),
                ) && (
                  <Text style={{ color: palette.textMuted }}>
                    {t('No matching messages.')}
                  </Text>
                )}
            </>
          )}
          {section === 'new' && (
            <>
              <Text style={[styles.heading, textStyle]}>
                {t('Add a GitHub ticket')}
              </Text>
              <Text style={{ color: palette.textMuted }}>
                {t(
                  'Creates a pending gate. Approve it separately to release work.',
                )}
              </Text>
              <TextInput
                accessibilityLabel={t('GitHub issue URL')}
                placeholder={t('https://github.com/owner/repo/issues/123')}
                placeholderTextColor={palette.textMuted}
                value={issue}
                onChangeText={setIssue}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                style={inputStyle}
              />
              {
                <WorkButton
                  label={t('Review ticket submission')}
                  onPress={() =>
                    setConfirm({ action: 'dispatch', issue_url: issue.trim() })
                  }
                  disabled={
                    disabled ||
                    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(
                      issue.trim(),
                    )
                  }
                />
              }
            </>
          )}
          {section === 'tickets' && (
            <>
              {selectedTicket ? (
                <WorkButton
                  label={t('Back to tickets')}
                  onPress={() => setSelectedTicket(null)}
                  disabled={false}
                />
              ) : (
                <>
                  <TextInput
                    accessibilityLabel={t('Search tickets')}
                    placeholder={t('Search tickets')}
                    placeholderTextColor={palette.textMuted}
                    value={query}
                    onChangeText={setQuery}
                    style={inputStyle}
                  />
                  <SectionTabs
                    value={pendingOnly ? 'pending' : 'all'}
                    onChange={(next) => setPendingOnly(next === 'pending')}
                    items={[
                      { id: 'all', label: t('All tickets') },
                      { id: 'pending', label: t('Awaiting approval') },
                    ]}
                  />
                </>
              )}

              {!queueLoaded && allowed && (
                <Text style={textStyle}>{t('Loading queue…')}</Text>
              )}
              {!!queueError && <Text style={textStyle}>{t(queueError)}</Text>}
              {allowed &&
                queueLoaded &&
                !queueError &&
                tickets.length === 0 && (
                  <Text style={textStyle}>
                    {t('No tickets in the latest queue response.')}
                  </Text>
                )}
              {hasMore && !selectedTicket && (
                <Text style={{ color: palette.textMuted }}>
                  {t('Showing the 50 most recently updated tickets.')}
                </Text>
              )}
              {tickets
                .filter((ticket) =>
                  selectedTicket
                    ? ticket.job_id === selectedTicket
                    : (!pendingOnly ||
                        ticket.job_status === 'pending_approval') &&
                      `${ticket.issue_title} ${ticket.issue_url}`
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
                )
                .map((ticket) => (
                  <View
                    key={ticket.job_id}
                    style={[styles.card, { borderColor: palette.border }]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t('Open ticket')}: ${ticket.issue_title}`}
                      onPress={() => setSelectedTicket(ticket.job_id)}
                      style={{
                        minHeight: 44,
                        justifyContent: 'center',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Text
                        numberOfLines={selectedTicket ? undefined : 2}
                        style={[styles.ticketTitle, textStyle]}
                      >
                        {ticket.issue_title}
                      </Text>
                    </Pressable>
                    <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                      {t(ticket.job_status.replaceAll('_', ' '))}
                    </Text>
                    {selectedTicket === ticket.job_id && (
                      <>
                        <Text style={{ color: palette.textMuted }}>
                          {t('Updated') + ' '}
                          {readableWorkDate(ticket.updated_at, language)}
                        </Text>
                        {
                          <WorkButton
                            label={t('Open GitHub issue')}
                            onPress={() => {
                              void Linking.openURL(ticket.issue_url).catch(() =>
                                setMessage('Could not open GitHub.'),
                              );
                            }}
                            disabled={false}
                          />
                        }
                        {ticket.job_status === 'pending_approval' && (
                          <View style={styles.row}>
                            {
                              <WorkButton
                                label={t('Approve ticket')}
                                onPress={() =>
                                  setConfirm({
                                    action: 'decide',
                                    job_id: ticket.job_id,
                                    source_key: ticket.source_key,
                                    decision: 'approve',
                                    reason: '',
                                  })
                                }
                                disabled={disabled}
                              />
                            }
                            {
                              <WorkButton
                                label={t('Reject ticket')}
                                onPress={() => {
                                  setReason('');
                                  setConfirm({
                                    action: 'decide',
                                    job_id: ticket.job_id,
                                    source_key: ticket.source_key,
                                    decision: 'reject',
                                    reason: '',
                                  });
                                }}
                                disabled={disabled}
                              />
                            }
                          </View>
                        )}
                      </>
                    )}
                  </View>
                ))}
              {!selectedTicket &&
                queueLoaded &&
                !queueError &&
                tickets.length > 0 &&
                !tickets.some(
                  (ticket) =>
                    (!pendingOnly ||
                      ticket.job_status === 'pending_approval') &&
                    `${ticket.issue_title} ${ticket.issue_url}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                ) && (
                  <Text style={{ color: palette.textMuted }}>
                    {t('No tickets match these filters.')}
                  </Text>
                )}
              {selectedTicket &&
                queueLoaded &&
                !queueError &&
                !tickets.some((ticket) => ticket.job_id === selectedTicket) && (
                  <Text style={textStyle}>
                    {t(
                      'This ticket is no longer in the current queue. Refresh or return to the list.',
                    )}
                  </Text>
                )}
            </>
          )}
          {confirm && (
            <Modal
              transparent
              animationType="none"
              onRequestClose={() => {
                if (!busy) setConfirm(null);
              }}
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.modalBackdrop}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  accessibilityViewIsModal
                  style={[
                    styles.card,
                    {
                      borderColor: palette.accent,
                      backgroundColor: palette.surface,
                      maxHeight: '90%',
                    },
                  ]}
                >
                  <Text style={[styles.heading, textStyle]}>
                    {t('Confirm')}{' '}
                    {confirm.action === 'dispatch'
                      ? t('ticket submission')
                      : confirm.decision}
                  </Text>
                  <Text selectable style={textStyle}>
                    {confirm.action === 'dispatch'
                      ? confirm.issue_url
                      : (tickets.find(
                          (ticket) => ticket.job_id === confirm.job_id,
                        )?.issue_title ?? confirm.job_id)}
                  </Text>
                  {confirm.action === 'decide' &&
                    confirm.decision === 'approve' && (
                      <Text style={textStyle}>
                        {t('This releases the pending ticket for execution.')}
                      </Text>
                    )}
                  {confirm.action === 'decide' &&
                    confirm.decision === 'reject' && (
                      <TextInput
                        accessibilityLabel={t('Reason for rejecting ticket')}
                        value={reason}
                        onChangeText={(value) => {
                          setReason(value);
                          setConfirm({ ...confirm, reason: value });
                        }}
                        placeholder={t('Reason for rejection')}
                        placeholderTextColor={palette.textMuted}
                        style={inputStyle}
                        multiline
                        maxLength={500}
                      />
                    )}
                  {
                    <WorkButton
                      label={t('Confirm action')}
                      onPress={() => {
                        void run(false);
                      }}
                      disabled={
                        disabled ||
                        (confirm.action === 'decide' &&
                          confirm.decision === 'reject' &&
                          (reason.trim() === '' ||
                            new TextEncoder().encode(reason).length > 500))
                      }
                    />
                  }
                  {
                    <WorkButton
                      label={t('Back')}
                      onPress={() => setConfirm(null)}
                      disabled={busy}
                    />
                  }
                </ScrollView>
              </KeyboardAvoidingView>
            </Modal>
          )}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  ticketTitle: { fontSize: 16, fontWeight: '700' },
  button: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
    marginVertical: 5,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  transcript: { lineHeight: 22, marginVertical: 10 },
});

function WorkButton({
  label,
  onPress,
  disabled: off,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
}) {
  const { t } = useLanguage();
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: palette.border, opacity: off ? 0.45 : 1 },
      ]}
    >
      <Text style={{ color: palette.accent, fontWeight: '700' }}>
        {t(label)}
      </Text>
    </Pressable>
  );
}
