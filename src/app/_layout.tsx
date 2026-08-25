// SPDX-License-Identifier: Elastic-2.0

import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  ProductionMobileProvider,
  useMobileLifecycle,
} from '@/providers/production-mobile-provider';
import { useReducedMotion } from '@/core/accessibility';
import { admitsOperationalNavigation } from '@/core/navigation-policy';
import { usePalette } from '@/theme/palette';

function Navigation() {
  const palette = usePalette();
  const reducedMotion = useReducedMotion();
  const { state } = useMobileLifecycle();
  const segments = useSegments();
  if (state.phase === 'loading') return <StatusBar style="auto" />;
  if (!admitsOperationalNavigation(state.phase) && segments[0] !== 'settings') {
    return <Redirect href="/settings" />;
  }
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
    <ProductionMobileProvider>
      <Navigation />
    </ProductionMobileProvider>
  );
}
