// SPDX-License-Identifier: Elastic-2.0

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { usePalette } from '@/theme/palette';

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  editable,
  canSend,
  busy = false,
  inputLabel = 'Message Monique',
  sendLabel = 'Send message',
  placeholder = 'Message Monique…',
  maxLength,
  accessory,
  children,
}: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly editable: boolean;
  readonly canSend: boolean;
  readonly busy?: boolean;
  readonly inputLabel?: string;
  readonly sendLabel?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly accessory?: ReactNode;
  readonly children?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={styles.entry}>
        <TextInput
          accessibilityLabel={inputLabel}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          multiline
          scrollEnabled
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          maxLength={maxLength}
          style={[styles.input, { color: palette.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          accessibilityState={{ disabled: !canSend, busy }}
          disabled={!canSend}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: canSend ? palette.accent : palette.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : (
            <Text
              accessible={false}
              style={{
                fontSize: 24,
                fontWeight: '600',
                color: canSend ? palette.accentText : palette.textMuted,
              }}
            >
              ↑
            </Text>
          )}
        </Pressable>
      </View>
      {accessory && <View style={styles.accessory}>{accessory}</View>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 24, padding: 8, gap: 4 },
  entry: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 144,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    fontSize: 16,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  send: {
    width: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
