// SPDX-License-Identifier: Elastic-2.0

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { MobileProvider } from '@/providers/mobile-provider';
import { useReducedMotion } from '@/core/accessibility';
import { usePalette } from '@/theme/palette';

function Navigation() {
  const palette = usePalette();
  const reducedMotion = useReducedMotion();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.background },
          animation: reducedMotion ? 'none' : 'default',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Automonique' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
        <Stack.Screen name="approvals" options={{ title: 'Approvals' }} />
        <Stack.Screen name="settings" options={{ title: 'Connection' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <MobileProvider>
      <Navigation />
    </MobileProvider>
  );
}
