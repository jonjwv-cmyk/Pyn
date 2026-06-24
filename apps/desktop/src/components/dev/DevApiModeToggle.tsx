import { useEffect, useState } from 'react';

/**
 * DEV-ONLY плавающий переключатель сетевого маршрута (юзер 2026-06-22, VPS отпал).
 *   • VPS   — штатный путь через VPS-релей (как в проде).
 *   • CLOUD — напрямую в Cloudflare Worker, минуя VPS (для разработки на Mac).
 *
 * Показывается ТОЛЬКО в dev-сборке (main отдаёт `allowed=false` в упакованном проде → не рисуем).
 * Смена режима → перезагрузка окна, чтобы api-клиент и WS переподключились на новый маршрут.
 */
export function DevApiModeToggle(): JSX.Element | null {
  const [mode, setMode] = useState<'vps' | 'cloud' | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dev = window.pyn?.devApiMode;
    if (!dev) return;
    void dev.get().then((r) => {
      setAllowed(!!r.allowed);
      setMode(r.mode);
    }).catch(() => undefined);
  }, []);

  if (!allowed || mode === null) return null;

  const pick = (next: 'vps' | 'cloud'): void => {
    if (busy || next === mode) return;
    setBusy(true);
    void window.pyn.devApiMode
      .set(next)
      .then((r) => {
        setMode(r.mode);
        // Перезапуск окна → переинициализация api/WS на новый маршрут.
        setTimeout(() => window.location.reload(), 120);
      })
      .catch(() => setBusy(false));
  };

  const btn = (key: 'vps' | 'cloud', label: string): JSX.Element => {
    const active = mode === key;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => pick(key)}
        title={key === 'cloud' ? 'Напрямую в Cloudflare (минуя VPS) — для разработки' : 'Через VPS-релей (как в проде)'}
        className={
          'rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
          (active
            ? key === 'cloud'
              ? 'bg-accent-clay text-white'
              : 'bg-success text-white'
            : 'text-text-muted hover:text-text-strong')
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="no-drag-region fixed bottom-2 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border-subtle bg-bg-elevated/95 px-1.5 py-1 shadow-lg backdrop-blur"
      style={{ pointerEvents: 'auto' }}
    >
      <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-text-muted/70">DEV·API</span>
      {btn('vps', 'VPS')}
      {btn('cloud', 'CLOUD')}
    </div>
  );
}
