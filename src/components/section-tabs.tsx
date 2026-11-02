// SPDX-License-Identifier: Elastic-2.0
import { Pressable, Text, View } from 'react-native';
import { usePalette } from '@/theme/palette';
export function SectionTabs<T extends string>({
  value,
  onChange,
  items,
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly items: readonly { id: T; label: string }[];
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: 4,
        padding: 4,
        borderRadius: 14,
        backgroundColor: palette.surfaceMuted,
      }}
    >
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: value === item.id }}
          onPress={() => onChange(item.id)}
          style={{
            flex: 1,
            minHeight: 44,
            paddingHorizontal: 6,
            paddingVertical: 10,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor:
              value === item.id ? palette.surface : 'transparent',
          }}
        >
          <Text
            style={{
              color: value === item.id ? palette.text : palette.textMuted,
              fontWeight: value === item.id ? '700' : '500',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
