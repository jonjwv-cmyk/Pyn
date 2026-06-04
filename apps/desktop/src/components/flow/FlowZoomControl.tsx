import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Границы масштаба (множитель: 1 = 100%). */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
/** Пресеты быстрого выбора (как в Google Таблицах). */
const ZOOM_PRESETS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;

interface FlowZoomControlProps {
  /** Текущий масштаб (множитель). */
  zoom: number;
  /** Применить новый масштаб (множитель). */
  onZoomChange: (zoom: number) => void;
}

/** Проценты → множитель в допустимых границах. */
function clampPercent(pct: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(pct) / 100));
}

/**
 * Масштаб «как в Google Таблицах»: кликабельная процентовка с лупой открывает
 * поповер, где масштаб можно ВВЕСТИ руками (Enter) или выбрать пресетом. Триггер
 * живёт на светлом листе; поповер — тёмный, в стиле меню колонки (FlowHeaderMenu).
 */
export function FlowZoomControl({ zoom, onZoomChange }: FlowZoomControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('100');
  const currentPct = Math.round(zoom * 100);

  // При открытии — подставляем текущее значение в поле ввода.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(String(currentPct));
  };

  const applyDraft = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) onZoomChange(clampPercent(n));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Масштаб — кликните, чтобы ввести или выбрать"
          className="flex h-6 items-center gap-1 rounded-md border border-black/10 px-1.5 text-[12px] tabular-nums text-[#6B6862] transition-colors hover:text-[#0A0A0A]"
        >
          <Search size={13} strokeWidth={1.75} />
          {currentPct}%
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-30 flex w-40 flex-col rounded-xl border border-border-subtle bg-bg-elevated p-1.5 text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
          {/* Ручной ввод процента — Enter применяет. */}
          <div className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1">
            <Search size={13} strokeWidth={1.75} className="shrink-0 text-text-muted/70" />
            <input
              autoFocus
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyDraft();
              }}
              className="w-full bg-transparent text-[12px] tabular-nums text-text-primary outline-none"
            />
            <span className="shrink-0 text-[12px] text-text-muted/70">%</span>
          </div>

          <div className="my-1.5 h-px bg-border-subtle/60" />

          {ZOOM_PRESETS.map((preset) => {
            const pct = Math.round(preset * 100);
            const active = pct === currentPct;
            return (
              <button
                type="button"
                key={preset}
                onClick={() => {
                  onZoomChange(preset);
                  setOpen(false);
                }}
                className={cn(
                  'w-full rounded-md px-2 py-1 text-left text-[12px] tabular-nums transition-colors',
                  active
                    ? 'bg-accent-clay/25 text-text-strong'
                    : 'text-text-primary hover:bg-accent-clay/20',
                )}
              >
                {pct}%
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
