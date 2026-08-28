// SPDX-License-Identifier: Elastic-2.0

import { render } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import type { MobileLifecycleState } from '@/core/mobile-lifecycle';

import { Navigation } from './app/_layout';

let mockPhase: MobileLifecycleState['phase'] = 'loading';

jest.mock('@/providers/production-mobile-provider', () => ({
  ProductionMobileProvider: ({ children }: PropsWithChildren) => children,
  useMobileLifecycle: () => ({ state: { phase: mockPhase, profile: null } }),
}));

jest.mock('@/core/accessibility', () => ({ useReducedMotion: () => false }));
jest.mock('@/theme/palette', () => ({
  usePalette: () => ({ background: '#fff', text: '#000' }),
}));
jest.mock('expo-status-bar', () => {
  const { Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    StatusBar: function MockStatusBar() {
      return <MockText testID="status-bar">status</MockText>;
    },
  };
});
jest.mock('expo-router', () => {
  const { Text: MockText, View: MockView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  function MockStack({ children }: PropsWithChildren) {
    return <MockView testID="stack">{children}</MockView>;
  }
  MockStack.Screen = function MockScreen({ name }: { readonly name: string }) {
    return <MockText testID={`screen-${name}`}>{name}</MockText>;
  };
  MockStack.Protected = function MockProtected({
    children,
    guard,
  }: PropsWithChildren<{ readonly guard: boolean }>) {
    return (
      <MockView
        testID="operational-routes"
        accessibilityState={{ disabled: !guard }}
      >
        {children}
      </MockView>
    );
  };
  return { Stack: MockStack };
});

beforeEach(() => {
  mockPhase = 'loading';
});

test('keeps the navigator unmounted while credential hydration is loading', async () => {
  const view = await render(<Navigation />);
  expect(view.getByTestId('status-bar')).toBeTruthy();
  expect(view.queryByTestId('stack')).toBeNull();
});

test('uses protected screens instead of a render-time redirect when unpaired', async () => {
  mockPhase = 'unpaired';
  const view = await render(<Navigation />);

  expect(
    view.getByTestId('operational-routes').props.accessibilityState,
  ).toEqual({
    disabled: true,
  });
  expect(view.getByTestId('screen-settings')).toBeTruthy();
  expect(view.getByTestId('screen-(tabs)')).toBeTruthy();
  expect(view.getByTestId('screen-session/[id]')).toBeTruthy();
  expect(
    view.getByTestId('screen-workspace/[server]/[workspace]/index'),
  ).toBeTruthy();
  expect(
    view.getByTestId('screen-workspace/[server]/[workspace]/session/[session]'),
  ).toBeTruthy();
});

test('admits operational screens only for a ready credential', async () => {
  mockPhase = 'ready';
  const view = await render(<Navigation />);

  expect(
    view.getByTestId('operational-routes').props.accessibilityState,
  ).toEqual({
    disabled: false,
  });
});
