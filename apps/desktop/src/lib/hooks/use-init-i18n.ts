import { useEffect } from 'react';
import { initI18n } from '@/lib/i18n';
import { useUiStateStore } from '@/lib/stores';

/**
 * i18n init — один раз на mount. Дожидаемся persist-hydration ui-state-store
 * (он async через safeStorage IPC), чтобы saved language применился сразу
 * на старте. Без этого ожидания первый рендер был бы всегда на ru, и через
 * момент после hydration перепрыгнул бы на сохранённый.
 */
export function useInitI18n(): void {
  useEffect(() => {
    if (useUiStateStore.persist.hasHydrated()) {
      initI18n(useUiStateStore.getState().language);
      return;
    }
    const unsub = useUiStateStore.persist.onFinishHydration(() => {
      initI18n(useUiStateStore.getState().language);
    });
    // Safety net: если hydration уже завершён до подписки (race), вызовем init.
    if (useUiStateStore.persist.hasHydrated()) {
      initI18n(useUiStateStore.getState().language);
    }
    return unsub;
  }, []);
}
