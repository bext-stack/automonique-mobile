// SPDX-License-Identifier: Elastic-2.0

import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
  readonly footer?: ReactNode;
  readonly showConnectionBanner?: boolean;
  /**
   * Keep content clear of the system navigation bar. Screens pushed on the
   * stack need it; tab screens do not, because the tab bar already sits there.
   */
  readonly bottomInset?: boolean;
  readonly contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
}

export function Screen({
  children,
  footer,
  scroll = true,
  showConnectionBanner = true,
  bottomInset = false,
  contentContainerStyle,
}: ScreenProps) {
  const palette = usePalette();
  const content = (
    <>
      {showConnectionBanner && <ConnectionBanner />}
      {children}
    </>
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.background }]}
      edges={bottomInset ? ['bottom'] : []}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {scroll ? (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[styles.content, contentContainerStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.flex]}>{content}</View>
        )}
        {footer && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    padding: 14,
    gap: 12,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  flex: { flex: 1 },
});
