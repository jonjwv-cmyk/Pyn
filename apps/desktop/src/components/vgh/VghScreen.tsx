import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Plus, Search } from 'lucide-react';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { useVghStore } from '@/lib/vgh-store';
import { ensureVghLoaded } from '@/lib/vgh-repo';
import { VghStagingGrid } from './VghStagingGrid';
import { VghEditCard } from './VghEditCard';
import { fmtSmart } from './vgh-staging.fixtures';

/** Карточка ВГХ: добавление новой ИЛИ правка существующей (по поиску). */
type CardState = { mode: 'add' } | { mode: 'edit'; noNum: string } | null;

/**
 * Раздел «ВГХ» — промежуточный лист дозаполнения вес-габаритов (наш Glide-грид). Вес/
 * габариты/норму правим прямо в колонках листа. Карточка изменения материала — для
 * ДОБАВЛЕНИЯ («+ Материал») и для ПРАВКИ найденного через «Найти материал» (поиск по
 * базе). Если в добавлении набрать существующую номенклатуру — данные подтянутся
 * (защита от дублей, станет правкой). Виден только admin/developer.
 */
export function VghScreen(): JSX.Element {
  const { t } = useTranslation();
  const [card, setCard] = useState<CardState>(null);

  // База ВГХ нужна для расчётов формирования, поиска и защиты от дублей — грузим при входе.
  useEffect(() => { void ensureVghLoaded(); }, []);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_vgh')}
        </span>
        <div className="no-drag-region ml-auto flex items-center gap-1.5">
          <VghBaseSearch onPick={(noNum) => setCard({ mode: 'edit', noNum })} />
          <button
            type="button"
            onClick={() => setCard({ mode: 'add' })}
            className="flex h-6 items-center gap-1 rounded-md border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:border-accent-clay/50 hover:text-text-secondary"
          >
            <Plus size={13} strokeWidth={1.75} />
            Материал
          </button>
        </div>
      </div>
      <WorkspaceCard>
        <VghStagingGrid />
      </WorkspaceCard>
      <VghEditCard
        noNum={card?.mode === 'edit' ? card.noNum : null}
        addMode={card?.mode === 'add'}
        onClose={() => setCard(null)}
      />
    </main>
  );
}

/** Поиск по базе ВГХ → клик открывает карточку ПРАВКИ номенклатуры. */
function VghBaseSearch({ onPick }: { onPick: (noNum: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rows = useVghStore((s) => s.rows);

  const results = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc) return [];
    const out: { no_num: string; mat: string; weight: number | null }[] = [];
    for (const r of rows) {
      if (
        String(r.no_num).toLowerCase().includes(lc) ||
        (r.mat || '').toLowerCase().includes(lc) ||
        (r.tech_name || '').toLowerCase().includes(lc)
      ) {
        out.push({ no_num: r.no_num, mat: r.mat, weight: r.weight_kg });
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [q, rows]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:border-border-default hover:text-text-secondary"
        >
          <Search size={13} strokeWidth={1.75} />
          Найти материал
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-30 w-[380px] overflow-hidden rounded-xl border border-border-default bg-bg-elevated shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          <div className="border-b border-border-subtle p-2">
            <input
              type="text"
              value={q}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Номенклатура, наименование, тех-имя…"
              className="w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-clay/45"
            />
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1">
            {q.trim() === '' ? (
              <div className="px-2 py-6 text-center text-[12px] text-text-muted/70">Введите запрос для поиска по базе</div>
            ) : results.length === 0 ? (
              <div className="px-2 py-6 text-center text-[12px] text-text-muted/70">Ничего не найдено</div>
            ) : (
              results.map((r) => (
                <button
                  key={r.no_num}
                  type="button"
                  onClick={() => { onPick(r.no_num); setOpen(false); setQ(''); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-strong"
                >
                  <span className="shrink-0 font-mono tabular-nums text-[11px] text-text-muted">{r.no_num}</span>
                  <span className="min-w-0 flex-1 truncate">{r.mat || '—'}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-text-muted">
                    {r.weight != null ? `${fmtSmart(r.weight, 3)} кг` : '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
