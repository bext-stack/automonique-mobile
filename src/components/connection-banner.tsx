// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export function ConnectionBanner({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const { t } = useLanguage();

  const { snapshot, busyAction, projectionReady, refreshProjection } =
    useMobile();
  const palette = usePalette();
  const stale = snapshot.connection.phase !== 'live';

  return (
    <View
      style={[
        styles.banner,
        compact &&
          !stale && {
            borderWidth: 0,
            backgroundColor: 'transparent',
            paddingVertical: 2,
            paddingHorizontal: 0,
          },
        {
          backgroundColor: stale
            ? palette.warningSurface
            : compact
              ? 'transparent'
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
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Connection: ${t(snapshot.connection.label)}`}
        style={styles.copy}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: palette.text }]}
        >
          {snapshot.connection.phase === 'reconnecting'
            ? t('Refreshing')
            : stale
              ? t('Not up to date · read only')
              : snapshot.connection.synthetic
                ? t('Live · synthetic')
                : t('Live')}
        </Text>
        {stale && (
          <Text
            numberOfLines={stale ? undefined : 1}
            style={[styles.label, { color: palette.textMuted }]}
          >
            {t(snapshot.connection.label)}
          </Text>
        )}
      </View>
      {stale && projectionReady && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Reconnect and refresh projection')}
          accessibilityState={{ disabled: busyAction !== null }}
          disabled={busyAction !== null}
          onPress={() => void refreshProjection()}
          style={[
            styles.retry,
            { borderColor: palette.warning, opacity: busyAction ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.retryText, { color: palette.text }]}>
            {t('Retry')}
          </Text>
        </Pressable>
      )}
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
  retry: {
    minHeight: 44,
    minWidth: 60,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  retryText: { fontSize: 13, fontWeight: '800' },
});
