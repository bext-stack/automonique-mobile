// SPDX-License-Identifier: Elastic-2.0
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import french from './fr.json';
export type Language = 'en' | 'fr';
export const LANGUAGE_KEY = 'automonique.mobile.language.v1';
export function translate(language: Language, text: string): string {
  return language === 'fr'
    ? ((french as Record<string, string>)[text] ?? text)
    : text;
}
const LanguageContext = createContext({
  language: 'en' as Language,
  t: (text: string) => text,
  setLanguage: async (_language: Language): Promise<void> => {},
});
export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, updateLanguage] = useState<Language>('en');
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const initialRevision = revision.current;
    void AsyncStorage.getItem(LANGUAGE_KEY)
      .then((saved) => {
        if (
          active &&
          revision.current === initialRevision &&
          (saved === 'en' || saved === 'fr')
        )
          updateLanguage(saved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const setLanguage = useCallback(async (next: Language) => {
    revision.current += 1;
    await AsyncStorage.setItem(LANGUAGE_KEY, next);
    updateLanguage(next);
  }, []);
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (text: string) => translate(language, text),
    }),
    [language, setLanguage],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  return useContext(LanguageContext);
}
