import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { WorkspaceCard } from '@/components/WorkspaceCard';

/**
 * «Волна» — SoundCloud webview (как Технология).
 * partition = persist:google-sheets — сессия SC/Google после первого входа.
 * In-webview Google OAuth нестабилен (opener/guest); вход при необходимости —
 * window.pyn.wave.openLogin() (BrowserWindow), UI без лишних кнопок.
 */
const WAVE_URL = 'https://soundcloud.com/';
const WAVE_PARTITION = 'persist:google-sheets';

type WaveWebview = HTMLElement & {
  setAttribute: (k: string, v: string) => void;
  addEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
};

export function WaveScreen(): JSX.Element {
  const { t } = useTranslation();
  const [nonce, setNonce] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [loading, setLoading] = useState(true);
  const remountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hardReload = useCallback(() => {
    setLoading(true);
    if (remountTimer.current) clearTimeout(remountTimer.current);
    setMounted(false);
    remountTimer.current = setTimeout(() => {
      setNonce((n) => n + 1);
      setMounted(true);
    }, 80);
  }, []);

  /** Повторный вход SC (работа / новый ПК) — окно, без баннеров в UI. */
  const openScLogin = useCallback(async () => {
    try {
      await window.pyn?.wave?.openLogin?.();
      hardReload();
    } catch {
      /* */
    }
  }, [hardReload]);

  useEffect(() => {
    return () => {
      if (remountTimer.current) clearTimeout(remountTimer.current);
    };
  }, []);

  // После Google login в Настройках — обновить webview (cookies partition)
  useEffect(() => {
    const onLogin = (): void => {
      setTimeout(() => hardReload(), 400);
    };
    window.addEventListener('pyn:google-login-success', onLogin);
    return () => window.removeEventListener('pyn:google-login-success', onLogin);
  }, [hardReload]);

  useEffect(() => {
    if (!mounted) return;
    const el = document.querySelector(`webview[data-wave="${nonce}"]`) as WaveWebview | null;
    if (!el) return;
    try {
      el.setAttribute('allowpopups', 'true');
    } catch {
      /* */
    }
    const onStart = (): void => setLoading(true);
    const onStop = (): void => setLoading(false);
    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    return () => {
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
    };
  }, [mounted, nonce]);

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <button
          type="button"
          title="Двойной клик — войти в SoundCloud (если разлогинило)"
          onDoubleClick={() => void openScLogin()}
          className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong"
        >
          {t('sidebar.nav_wave', 'Волна')}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          title="Обновить"
          onClick={hardReload}
          className="no-drag-region flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
        >
          <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.75} />
        </button>
      </div>
      <WorkspaceCard>
        {mounted ? (
          <webview
            key={`wave-${nonce}`}
            data-wave={String(nonce)}
            src={WAVE_URL}
            partition={WAVE_PARTITION}
            {...({ allowpopups: 'true' } as object)}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'inline-flex',
              width: '100%',
              height: '100%',
              backgroundColor: '#121212',
            }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: '#121212' }} />
        )}
      </WorkspaceCard>
    </main>
  );
}
