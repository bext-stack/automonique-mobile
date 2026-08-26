// SPDX-License-Identifier: Elastic-2.0

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  ProductionMobileProvider,
  useMobileLifecycle,
} from '@/providers/production-mobile-provider';
import { useReducedMotion } from '@/core/accessibility';
import { admitsOperationalNavigation } from '@/core/navigation-policy';
import { usePalette } from '@/theme/palette';

export function Navigation() {
  const palette = usePalette();
  const reducedMotion = useReducedMotion();
  const { state } = useMobileLifecycle();
  if (state.phase === 'loading') return <StatusBar style="auto" />;
  const operational = admitsOperationalNavigation(state.phase);
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
        <Stack.Protected guard={operational}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
        </Stack.Protected>
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
