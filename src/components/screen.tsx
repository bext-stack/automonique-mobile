// SPDX-License-Identifier: Elastic-2.0

import {
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
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
  readonly followTail?: boolean;
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
  followTail = false,
  showConnectionBanner = true,
  bottomInset = false,
  contentContainerStyle,
}: ScreenProps) {
  const palette = usePalette();
  const frameRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  function goToLatest() {
    nearBottom.current = true;
    setShowLatest(false);
    scrollRef.current?.scrollToEnd({ animated: false });
  }
  const content = (
    <>
      {showConnectionBanner && <ConnectionBanner />}
      {children}
    </>
  );

  return (
    <SafeAreaView
      ref={frameRef}
      onLayout={() =>
        frameRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y))
      }
      style={[styles.safeArea, { backgroundColor: palette.background }]}
      edges={bottomInset ? ['bottom'] : []}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        keyboardVerticalOffset={keyboardOffset}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            accessibilityLabel={
              followTail ? 'Conversation messages' : undefined
            }
            onContentSizeChange={
              followTail
                ? () => {
                    if (nearBottom.current) goToLatest();
                    else setShowLatest(true);
                  }
                : undefined
            }
            onLayout={
              followTail
                ? () => {
                    if (nearBottom.current) goToLatest();
                  }
                : undefined
            }
            onScroll={
              followTail
                ? ({ nativeEvent }) => {
                    nearBottom.current =
                      nativeEvent.contentSize.height -
                        nativeEvent.layoutMeasurement.height -
                        nativeEvent.contentOffset.y <
                      80;
                    setShowLatest(!nearBottom.current);
                  }
                : undefined
            }
            scrollEventThrottle={100}
            keyboardDismissMode="on-drag"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[styles.content, contentContainerStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.flex]}>{content}</View>
        )}
        {followTail && showLatest && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to latest message"
            onPress={goToLatest}
            style={{
              alignSelf: 'center',
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 18,
              marginBottom: 6,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
            }}
          >
            <Text style={{ color: palette.text }}>↓ Latest messages</Text>
          </Pressable>
        )}
        {footer && (
          <View
            style={{
              paddingHorizontal: 14,
              paddingBottom: 8,
              width: '100%',
              maxWidth: 760,
              alignSelf: 'center',
            }}
          >
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
