// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MobileHttpsOrigin, type MobilePairingOffer } from '@automonique/sdk';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PairingScanner } from '@/components/pairing-scanner';
import { Screen } from '@/components/screen';
import { MAX_ENDPOINT_BYTES, normalizeEndpoint } from '@/core/network-policy';
import {
  decodePairingOfferText,
  MAX_PAIRING_OFFER_BYTES,
} from '@/core/pairing-offer';
import {
  describeServerConnectionError,
  inspectAutomoniqueServer,
  type CompatibleAutomoniqueServer,
} from '@/core/server-connection';
import { AUTOMONIQUE_SDK_METADATA } from '@/core/sdk-metadata';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { usePalette } from '@/theme/palette';

const ENDPOINT_DRAFT_KEY = 'automonique.mobile.endpoint-draft.v1';

type ServerCheck =
  | { readonly phase: 'idle' }
  | { readonly phase: 'checking' }
  | {
      readonly phase: 'compatible';
      readonly server: CompatibleAutomoniqueServer;
    }
  | { readonly phase: 'failed'; readonly message: string };

function shortIdentity(identity: string): string {
  return `${identity.slice(0, 18)}…${identity.slice(-10)}`;
}

function normalizeEndpointForDisplay(value: string): string {
  try {
    return normalizeEndpoint(value, false);
  } catch {
    return 'https://your-automonique-server';
  }
}

