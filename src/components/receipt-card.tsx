// SPDX-License-Identifier: Elastic-2.0

import { StyleSheet, Text, View } from 'react-native';

import type { Receipt } from '@/core/types';
import { usePalette } from '@/theme/palette';

export function ReceiptCard({ receipt }: { readonly receipt: Receipt }) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${receipt.action} receipt ${receipt.outcome}`}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.action, { color: palette.text }]}>
          {receipt.action}
        </Text>
        <Text style={[styles.outcome, { color: palette.accent }]}>
          {receipt.outcome}
        </Text>
      </View>
      <Text style={[styles.meta, { color: palette.textMuted }]}>
        revision {receipt.revision}
      </Text>
      <Text
        style={[styles.meta, { color: palette.textMuted }]}
        numberOfLines={1}
      >
        {receipt.id ?? `pending · ${receipt.idempotencyKey}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  action: { fontSize: 14, fontWeight: '700' },
  outcome: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  meta: { fontSize: 11 },
});
