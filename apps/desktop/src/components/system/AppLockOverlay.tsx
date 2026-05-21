import { useTranslation } from 'react-i18next';
import type { AppLockServerState as AppLockState } from '@pyn/core';

/**
 * Full-screen блокировка приложения. Одна строка, solid background, без интеракций.
 */
export interface AppLockOverlayProps {
  state: AppLockState;
  /** Опциональный override text (если server прислал custom). */
  title?: string;
}

export function AppLockOverlay({ state: _state, title }: AppLockOverlayProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-deep select-none"
    >
      <p className="px-8 text-center text-base text-text-strong">
        {title || t('app_lock.overlay_title')}
      </p>
    </div>
  );
}
