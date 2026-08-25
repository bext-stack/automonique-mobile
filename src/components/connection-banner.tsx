// SPDX-License-Identifier: Elastic-2.0

import { StyleSheet, Text, View } from 'react-native';

import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export function ConnectionBanner() {
  const { snapshot } = useMobile();
  const palette = usePalette();
  const stale = snapshot.connection.phase !== 'live';

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Connection: ${snapshot.connection.label}`}
      style={[
        styles.banner,
        {
          backgroundColor: stale
            ? palette.warningSurface
            : palette.surfaceMuted,
          borderColor: stale ? palette.warning : palette.border,
        },
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: stale ? palette.warning : palette.success },
        ]}
      />
      <View style={styles.copy}>
        <Text style={[styles.status, { color: palette.text }]}>
          {stale ? 'Stale · read only' : 'Live · synthetic'}
        </Text>
        <Text style={[styles.label, { color: palette.textMuted }]}>
          {snapshot.connection.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  copy: { flex: 1, gap: 2 },
  status: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: 12 },
});
