// SPDX-License-Identifier: Elastic-2.0

import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F5F0',
  surface: '#FFFFFF',
  surfaceMuted: '#ECEBE5',
  text: '#171816',
  textMuted: '#62645F',
  border: '#D7D7D0',
  accent: '#245C45',
  accentText: '#FFFFFF',
  warning: '#9A5B13',
  warningSurface: '#FFF2D9',
  success: '#276749',
  danger: '#A33A2B',
  preview: '#5B4B8A',
};

const dark: typeof light = {
  background: '#111310',
  surface: '#1B1E1A',
  surfaceMuted: '#252923',
  text: '#F3F4EF',
  textMuted: '#AFB4AA',
  border: '#373C34',
  accent: '#78C39F',
  accentText: '#102017',
  warning: '#F2B85B',
  warningSurface: '#3A2B15',
  success: '#78C39F',
  danger: '#F08B7C',
  preview: '#B3A1EB',
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
