import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { useVghStore } from '@/lib/vgh-store';
import { ensureVghLoaded } from '@/lib/vgh-repo';
import { VghStagingGrid } from './VghStagingGrid';
import { VghEditCard, type VghCardSeed } from './VghEditCard';
import { fmtSmart } from './vgh-staging.fixtures';

/**
 * Раздел «ВГХ» — промежуточный лист дозаполнения вес-габаритов (наш Glide-грид) +
 * правка базы ВГХ через карточку. Виден только admin/developer (как «Поток»). Из
 * этой базы реалтайм считаются KG/V и тех-имя в формировании.
 */
export function VghScreen(): JSX.Element {
  const { t } = useTranslation();
  const [card, setCard] = useState<{ noNum: string; seed?: VghCardSeed | null } | null>(null);

  // База ВГХ нужна и для карточки, и для поиска по базе — грузим при входе в раздел.
  useEffect(() => { void ensureVghLoaded(); }, []);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_vgh')}
        </span>
        <span className="no-drag-region rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium leading-none text-text-muted/80">
          β
        </span>
        <span className="no-drag-region text-[12px] text-text-muted/70">Промежуточный лист · база</span>
        <div className="no-drag-region ml-auto">
          <VghBaseSearch onPick={(noNum) => setCard({ noNum })} />
        </div>
      </div>
      <WorkspaceCard>
        <VghStagingGrid onEditBase={(noNum) => setCard({ noNum })} />
      </WorkspaceCard>
      <VghEditCard noNum={card?.noNum ?? null} seed={card?.seed ?? null} onClose={() => setCard(null)} />
    </main>
  );
}

/** Поиск по базе ВГХ (3.6к) → клик открывает карточку правки номенклатуры. */
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
          Найти в базе ВГХ
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
