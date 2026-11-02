// SPDX-License-Identifier: Elastic-2.0
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { LanguagePicker } from '@/components/language-picker';
import {
  LANGUAGE_KEY,
  LanguageProvider,
  translate,
  useLanguage,
} from './language';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));
function Fixture() {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('My unchanged draft');
  return (
    <>
      <LanguagePicker />
      <Text>{t('What’s on your mind?')}</Text>
      <TextInput
        accessibilityLabel="draft"
        value={draft}
        onChangeText={setDraft}
      />
    </>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
});
test('switches to French immediately after saving and preserves the draft', async () => {
  const view = await render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  );
  await fireEvent.press(view.getByLabelText('App language'));
  await fireEvent.press(view.getByLabelText('Français'));
  await waitFor(() =>
    expect(view.getByText('Comment puis-je vous aider ?')).toBeTruthy(),
  );
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_KEY, 'fr');
  expect(view.getByLabelText('draft')).toHaveProp(
    'value',
    'My unchanged draft',
  );
  await fireEvent.press(view.getByLabelText('Langue de l’application'));
  await fireEvent.press(view.getByLabelText('English'));
  await waitFor(() =>
    expect(view.getByText('What’s on your mind?')).toBeTruthy(),
  );
});
test('restores the saved French choice after relaunch', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('fr');
  const view = await render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  );
  await waitFor(() =>
    expect(view.getByText('Comment puis-je vous aider ?')).toBeTruthy(),
  );
});
test('failed storage leaves the selected language unchanged and reports the error', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValue(new Error('storage unavailable'));
  const view = await render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  );
  await fireEvent.press(view.getByLabelText('App language'));
  await fireEvent.press(view.getByLabelText('Français'));
  await waitFor(() =>
    expect(
      view.getByText('Language could not be saved. Try again.'),
    ).toBeTruthy(),
  );
  expect(view.getByText('What’s on your mind?')).toBeTruthy();
});
test('unknown content falls back unchanged', () => {
  expect(translate('fr', 'User-authored project content')).toBe(
    'User-authored project content',
  );
  expect(translate('en', 'Send message')).toBe('Send message');
});
