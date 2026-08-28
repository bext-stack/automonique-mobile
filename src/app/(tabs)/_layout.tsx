// SPDX-License-Identifier: Elastic-2.0

import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

const icons = {
  index: '⌂',
  sessions: '◉',
  workspaces: '◇',
  attention: '!',
  approvals: '✓',
  activity: '≋',
  server: '⌘',
} as const;

function TabIcon({
  name,
  color,
}: {
  readonly name: keyof typeof icons;
  readonly color: ColorValue;
}) {
  return (
    <Text style={{ color, fontSize: 19, fontWeight: '800' }}>
      {icons[name]}
    </Text>
  );
}

export default function OperatorTabs() {
  const palette = usePalette();
  const { snapshot } = useMobile();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: palette.background },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home overview',
          tabBarIcon: ({ color }) => <TabIcon color={color} name="index" />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <TabIcon color={color} name="sessions" />,
        }}
      />
      <Tabs.Screen
        name="workspaces"
        options={{
          title: 'Workspaces',
          tabBarAccessibilityLabel: 'Projects and workspaces',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name="workspaces" />
          ),
        }}
      />
      <Tabs.Screen
        name="attention"
        options={{
          title: 'Attention',
          tabBarAccessibilityLabel: 'Workspace review attention',
          tabBarIcon: ({ color }) => <TabIcon color={color} name="attention" />,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          ...(snapshot.approvals.length > 0
            ? { tabBarBadge: snapshot.approvals.length }
            : {}),
          tabBarIcon: ({ color }) => <TabIcon color={color} name="approvals" />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <TabIcon color={color} name="activity" />,
        }}
      />
      <Tabs.Screen
        name="server"
        options={{
          title: 'Server',
          tabBarIcon: ({ color }) => <TabIcon color={color} name="server" />,
        }}
      />
    </Tabs>
  );
}
