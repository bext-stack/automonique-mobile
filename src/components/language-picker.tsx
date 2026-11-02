// SPDX-License-Identifier: Elastic-2.0

import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage, type Language } from '@/i18n/language';
import { usePalette } from '@/theme/palette';

export function LanguagePicker() {
  const { language, setLanguage, t } = useLanguage();
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  function close() {
    if (!saving) setOpen(false);
  }
  async function choose(next: Language) {
    setSaving(true);
    setFailed(false);
    try {
      await setLanguage(next);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('App language')}
        accessibilityValue={{
          text: language === 'fr' ? 'Français' : 'English',
        }}
        onPress={() => {
          setFailed(false);
          setOpen(true);
        }}
        style={[styles.setting, { borderColor: palette.border }]}
      >
        <Text style={{ color: palette.text, fontSize: 14 }}>
          {t('Language')}
        </Text>
        <View style={styles.value}>
          <Text style={{ color: palette.textMuted, fontSize: 14 }}>
            {language === 'fr' ? 'Français' : 'English'}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 20 }}>›</Text>
        </View>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Close')}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView
            edges={['bottom']}
            style={[styles.sheet, { backgroundColor: palette.surface }]}
          >
            <View style={styles.heading}>
              <Text
                accessibilityRole="header"
                style={{
                  color: palette.text,
                  fontSize: 20,
                  fontWeight: '700',
                  flex: 1,
                }}
              >
                {t('App language')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close language chooser')}
                onPress={close}
                disabled={saving}
                style={styles.close}
              >
                <Text style={{ color: palette.textMuted, fontSize: 24 }}>
                  ×
                </Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {(['en', 'fr'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={value === 'fr' ? 'Français' : 'English'}
                  accessibilityState={{
                    checked: language === value,
                    disabled: saving,
                  }}
                  disabled={saving}
                  onPress={() => void choose(value)}
                  style={[
                    styles.option,
                    {
                      backgroundColor:
                        language === value
                          ? palette.surfaceMuted
                          : palette.surface,
                      borderColor:
                        language === value ? palette.accent : palette.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        color: palette.text,
                        fontSize: 16,
                        fontWeight: '600',
                      }}
                    >
                      {value === 'fr' ? 'Français' : 'English'}
                    </Text>
                    <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                      {value === 'fr' ? 'FR' : 'EN'}
                    </Text>
                  </View>
                  {language === value && (
                    <Text
                      accessible={false}
                      style={{ color: palette.accent, fontSize: 22 }}
                    >
                      ✓
                    </Text>
                  )}
                </Pressable>
              ))}
              <Text
                style={{
                  color: palette.textMuted,
                  fontSize: 12,
                  lineHeight: 18,
                  paddingVertical: 8,
                }}
              >
                {t(
                  'Interface language only. Messages and project content stay unchanged.',
                )}
              </Text>
              {failed && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: palette.danger }}
                >
                  {t('Language could not be saved. Try again.')}
                </Text>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  setting: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingHorizontal: 12,
  },
  value: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
