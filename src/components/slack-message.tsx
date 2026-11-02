// SPDX-License-Identifier: Elastic-2.0

import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import {
  presentSlackText,
  readableWorkDate,
  type FeedBlock,
} from '@/core/work-presentation';
import { useLanguage } from '@/i18n/language';
import { usePalette } from '@/theme/palette';

export function SlackMessage({
  block,
  canPrepare,
  onPrepareTicket,
  onError,
}: {
  readonly block: FeedBlock;
  readonly canPrepare: boolean;
  readonly onPrepareTicket: (url: string) => void;
  readonly onError: () => void;
}) {
  const { t, language } = useLanguage();
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const message = useMemo(() => presentSlackText(block.text), [block.text]);
  const long = message.text.length > 320 || message.text.split('\n').length > 6;
  const button = {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };
  if (!block.author)
    return (
      <Text
        selectable
        style={{ color: palette.textMuted, fontSize: 12, lineHeight: 18 }}
      >
        {message.text}
      </Text>
    );
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        borderRadius: 16,
        padding: 12,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          accessible={false}
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            backgroundColor: palette.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: palette.accent, fontWeight: '700' }}>
            {block.author.slice(0, 1).toLocaleUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{ color: palette.text, fontWeight: '700', fontSize: 14 }}
          >
            {block.author}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 11 }}>
            {block.timestamp && readableWorkDate(block.timestamp, language)}
          </Text>
        </View>
      </View>
      <Text
        selectable
        numberOfLines={long && !expanded ? 6 : undefined}
        style={{ color: palette.text, fontSize: 14, lineHeight: 22 }}
      >
        {message.text}
      </Text>
      {long && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={button}
        >
          <Text style={{ color: palette.accent }}>
            {expanded ? t('Show less') : t('Read full message')}
          </Text>
        </Pressable>
      )}
      {message.links.map((link) => (
        <View
          key={link.url}
          style={{
            borderTopWidth: 1,
            borderColor: palette.border,
            paddingTop: 8,
            gap: 4,
          }}
        >
          {!link.issueUrl && (
            <Text
              numberOfLines={2}
              style={{ color: palette.textMuted, fontSize: 11 }}
            >
              {link.host}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${t('Open link')}: ${link.url}`}
              onPress={() => void Linking.openURL(link.url).catch(onError)}
              style={[button, { backgroundColor: palette.surfaceMuted }]}
            >
              <Text style={{ color: palette.text, fontSize: 13 }}>
                {link.issueUrl ? 'GitHub' : t('Open link')} ↗
              </Text>
            </Pressable>
            {link.issueUrl && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('Prepare ticket')}: ${link.issueUrl}`}
                accessibilityState={{ disabled: !canPrepare }}
                disabled={!canPrepare}
                onPress={() => onPrepareTicket(link.issueUrl!)}
                style={[button, { opacity: canPrepare ? 1 : 0.45 }]}
              >
                <Text
                  style={{
                    color: palette.accent,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {t('Prepare ticket')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
