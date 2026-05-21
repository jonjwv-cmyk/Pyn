import { Link, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isDeveloper, type Session } from '@pyn/core';
import { loadSession } from '../lib/session';
import { clearSession } from '../lib/session';
import { api } from '../lib/api';
import { stopWs } from '../lib/ws';

/**
 * Home — простой dashboard для залогиненного юзера.
 * Developer видит ссылку «Управление» (Settings → AppControlPanel).
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSession();
      if (cancelled) return;
      if (!s) {
        router.replace('/login');
        return;
      }
      setSession(s);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const onLogout = async () => {
    stopWs();
    api.setToken(null);
    await clearSession();
    router.replace('/login');
  };

  if (!session) {
    return <View style={styles.root} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pyn' }} />
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.brand}>Pyn</Text>
          <Text style={styles.user}>
            {session.user.fullName || session.user.login}{' '}
            <Text style={styles.role}>({session.role})</Text>
          </Text>
        </View>

        <View style={styles.links}>
          {isDeveloper(session.role) && (
            <Link href="/settings" asChild>
              <Pressable style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
                <Text style={styles.linkLabel}>{t('settings_sidebar.app_control')}</Text>
                <Text style={styles.linkSub}>{t('settings_control.title')}</Text>
              </Pressable>
            </Link>
          )}
        </View>

        <Pressable onPress={onLogout} style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}>
          <Text style={styles.logoutText}>{t('user_menu.logout')}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F1E1B',
    padding: 24,
    gap: 32,
  },
  header: {
    paddingTop: 24,
    gap: 4,
  },
  brand: {
    color: '#F5F4EF',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  user: {
    color: '#B8B5A9',
    fontSize: 14,
  },
  role: {
    color: '#A6A39B',
    fontSize: 12,
  },
  links: {
    gap: 12,
  },
  linkCard: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
    backgroundColor: 'rgba(48,47,45,0.3)',
    gap: 4,
  },
  pressed: {
    backgroundColor: 'rgba(217, 119, 87, 0.12)',
  },
  linkLabel: {
    color: '#F5F4EF',
    fontSize: 15,
    fontWeight: '500',
  },
  linkSub: {
    color: '#A6A39B',
    fontSize: 12,
  },
  logoutBtn: {
    marginTop: 'auto',
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
  },
  logoutText: {
    color: '#B8B5A9',
    fontSize: 13,
  },
});
