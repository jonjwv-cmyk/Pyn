import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * Full-screen блокировка приложения (RN). Одна строка, solid background.
 * pointerEvents="box-only" блочит все tap'ы — за overlay'ем нельзя ничего
 * нажать. Уходит автоматически когда developer cancel'ит state на сервере
 * (через WS push state='normal') — App.tsx убирает рендер этого компонента.
 */

export type AppLockState = 'normal' | 'paused' | 'wiping' | 'wiped';

export interface AppLockOverlayProps {
  state: AppLockState;
  title?: string;
}

export function AppLockOverlay({ state: _state, title }: AppLockOverlayProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} pointerEvents="box-only">
      <Text style={styles.text}>
        {title || t('app_lock.overlay_title')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#161611',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 999,
    elevation: 999,
  },
  text: {
    color: '#F5F4EF',
    fontSize: 16,
    textAlign: 'center',
  },
});
