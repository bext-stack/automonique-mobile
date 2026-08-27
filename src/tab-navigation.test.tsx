// SPDX-License-Identifier: Elastic-2.0

import { render } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import OperatorTabs from './app/(tabs)/_layout';

jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => ({ snapshot: { approvals: [{ id: 'approval-1' }] } }),
}));
jest.mock('@/theme/palette', () => ({
  usePalette: () => ({
    accent: '#070',
    background: '#fff',
    border: '#ddd',
    surface: '#fff',
    text: '#000',
    textMuted: '#666',
  }),
}));
jest.mock('expo-router', () => {
  const { Text: MockText, View: MockView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  function MockTabs({ children }: PropsWithChildren) {
    return <MockView testID="operator-tabs">{children}</MockView>;
  }
  MockTabs.Screen = function MockTabScreen({
    name,
    options,
  }: {
    readonly name: string;
    readonly options: { readonly tabBarBadge?: number };
  }) {
    return (
      <MockText testID={`tab-${name}`}>
        {name}:{options.tabBarBadge ?? 0}
      </MockText>
    );
  };
  return { Tabs: MockTabs };
});

test('exposes the workspace companion and operator surfaces with approval attention', async () => {
  const view = await render(<OperatorTabs />);

  expect(view.getByTestId('tab-index')).toBeTruthy();
  expect(view.getByTestId('tab-sessions')).toBeTruthy();
  expect(view.getByTestId('tab-workspaces')).toBeTruthy();
  expect(view.getByText('approvals:1')).toBeTruthy();
  expect(view.getByTestId('tab-activity')).toBeTruthy();
  expect(view.getByTestId('tab-server')).toBeTruthy();
});
