// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MobileHttpsOrigin } from '@automonique/sdk';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { MAX_ENDPOINT_BYTES, normalizeEndpoint } from '@/core/network-policy';
import {
  decodePairingOfferText,
  MAX_PAIRING_OFFER_BYTES,
} from '@/core/pairing-offer';
import { AUTOMONIQUE_SDK_METADATA } from '@/core/sdk-metadata';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { usePalette } from '@/theme/palette';

const ENDPOINT_DRAFT_KEY = 'automonique.mobile.endpoint-draft.v1';

export default function SettingsScreen() {
  const { snapshot } = useMobile();
  const { state, pair, refreshCredential, revokeCredential } =
    useMobileLifecycle();
  const palette = usePalette();
  const [endpoint, setEndpoint] = useState('https://');
  const [message, setMessage] = useState(
    'Enter the exact HTTPS server origin used by a one-time pairing offer.',
  );
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [pairingOffer, setPairingOffer] = useState('');
  const transportLabel = snapshot.connection.synthetic
    ? 'Synthetic fixture through the mobile gateway'
    : `${snapshot.connection.phase === 'live' ? 'Live' : 'Read-only'} ${AUTOMONIQUE_SDK_METADATA.packageName} transport`;

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
  }, []);

  function validateDraft() {
    try {
      const normalized = MobileHttpsOrigin(normalizeEndpoint(endpoint, false));
      void AsyncStorage.setItem(ENDPOINT_DRAFT_KEY, normalized).catch(
        () => undefined,
      );
      setEndpoint(normalized);
      setMessage(
        'Origin policy passed. No credential was requested and no network call was made.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'invalid_url');
    }
  }

  async function refreshAccess() {
    setLifecycleBusy(true);
    try {
      await refreshCredential();
      setMessage('Credential rotation completed and was committed securely.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'credential_refresh_failed',
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function exchangePairingOffer() {
    const rawOffer = pairingOffer;
    setPairingOffer('');
    setLifecycleBusy(true);
    try {
      const offer = decodePairingOfferText(rawOffer);
      await pair(offer);
      setEndpoint(offer.origin);
      setMessage('Pairing completed. The one-time proof was cleared.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'mobile_pairing_failed',
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function revokeAccess() {
    setLifecycleBusy(true);
    try {
      await revokeCredential();
      setMessage(
        'Credential revoked on the server and removed from this device.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'credential_revoke_failed',
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
    <Screen>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.text }]}
      >
        Connection
      </Text>
      <Text style={[styles.copy, { color: palette.textMuted }]}>
        Live navigation requires an origin-pinned, one-time pairing exchange.
        Access is scoped to the server-issued actor, sessions, actions, limits,
        and expiry shown below.
      </Text>
      <View
        accessibilityLabel="Automonique SDK protocol metadata"
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.label, { color: palette.text }]}>
          SDK boundary
        </Text>
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
      {(state.phase === 'unpaired' || state.phase === 'recovery_required') && (
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.label, { color: palette.text }]}>
            One-time pairing offer
          </Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            Paste the exact canonical JSON created by the server operator. It
            expires after five minutes and is never saved as a draft.
          </Text>
          <TextInput
            accessibilityLabel="One-time pairing offer"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={MAX_PAIRING_OFFER_BYTES}
            multiline
            onChangeText={setPairingOffer}
            style={[
              styles.pairingInput,
              { color: palette.text, borderColor: palette.border },
            ]}
            value={pairingOffer}
          />
          <Pressable
            accessibilityRole="button"
            disabled={lifecycleBusy || pairingOffer.trim().length === 0}
            onPress={() => void exchangePairingOffer()}
            style={[styles.button, { backgroundColor: palette.accent }]}
          >
            <Text style={{ color: palette.accentText, fontWeight: '800' }}>
              Exchange once and connect
            </Text>
          </Pressable>
        </View>
      )}
      <View
        accessibilityLabel="Mobile credential lifecycle"
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.label, { color: palette.text }]}>Credential</Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          State: {state.phase}
        </Text>
        {state.profile !== null && (
          <>
            <Text selectable style={[styles.metadata, { color: palette.text }]}>
              {state.profile.actor} · {state.profile.credentialId}
            </Text>
            <Text
              selectable
              style={[styles.digest, { color: palette.textMuted }]}
            >
              {state.profile.serverIdentity}
            </Text>
            <Text style={[styles.status, { color: palette.textMuted }]}>
              Access expires{' '}
              {new Date(Number(state.profile.accessExpiresAtMs)).toISOString()}
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
              Rotate credential
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
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.label, { color: palette.text }]}>
          HTTPS server origin
        </Text>
        <TextInput
          accessibilityLabel="Automonique HTTPS endpoint"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={MAX_ENDPOINT_BYTES}
          onChangeText={setEndpoint}
          style={[
            styles.input,
            { color: palette.text, borderColor: palette.border },
          ]}
          value={endpoint}
        />
        <Pressable
          accessibilityRole="button"
          onPress={validateDraft}
          style={[styles.button, { backgroundColor: palette.accent }]}
        >
          <Text style={{ color: palette.accentText, fontWeight: '800' }}>
            Validate origin without connecting
          </Text>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: palette.textMuted }]}
        >
          {message}
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
          No offline mutation outbox
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          Cached reads and drafts remain available offline. Follow-ups,
          decisions, and stops are disabled whenever the projection is stale.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  label: { fontSize: 14, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  pairingInput: {
    minHeight: 112,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { fontSize: 12, lineHeight: 18 },
  metadata: { fontSize: 13, fontWeight: '700' },
  digest: { fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  notice: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 7 },
  noticeTitle: { fontSize: 15, fontWeight: '800' },
});
