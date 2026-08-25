// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { MAX_ENDPOINT_BYTES, normalizeEndpoint } from '@/core/network-policy';
import { AUTOMONIQUE_SDK_METADATA } from '@/core/sdk-metadata';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

const ENDPOINT_DRAFT_KEY = 'automonique.mobile.endpoint-draft.v1';

export default function SettingsScreen() {
  const { snapshot } = useMobile();
  const palette = usePalette();
  const [endpoint, setEndpoint] = useState('https://');
  const [message, setMessage] = useState(
    'Production connection is unavailable until scoped mobile authorization is implemented server-side.',
  );
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
        setEndpoint(normalizeEndpoint(value, false));
      } catch {
        await AsyncStorage.removeItem(ENDPOINT_DRAFT_KEY).catch(
          () => undefined,
        );
      }
    })();
  }, []);

  function validateDraft() {
    try {
      const normalized = normalizeEndpoint(endpoint, false);
      void AsyncStorage.setItem(ENDPOINT_DRAFT_KEY, normalized).catch(
        () => undefined,
      );
      setEndpoint(normalized);
      setMessage(
        'Endpoint policy passed. No credential was requested and no network call was made.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'invalid_url');
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
        The first baseline is intentionally synthetic. A future live connection
        must negotiate server identity, actor-scoped actions, limits, expiry,
        refresh, and revocation before navigation.
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
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.label, { color: palette.text }]}>
          HTTPS endpoint draft
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
            Validate without connecting
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
  button: {
    minHeight: 48,
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