export default function SettingsScreen() {
  const { snapshot } = useMobile();
  const { state, pair, refreshCredential, revokeCredential } =
    useMobileLifecycle();
  const palette = usePalette();
  const checkController = useRef<AbortController | null>(null);
  const [endpoint, setEndpoint] = useState('https://');
  const [message, setMessage] = useState(
    'Connect this app to the Automonique server you already operate.',
  );
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [pairingOffer, setPairingOffer] = useState('');
  const [pendingOffer, setPendingOffer] = useState<MobilePairingOffer | null>(
    null,
  );
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerGeneration, setScannerGeneration] = useState(0);
  const [serverCheck, setServerCheck] = useState<ServerCheck>({
    phase: 'idle',
  });
  const transportLabel = snapshot.connection.synthetic
    ? 'Synthetic fixture through the mobile gateway'
    : `${snapshot.connection.phase === 'live' ? 'Live' : 'Read-only'} ${AUTOMONIQUE_SDK_METADATA.packageName} transport`;
  const needsSetup =
    state.phase === 'unpaired' || state.phase === 'recovery_required';

  useEffect(() => {
    void (async () => {
      let value: string | null;
      try {
        value = await AsyncStorage.getItem(ENDPOINT_DRAFT_KEY);
      } catch {
        return;
      }
      if (value === null) return;
      try {
        setEndpoint(MobileHttpsOrigin(normalizeEndpoint(value, false)));
      } catch {
        await AsyncStorage.removeItem(ENDPOINT_DRAFT_KEY).catch(
          () => undefined,
        );
      }
    })();
    return () => checkController.current?.abort();
  }, []);

  async function checkServer() {
    checkController.current?.abort();
    const controller = new AbortController();
    checkController.current = controller;
    setServerCheck({ phase: 'checking' });
    try {
      const server = await inspectAutomoniqueServer(
        endpoint,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setEndpoint(server.origin);
      setServerCheck({ phase: 'compatible', server });
      await AsyncStorage.setItem(ENDPOINT_DRAFT_KEY, server.origin).catch(
        () => undefined,
      );
      setMessage(
        'Server verified. Create a one-time mobile invite on that server, then scan or paste it below.',
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setServerCheck({
        phase: 'failed',
        message: describeServerConnectionError(error),
      });
    } finally {
      if (checkController.current === controller) {
        checkController.current = null;
      }
    }
  }

  function reviewPairingOffer(rawOffer: string) {
    setPairingOffer('');
    try {
      const offer = decodePairingOfferText(rawOffer);
      setPendingOffer(offer);
      setEndpoint(offer.origin);
      setServerCheck({
        phase: 'compatible',
        server: {
          origin: offer.origin,
          platformEndpoint: `${offer.origin}/api/platform`,
          protocolVersion: '1',
          serverIdentity: offer.server_identity,
        },
      });
      setMessage('Invite decoded. Confirm the server below before connecting.');
    } catch {
      setPendingOffer(null);
      setMessage('That is not a valid, current Automonique pairing invite.');
    }
  }

  async function connectPendingOffer() {
    if (pendingOffer === null) return;
    const offer = pendingOffer;
    setLifecycleBusy(true);
    try {
      await pair(offer);
      setMessage(
        `Connected to ${offer.origin}. The one-time invite was cleared.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'mobile_pairing_failed',
      );
    } finally {
      setPendingOffer(null);
      setLifecycleBusy(false);
    }
  }

  async function refreshAccess() {
    setLifecycleBusy(true);
    try {
      await refreshCredential();
      setMessage('Secure access refreshed.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'credential_refresh_failed',
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function revokeAccess() {
    setLifecycleBusy(true);
    try {
      await revokeCredential();
      setMessage('This device was revoked and its local credentials removed.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'credential_revoke_failed',
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
    <Screen showConnectionBanner={!needsSetup}>
      <PairingScanner
        key={scannerGeneration}
        onCancel={() => setScannerVisible(false)}
        onScan={(value) => {
          setScannerVisible(false);
          reviewPairingOffer(value);
        }}
        visible={scannerVisible}
      />

      <View style={styles.hero}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {needsSetup ? 'Connect your server' : 'Your Automonique server'}
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {needsSetup
            ? 'Use your existing self-hosted installation. The app verifies its public mobile API, then accepts a short-lived invite created by your server.'
            : 'This phone has scoped access to the server, sessions, and actions listed below.'}
        </Text>
      </View>

      {needsSetup && (
        <>
          <View
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <StepHeading
              number="1"
              title="Check your server"
              copy="Enter the public HTTPS origin in front of Automonique. No admin credential is requested or sent by this check."
            />
            <TextInput
              accessibilityLabel="Automonique HTTPS endpoint"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={MAX_ENDPOINT_BYTES}
              onChangeText={(value) => {
                setEndpoint(value);
                setServerCheck({ phase: 'idle' });
              }}
              placeholder="https://ops.example.com"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border },
              ]}
              value={endpoint}
            />
            <Pressable
              accessibilityRole="button"
              disabled={serverCheck.phase === 'checking'}
              onPress={() => void checkServer()}
              style={[styles.button, { backgroundColor: palette.accent }]}
            >
              <Text style={{ color: palette.accentText, fontWeight: '800' }}>
                {serverCheck.phase === 'checking'
                  ? 'Checking…'
                  : 'Check this server'}
              </Text>
            </Pressable>
            {serverCheck.phase === 'compatible' && (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.result,
                  {
                    borderColor: palette.success,
                    backgroundColor: palette.surfaceMuted,
                  },
                ]}
              >
                <Text style={[styles.resultTitle, { color: palette.success }]}>
                  Compatible Automonique server
                </Text>
                <Text style={[styles.metadata, { color: palette.text }]}>
                  {serverCheck.server.origin} · mobile protocol v
                  {serverCheck.server.protocolVersion}
                </Text>
                <Text
                  selectable
                  style={[styles.digest, { color: palette.textMuted }]}
                >
                  Identity {serverCheck.server.serverIdentity}
                </Text>
              </View>
            )}
            {serverCheck.phase === 'failed' && (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.result, { borderColor: palette.danger }]}
              >
                <Text style={[styles.resultTitle, { color: palette.danger }]}>
                  Server not ready
                </Text>
                <Text style={[styles.copy, { color: palette.textMuted }]}>
                  {serverCheck.message}
                </Text>
              </View>
            )}
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <StepHeading
              number="2"
              title="Create a mobile invite"
              copy="From an authenticated operator session or your existing deployment tooling, choose the sessions and allowed actions for this phone, then create a one-time mobile pairing invite. It expires within five minutes."
            />
            <View style={styles.endpointHint}>
              <Text style={[styles.hintLabel, { color: palette.textMuted }]}>
                Operator API for your existing tooling
              </Text>
              <Text selectable style={[styles.digest, { color: palette.text }]}>
                {`${normalizeEndpointForDisplay(endpoint)}/api/mobile/pairings`}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <StepHeading
              number="3"
              title="Pair this phone"
              copy="Scan the invite QR code or paste its canonical JSON. The app shows the pinned server identity before it exchanges the one-time secret."
            />

            {Platform.OS !== 'web' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setScannerGeneration((generation) => generation + 1);
                  setScannerVisible(true);
                }}
                style={[styles.button, { backgroundColor: palette.accent }]}
              >
                <Text style={{ color: palette.accentText, fontWeight: '800' }}>
                  Scan pairing QR code
                </Text>
              </Pressable>
            )}

            <TextInput
              accessibilityLabel="One-time pairing offer"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={MAX_PAIRING_OFFER_BYTES}
              multiline
              onChangeText={setPairingOffer}
              placeholder="Paste one-time invite JSON"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.pairingInput,
                { color: palette.text, borderColor: palette.border },
              ]}
              value={pairingOffer}
            />
            <Pressable
              accessibilityRole="button"
              disabled={pairingOffer.trim().length === 0}
              onPress={() => reviewPairingOffer(pairingOffer)}
              style={[styles.secondaryButton, { borderColor: palette.border }]}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                Review pasted invite
              </Text>
            </Pressable>

            {pendingOffer !== null && (
              <View
                accessibilityLabel="Pairing invite confirmation"
                style={[
                  styles.confirmation,
                  {
                    borderColor: palette.warning,
                    backgroundColor: palette.warningSurface,
                  },
                ]}
              >
                <Text style={[styles.cardTitle, { color: palette.text }]}>
                  Connect to {pendingOffer.origin}?
                </Text>
                <Text style={[styles.copy, { color: palette.textMuted }]}>
                  Invite expires{' '}
                  {new Date(
                    Number(pendingOffer.expires_at_ms),
                  ).toLocaleString()}
                  . Confirm that this is your server before continuing.
                </Text>
                <Text
                  selectable
                  style={[styles.digest, { color: palette.textMuted }]}
                >
                  {pendingOffer.server_identity}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={lifecycleBusy}
                  onPress={() => void connectPendingOffer()}
                  style={[styles.button, { backgroundColor: palette.accent }]}
                >
                  <Text
                    style={{ color: palette.accentText, fontWeight: '800' }}
                  >
                    {lifecycleBusy ? 'Connecting…' : 'Connect this server'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={lifecycleBusy}
                  onPress={() => setPendingOffer(null)}
                  style={[
                    styles.secondaryButton,
                    { borderColor: palette.border },
                  ]}
                >
                  <Text style={{ color: palette.text, fontWeight: '800' }}>
                    Cancel invite
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </>
      )}

      <View
        accessibilityLabel="Mobile credential lifecycle"
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.cardTitle, { color: palette.text }]}>Access</Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {state.phase === 'ready'
            ? 'Connected and ready'
            : `Connection state: ${state.phase.replaceAll('_', ' ')}`}
        </Text>
        {state.profile !== null && (
          <>
            <Text selectable style={[styles.metadata, { color: palette.text }]}>
              {state.profile.actor} · {state.profile.credentialId}
            </Text>
            <Text style={[styles.status, { color: palette.textMuted }]}>
              {state.profile.origin} · identity{' '}
              {shortIdentity(state.profile.serverIdentity)}
            </Text>
            <Text style={[styles.status, { color: palette.textMuted }]}>
              Access expires{' '}
              {new Date(
                Number(state.profile.accessExpiresAtMs),
              ).toLocaleString()}
            </Text>
          </>
        )}
        {state.phase === 'refresh_required' && (
          <Pressable
            accessibilityRole="button"
            disabled={lifecycleBusy}
            onPress={() => void refreshAccess()}
            style={[styles.button, { backgroundColor: palette.accent }]}
          >
            <Text style={{ color: palette.accentText, fontWeight: '800' }}>
              Refresh secure access
            </Text>
          </Pressable>
        )}
        {state.profile !== null && state.phase !== 'recovery_required' && (
          <Pressable
            accessibilityRole="button"
            disabled={lifecycleBusy}
            onPress={() => void revokeAccess()}
            style={[styles.secondaryButton, { borderColor: palette.border }]}
          >
            <Text style={{ color: palette.text, fontWeight: '800' }}>
              Revoke this device
            </Text>
          </Pressable>
        )}
      </View>

      {state.profile !== null && (
        <View
          accessibilityLabel="Authorized mobile scope"
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Authorized scope
          </Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            This phone can only use the actions and sessions issued by the
            server. Changing the scope requires a new server authorization.
          </Text>
          <View style={styles.chips}>
            {state.profile.actions.map((action) => (
              <View
                key={action}
                style={[styles.chip, { backgroundColor: palette.surfaceMuted }]}
              >
                <Text style={[styles.chipText, { color: palette.text }]}>
                  {action.replaceAll('_', ' ')}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.label, { color: palette.text }]}>
            Sessions ({state.profile.sessionScope.length})
          </Text>
          {state.profile.sessionScope.map((sessionId) => (
            <Text
              key={sessionId}
              selectable
              style={[styles.scopeId, { color: palette.textMuted }]}
            >
              {sessionId}
            </Text>
          ))}
          <Text style={[styles.status, { color: palette.textMuted }]}>
            Up to {state.profile.maxPageEvents} events per page ·{' '}
            {state.profile.maxFollowUpBytes} follow-up bytes
          </Text>
        </View>
      )}

      <Text
        accessibilityLiveRegion="polite"
        style={[styles.message, { color: palette.textMuted }]}
      >
        {message}
      </Text>

      <View
        accessibilityLabel="Automonique SDK protocol metadata"
        style={[
          styles.diagnostics,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.label, { color: palette.text }]}>Diagnostics</Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {transportLabel}
        </Text>
        <Text style={[styles.metadata, { color: palette.text }]}>
          {AUTOMONIQUE_SDK_METADATA.schema} · protocol v
          {AUTOMONIQUE_SDK_METADATA.protocolVersion}
        </Text>
        <Text style={[styles.status, { color: palette.textMuted }]}>
          {AUTOMONIQUE_SDK_METADATA.protocol}
        </Text>
        <Text selectable style={[styles.digest, { color: palette.textMuted }]}>
          {AUTOMONIQUE_SDK_METADATA.schemaDigest}
        </Text>
      </View>

      <View
        style={[
          styles.notice,
          {
            backgroundColor: palette.warningSurface,
            borderColor: palette.warning,
          },
        ]}
      >
        <Text style={[styles.noticeTitle, { color: palette.text }]}>
          Safe on unreliable networks
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          Cached reads and drafts remain available offline. Follow-ups,
          decisions, and stops are disabled whenever the server view is stale;
          uncertain commands reconcile by receipt instead of being replayed.
        </Text>
      </View>
    </Screen>
  );
}

function StepHeading({
  number,
  title,
  copy,
}: {
  readonly number: string;
  readonly title: string;
  readonly copy: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.stepHeading}>
      <View style={[styles.step, { backgroundColor: palette.accent }]}>
        <Text style={{ color: palette.accentText, fontWeight: '900' }}>
          {number}
        </Text>
      </View>
      <View style={styles.stepCopy}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>{copy}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 7 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  label: { fontSize: 14, fontWeight: '800' },
  stepHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  step: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCopy: { flex: 1, gap: 5 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  pairingInput: {
    minHeight: 104,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  result: { borderWidth: 1, borderRadius: 13, padding: 13, gap: 6 },
  resultTitle: { fontSize: 14, fontWeight: '800' },
  confirmation: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  endpointHint: { gap: 5 },
  hintLabel: { fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  scopeId: { fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  status: { fontSize: 12, lineHeight: 18 },
  metadata: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  digest: { fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  message: { fontSize: 13, lineHeight: 19, paddingHorizontal: 2 },
  diagnostics: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 7 },
  notice: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 7 },
  noticeTitle: { fontSize: 15, fontWeight: '800' },
});
