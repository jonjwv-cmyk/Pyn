import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@pyn/core';
import { changeLanguage } from '../lib/i18n';

/**
 * Settings → Язык. Список из 5 поддерживаемых языков + active-индикатор.
 * Mobile-аналог desktop'овской `LanguagePanel`. Persistence — через
 * AsyncStorage внутри `changeLanguage`.
 */
export function LanguagePanel(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState<SupportedLanguage>(
    (i18n.resolvedLanguage as SupportedLanguage) || 'ru',
  );

  const onPick = (lang: SupportedLanguage): void => {
    if (lang === current) return;
    setCurrent(lang);
    void changeLanguage(lang);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('settings_sidebar.language')}</Text>
      </View>
      <View style={styles.list}>
        {SUPPORTED_LANGUAGES.map((lang) => {
          const active = lang === current;
          return (
            <Pressable
              key={lang}
              onPress={() => onPick(lang)}
              style={({ pressed }) => [
                styles.row,
                active && styles.rowActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.label, active && styles.labelActive]}>
                {LANGUAGE_NATIVE_NAMES[lang]}
              </Text>
              {active && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  header: {
    gap: 4,
  },
  heading: {
    color: '#F5F4EF',
    fontSize: 17,
    fontWeight: '500',
  },
  list: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
    backgroundColor: 'rgba(48,47,45,0.3)',
  },
  rowActive: {
    borderColor: 'rgba(217, 119, 87, 0.45)',
    backgroundColor: 'rgba(217, 119, 87, 0.12)',
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    color: '#B8B5A9',
    fontSize: 14,
  },
  labelActive: {
    color: '#F5F4EF',
    fontWeight: '500',
  },
  check: {
    color: '#D97757',
    fontSize: 14,
    fontWeight: '600',
  },
});
