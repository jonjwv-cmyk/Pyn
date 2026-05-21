// Crypto polyfill MUST be imported before any @pyn/core usage.
import 'react-native-get-random-values';

import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  appStatus,
  getAppLockStatus,
  isDeveloper,
  useAppLockStore,
  type AppControlStateChangedEvent,
  type Session,
} from '@pyn/core';
import { api } from '../lib/api';
import { initDeviceId } from '../lib/device';
import { initI18n } from '../lib/i18n';
import { loadSession } from '../lib/session';
import { startWs, useWsEvent } from '../lib/ws';
import { triggerAppLockWipe } from '../lib/wipe';
import { AppLockOverlay } from '../components/AppLockOverlay';

/**
 * Root layout. Цепочка инициализации:
 *   1. crypto polyfill (top of file)
 *   2. initDeviceId — SecureStore UUID
 *   3. restore session — если есть, set ApiClient token + start WS
 *   4. seed kill switch state через app_status (android scope)
 *   5. listen WS event app_control_state_changed → update store
 *   6. render: либо overlay (если scope=android locked И не developer),
 *      либо обычный Stack navigator
 */
export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const router = useRouter();
  const androidLock = useAppLockStore((s) => s.android);
  // sessionRef для WS-handler'ов — они мониторят stale closures, ref всегда свежий.
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Init device_id + restore session + i18n
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initI18n();
        await initDeviceId();
        const restored = await loadSession();
        if (cancelled) return;
        if (restored) {
          api.setToken(restored.token);
          setSession(restored);
          startWs(restored.user.login, restored.token);
        }
      } catch (err) {
        console.warn('[pyn:hydrate]', err);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Seed kill switch state. app_status — public endpoint (без token).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await appStatus(api, { appScope: 'main', appVersion: '0.0.1' });
        if (cancelled) return;
        if (res.appLockState) {
          useAppLockStore.getState().setScopeFromServer('android', {
            state: res.appLockState,
            title: res.appLockTitle || '',
            message: res.appLockMessage || '',
            wipeAt: res.appLockWipeAt ?? null,
            initiatedBy: res.appLockInitiatedBy || '',
          });
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Developer-only: полный seed обоих scope для Settings → Управление.
  // Один запрос на login. Дальше WS push обновляет state без прыжков.
  useEffect(() => {
    if (!session || !isDeveloper(session.role)) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getAppLockStatus(api);
        if (cancelled) return;
        useAppLockStore.getState().setAllFromServer({
          desktop: s.desktop,
          android: s.android,
          devicesActive: s.devicesActive,
          devicesWiped: s.devicesWiped,
        });
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // WS push: kill switch state changed. Guard: пока pending — echo events
  // от своего же toggle игнорируются.
  useWsEvent<AppControlStateChangedEvent>('app_control_state_changed', (event) => {
    if (event.scope !== 'desktop' && event.scope !== 'android') return;
    const state = useAppLockStore.getState();
    if (state.pendingScopes.includes(event.scope)) return;
    state.setScopeFromServer(event.scope, {
      state: event.state as 'normal' | 'paused' | 'wiping' | 'wiped',
      title: event.title || '',
      message: event.message || '',
      wipeAt: event.wipe_at ?? null,
      initiatedBy: event.initiated_by || '',
    });
    // Wipe только для android scope (это наша платформа) И не developer.
    const cur = sessionRef.current;
    if (event.scope === 'android' && event.state === 'wiping'
        && cur && !isDeveloper(cur.role)) {
      void triggerAppLockWipe();
    }
  });

  // Redirect: нет session → /login, есть session → /home (only on initial hydrate done)
  useEffect(() => {
    if (hydrating) return;
    router.replace(session ? '/' : '/login');
  }, [hydrating, session, router]);

  // Overlay поверх всего (включая Stack). Developer EXEMPT.
  const shouldShowAppLock =
    androidLock.state !== 'normal' && (!session || !isDeveloper(session.role));

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1F1E1B' },
          headerTintColor: '#F5F4EF',
          contentStyle: { backgroundColor: '#1F1E1B' },
          headerShadowVisible: false,
        }}
      />
      {shouldShowAppLock && (
        <AppLockOverlay state={androidLock.state} title={androidLock.title} />
      )}
    </SafeAreaProvider>
  );
}
