import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  activateAppLock,
  deactivateAppLock,
  useAppLockStore,
  type AppLockScope,
} from '@pyn/core';
import { api } from '../lib/api';
import { AppControlPanel } from '../components/AppControlPanel';
import { LanguagePanel } from '../components/LanguagePanel';
import { PasswordPrompt } from '../components/PasswordPrompt';

const WIPE_AFTER_SECONDS = 24 * 3600;

/**
 * Settings → Управление. Источник правды — useAppLockStore.
 * Seed делается в RootLayout (один раз на login). Этот экран — pure read
 * из store + toggle действия. Никакого loading на mount → нет прыжков.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const desktop = useAppLockStore((s) => s.desktop);
  const android = useAppLockStore((s) => s.android);

  const [submitting, setSubmitting] = useState<AppLockScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwPending, setPwPending] = useState<{ scope: AppLockScope; next: boolean } | null>(null);

  const onToggle = (scope: AppLockScope, next: boolean) => {
    if (submitting) return;
    setError(null);
    setPwPending({ scope, next });
  };

  const runToggle = async (scope: AppLockScope, next: boolean, password: string) => {
    const store = useAppLockStore.getState();
    const previous = store[scope];
    store.setPending(scope, true);
    const wipeAtIso = next
      ? toSqliteUtc(new Date(Date.now() + WIPE_AFTER_SECONDS * 1000))
      : null;
    store.setScopeFromServer(scope, {
      state: next ? 'paused' : 'normal',
      title: next ? t('app_lock.overlay_title') : '',
      message: '',
      wipeAt: wipeAtIso,
      initiatedBy: next ? 'developer' : '',
    });
    setSubmitting(scope);
    try {
      if (next) {
        await activateAppLock(api, { scope, password, wipeAfterSeconds: WIPE_AFTER_SECONDS });
      } else {
        await deactivateAppLock(api, { scope, password });
      }
    } catch (err) {
      store.setScopeFromServer(scope, previous);
      const code = (err as { code?: string }).code;
      setError(code === 'wrong_password'
        ? t('tables.toast_wrong_password')
        : (err instanceof Error ? err.message : String(err)));
    } finally {
      setTimeout(() => {
        useAppLockStore.getState().setPending(scope, false);
      }, 600);
      setSubmitting(null);
    }
  };

  function toSqliteUtc(d: Date): string {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
         + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  return (
    <>
      <Stack.Screen options={{ title: t('settings_sidebar.app_control') }} />
      <ScrollView style={{ flex: 1, backgroundColor: '#1F1E1B' }}>
        <AppControlPanel
          desktop={{
            state: desktop.state,
            initiatedBy: desktop.initiatedBy,
            wipeAt: desktop.wipeAt,
          }}
          android={{
            state: android.state,
            initiatedBy: android.initiatedBy,
            wipeAt: android.wipeAt,
          }}
          submitting={submitting}
          onToggle={onToggle}
        />
        <LanguagePanel />
      </ScrollView>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <PasswordPrompt
        visible={pwPending !== null}
        onSubmit={(pw) => {
          const pending = pwPending;
          setPwPending(null);
          if (!pending) return;
          void runToggle(pending.scope, pending.next, pw);
        }}
        onCancel={() => setPwPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(229, 115, 115, 0.4)',
    backgroundColor: 'rgba(229, 115, 115, 0.1)',
  },
  errorText: {
    color: '#E57373',
    fontSize: 12,
  },
});
