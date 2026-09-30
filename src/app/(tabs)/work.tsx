// SPDX-License-Identifier: Elastic-2.0
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MobileWorkTicket } from '@automonique/sdk';
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
  const { workGateway, storageScope, snapshot, projectionReady } = useMobile();
  const palette = usePalette();
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
    <Screen>
      <Text style={[styles.title, textStyle]}>Slack and work queue</Text>
      {!workGateway ? (
        <Text style={textStyle}>
          Pair this phone with “Read Slack and manage tickets” enabled in the
          dashboard. Existing phone permissions stay unchanged.
        </Text>
      ) : (
        <>
          <Text style={{ color: palette.textMuted }}>
            Tickets belong to the selected server’s Manage instance. Approval
            releases work for execution.
          </Text>
          {
            <WorkButton
              label={'Refresh channel and queue'}
              onPress={() => {
                void reload(lifetime.current.signal);
              }}
              disabled={!allowed || busy}
            />
          }
          {!allowed && (
            <Text style={textStyle}>
              Reconnect to read Slack and manage work.
            </Text>
          )}
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={textStyle}>
              {message}
            </Text>
          )}
          {pending && (
            <View style={[styles.card, { borderColor: palette.border }]}>
              <Text style={textStyle}>
                An earlier request needs confirmation. New queue actions are
                paused.
              </Text>
              {
                <WorkButton
                  label={'Retry same request'}
                  onPress={() => {
                    void run(true);
                  }}
                  disabled={!allowed || !loaded || busy}
                />
              }
            </View>
          )}
          <Text style={[styles.heading, textStyle]}>
            {channel ? `#${channel.name}` : 'Slack channel'}
          </Text>
          <Text style={{ color: palette.textMuted }}>
            Recent messages · refresh for updates
          </Text>
          {!!channelError && <Text style={textStyle}>{channelError}</Text>}
          {channel && (
            <Text selectable style={[styles.transcript, textStyle]}>
              {channel.text || 'No recent messages.'}
            </Text>
          )}
          <Text style={[styles.heading, textStyle]}>Add a GitHub ticket</Text>
          <Text style={{ color: palette.textMuted }}>
            Creates a pending gate. Approve it separately to release work.
          </Text>
          <TextInput
            accessibilityLabel="GitHub issue URL"
            placeholder="https://github.com/owner/repo/issues/123"
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
              label={'Review ticket submission'}
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
          <Text style={[styles.heading, textStyle]}>Ticket queue</Text>
          {!queueLoaded && allowed && (
            <Text style={textStyle}>Loading queue…</Text>
          )}
          {!!queueError && <Text style={textStyle}>{queueError}</Text>}
          {allowed && queueLoaded && !queueError && tickets.length === 0 && (
            <Text style={textStyle}>
              No tickets in the latest queue response.
            </Text>
          )}
          {hasMore && (
            <Text style={{ color: palette.textMuted }}>
              Showing the 50 most recently updated tickets.
            </Text>
          )}
          {tickets.map((ticket) => (
            <View
              key={ticket.job_id}
              style={[styles.card, { borderColor: palette.border }]}
            >
              <Text style={[styles.ticketTitle, textStyle]}>
                {ticket.issue_title}
              </Text>
              <Text style={textStyle}>
                {ticket.job_status.replaceAll('_', ' ')}
              </Text>
              <Text style={{ color: palette.textMuted }}>
                Updated {ticket.updated_at}
              </Text>
              {
                <WorkButton
                  label={'Open GitHub issue'}
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
                      label={'Approve ticket'}
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
                      label={'Reject ticket'}
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
            </View>
          ))}
          {confirm && (
            <Modal
              transparent
              animationType="slide"
              onRequestClose={() => {
                if (!busy) setConfirm(null);
              }}
            >
              <View style={styles.modalBackdrop}>
                <View
                  accessibilityViewIsModal
                  style={[
                    styles.card,
                    {
                      borderColor: palette.accent,
                      backgroundColor: palette.surface,
                    },
                  ]}
                >
                  <Text style={[styles.heading, textStyle]}>
                    Confirm{' '}
                    {confirm.action === 'dispatch'
                      ? 'ticket submission'
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
                        This releases the pending ticket for execution.
                      </Text>
                    )}
                  {confirm.action === 'decide' &&
                    confirm.decision === 'reject' && (
                      <TextInput
                        accessibilityLabel="Reason for rejecting ticket"
                        value={reason}
                        onChangeText={(value) => {
                          setReason(value);
                          setConfirm({ ...confirm, reason: value });
                        }}
                        placeholder="Reason for rejection"
                        placeholderTextColor={palette.textMuted}
                        style={inputStyle}
                        multiline
                        maxLength={500}
                      />
                    )}
                  {
                    <WorkButton
                      label={'Confirm action'}
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
                      label={'Back'}
                      onPress={() => setConfirm(null)}
                      disabled={busy}
                    />
                  }
                </View>
              </View>
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
  title: { fontSize: 25, fontWeight: '800', marginBottom: 12 },
  heading: { fontSize: 19, fontWeight: '700', marginTop: 14, marginBottom: 8 },
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
    marginVertical: 8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
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
      <Text style={{ color: palette.accent, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
