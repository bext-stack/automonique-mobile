// SPDX-License-Identifier: Elastic-2.0

import type { PropsWithChildren } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionBanner } from './connection-banner';
import { usePalette } from '@/theme/palette';

interface ScreenProps extends PropsWithChildren {
  readonly scroll?: boolean;
  readonly contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
}

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
}: ScreenProps) {
  const palette = usePalette();
  const content = (
    <>
      <ConnectionBanner />
      {children}
    </>
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.background }]}
      edges={['top']}
    >
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, contentContainerStyle]}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex]}>{content}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    padding: 20,
    gap: 16,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  flex: { flex: 1 },
});
