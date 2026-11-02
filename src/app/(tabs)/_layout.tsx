// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { ConversationMenu } from '@/components/conversation-menu';
import { Tabs } from 'expo-router';
import { Image, View, type ColorValue } from 'react-native';

import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

const icons = {
  index: require('../../../assets/icons/chat.png'),
  overview: require('../../../assets/icons/dashboard.png'),
  work: require('../../../assets/icons/work.png'),
  workspaces: require('../../../assets/icons/projects.png'),
  approvals: require('../../../assets/icons/approvals.png'),
} as const;

function TabIcon({
  name,
  color,
  focused,
}: {
  readonly name: keyof typeof icons;
  readonly color: ColorValue;
  readonly focused: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessible={false}
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? palette.surfaceMuted : 'transparent',
      }}
    >
      <Image
        source={icons[name]}
        accessible={false}
        style={{ width: 23, height: 23, tintColor: color }}
      />
    </View>
  );
}

export default function OperatorTabs() {
  const { t } = useLanguage();

  const palette = usePalette();
  const { snapshot } = useMobile();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        tabBarHideOnKeyboard: true,
        headerLeft: () => <ConversationMenu />,
        sceneStyle: { backgroundColor: palette.background },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          borderTopWidth: 0.5,
          paddingTop: 6,
          minHeight: 72,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 3 },
        tabBarItemStyle: { paddingVertical: 3 },
        tabBarBadgeStyle: {
          backgroundColor: palette.accent,
          color: palette.accentText,
          fontSize: 10,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('Monique'),
          tabBarLabel: t('Chat'),
          tabBarAccessibilityLabel: t('Chat with Monique'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused} color={color} name="index" />
          ),
        }}
      />
      <Tabs.Screen
        name="overview"
        options={{
          title: t('Dashboard'),
          tabBarLabel: t('Overview'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused} color={color} name="overview" />
          ),
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: t('Work'),
          tabBarAccessibilityLabel: t('Slack and ticket queue'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused} color={color} name="work" />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: t('Sessions'),
          href: null,
        }}
      />
      <Tabs.Screen
        name="workspaces"
        options={{
          title: t('Projects'),
          tabBarAccessibilityLabel: t('Projects and workspaces'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused} color={color} name="workspaces" />
          ),
        }}
      />
      <Tabs.Screen
        name="attention"
        options={{
          title: t('Attention'),
          href: null,
          tabBarAccessibilityLabel: t('Workspace review attention'),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: t('Approvals'),
          ...(snapshot.approvals.length > 0
            ? { tabBarBadge: snapshot.approvals.length }
            : {}),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused} color={color} name="approvals" />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('Activity'),
          href: null,
        }}
      />
      <Tabs.Screen
        name="server"
        options={{
          title: t('Server'),
          href: null,
        }}
      />
    </Tabs>
  );
}
