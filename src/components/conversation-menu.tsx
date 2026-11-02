// SPDX-License-Identifier: Elastic-2.0
import { Link } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

export function ConversationMenu() {
  const [open, setOpen] = useState(false);
  const { snapshot } = useMobile();
  const palette = usePalette();
  const row = { minHeight: 48, padding: 12, justifyContent: 'center' as const };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open conversation history"
        onPress={() => setOpen(true)}
        style={row}
      >
        <Text style={{ color: palette.text, fontSize: 22 }}>☰</Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="none"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{ flex: 1, flexDirection: 'row', backgroundColor: '#0008' }}
        >
          <SafeAreaView
            style={{
              width: '88%',
              maxWidth: 380,
              backgroundColor: palette.background,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 12,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ fontSize: 22, fontWeight: '700', color: palette.text }}
              >
                Conversations
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close conversation history"
                onPress={() => setOpen(false)}
                style={row}
              >
                <Text style={{ color: palette.text }}>Close</Text>
              </Pressable>
            </View>
            <Link href="/task" asChild>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                style={row}
              >
                <Text style={{ color: palette.accent, fontWeight: '700' }}>
                  ＋ New conversation
                </Text>
              </Pressable>
            </Link>
            <ScrollView>
              {(snapshot.sessions ?? []).map((session) => (
                <Link
                  key={session.target.coordinate.id}
                  href={{
                    pathname: '/session/[id]',
                    params: { id: session.target.coordinate.id },
                  }}
                  asChild
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOpen(false)}
                    style={row}
                  >
                    <Text
                      numberOfLines={2}
                      style={{ color: palette.text, fontSize: 15 }}
                    >
                      {session.title === 'Conversation'
                        ? (
                            snapshot.timelines?.[
                              session.target.coordinate.id
                            ]?.find(
                              (event) =>
                                event.kind === 'message' &&
                                event.role === 'user',
                            ) as { text?: string } | undefined
                          )?.text?.slice(0, 100) || session.title
                        : session.title}
                    </Text>
                    <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                      {session.attachable
                        ? session.state
                        : 'Saved conversation'}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
            {(
              [
                ['/(tabs)/sessions', 'All conversations'],
                ['/(tabs)/attention', 'Needs attention'],
                ['/(tabs)/activity', 'Activity'],
                ['/(tabs)/server', 'Server & settings'],
              ] as const
            ).map(([href, label]) => (
              <Link key={href} href={href} asChild>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpen(false)}
                  style={row}
                >
                  <Text style={{ color: palette.text }}>{label}</Text>
                </Pressable>
              </Link>
            ))}
          </SafeAreaView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss conversation history"
            style={{ flex: 1 }}
            onPress={() => setOpen(false)}
          />
        </View>
      </Modal>
    </>
  );
}
