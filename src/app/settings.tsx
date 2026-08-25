// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { normalizeEndpoint } from '@/core/network-policy';
import { usePalette } from '@/theme/palette';

const ENDPOINT_DRAFT_KEY = 'automonique.mobile.endpoint-draft.v1';

export default function SettingsScreen() {
  const palette = usePalette();
  const [endpoint, setEndpoint] = useState('https://');
  const [message, setMessage] = useState(
    'Production connection is unavailable until scoped mobile authorization is implemented server-side.',
  );

  useEffect(() => {
    void AsyncStorage.getItem(ENDPOINT_DRAFT_KEY).then((value) => {
      if (value) setEndpoint(value);
    });
  }, []);

  function validateDraft() {
    try {
      const normalized = normalizeEndpoint(endpoint, false);
      void AsyncStorage.setItem(ENDPOINT_DRAFT_KEY, normalized);
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
  notice: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 7 },
  noticeTitle: { fontSize: 15, fontWeight: '800' },
});
