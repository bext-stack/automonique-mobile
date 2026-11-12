// SPDX-License-Identifier: Elastic-2.0

import { LanguageProvider, useLanguage } from '@/i18n/language';

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
  const { t } = useLanguage();

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
          <Stack.Screen
            name="task"
            options={{ title: t('New conversation') }}
          />
          <Stack.Screen name="agents" options={{ title: t('Agents') }} />
          <Stack.Screen name="agent/[id]" options={{ title: t('Call') }} />
          <Stack.Screen
            name="session/[id]"
            options={{ title: t('Conversation') }}
          />
          <Stack.Screen
            name="workspace/[server]/[workspace]/index"
            options={{ title: t('Workspace') }}
          />
          <Stack.Screen
            name="workspace/[server]/[workspace]/session/[session]"
            options={{ title: t('Retained session') }}
          />
        </Stack.Protected>
        <Stack.Screen name="settings" options={{ title: t('Connection') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <ProductionMobileProvider>
        <Navigation />
      </ProductionMobileProvider>
    </LanguageProvider>
  );
}
