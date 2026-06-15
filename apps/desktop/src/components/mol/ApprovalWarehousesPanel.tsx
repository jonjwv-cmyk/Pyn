import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { parseMolQuery, type ParsedMolQuery, type Warehouse } from '@pyn/core';
import { cn } from '@/lib/cn';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { useScheduleMonthsMeta, monthKey } from '@/lib/schedule/use-schedule-sync';

interface Shop {
  name: string;
  warehouses: Warehouse[];
}

function byWarehouseCode(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true });
}

function buildShops(warehouses: Warehouse[]): Shop[] {
  const map = new Map<string, Warehouse[]>();
  for (const w of warehouses) {
    const name = w.shop_name || '—';
    const arr = map.get(name);
    if (arr) arr.push(w);
    else map.set(name, [w]);
  }
  const shops = [...map.entries()].map(([name, ws]) => ({
    name,
    warehouses: [...ws].sort((a, b) => byWarehouseCode(a.id, b.id)),
  }));
  shops.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return shops;
}

function warehouseMatchesParsed(w: Warehouse, parsed: ParsedMolQuery): boolean {
  switch (parsed.mode) {
    case 'empty':
      return true;
    case 'warehouse': {
      if (parsed.tokens.length === 0) return false;
      const id = w.id.toLowerCase();
      return parsed.tokens.some((tk) => id === tk.toLowerCase());
    }
    case 'phone': {
      const qd = parsed.tokens[0] ?? '';
      return qd.length > 0 && (w.work_phone || '').replace(/\D/g, '').includes(qd);
    }
    default: {
      const qn = (parsed.tokens[0] ?? '').toLowerCase();
      return qn.length > 0 && (w.shop_name || '').toLowerCase().includes(qn);
    }
  }
}

type PaintMode = 'select' | 'deselect';
/** Цвет пилюли по статусу графика. */
type ScheduleTone = 'green' | 'yellow' | 'none';

interface ApprovalWarehousesPanelProps {
  selected: string[];
  query: string;
  onQueryChange: (q: string) => void;
  onChange: (codes: string[]) => void;
  /** Вертикальный сдвиг поиска (px от верха панели) — строго напротив поля «Статус». */
  searchTop: number;
}

/** Текущий месяц по Екатеринбургу (UTC+5, без перехода на летнее время). */
function yekNow(): { year: number; month: number } {
  const d = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * Классы пилюли по статусу графика × выбору.
 *   Зелёный/жёлтый — presence-палитра (как «В графике» в Цеха): мягкая заливка = подсветка.
 *   Выбран нами → добавляется обводка (цветной бордюр); обычный (в графике) → только подсветка.
 */
function pillClass(tone: ScheduleTone, active: boolean): string {
  if (tone === 'green') {
    return active
      ? 'border-presence-online bg-presence-online/15 text-presence-online'
      : 'border-transparent bg-presence-online/15 text-presence-online/80 hover:border-presence-online/40';
  }
  if (tone === 'yellow') {
    return active
      ? 'border-presence-away bg-presence-away/15 text-presence-away'
      : 'border-transparent bg-presence-away/15 text-presence-away/80 hover:border-presence-away/40';
  }
  return active
    ? 'border-accent-clay bg-accent-clay/15 text-accent-clay'
    : 'border-border-subtle/40 bg-bg-surface text-text-muted hover:border-accent-clay/35 hover:text-accent-clay';
}

/**
 * Правая панель выбора согласуемых складов.
 *   Структура (сверху вниз): заголовок + счётчик + «Сброс» → поиск → список цехов.
 *   Пилюли: зелёные = склад в зафиксированном графике текущего месяца (как «В графике»
 *   в Цеха), жёлтые = in_schedule=1, но не в текущем графике (добавлен → следующий месяц).
 *
 *   Позиционируется absolute-стрейчем (см. PersonEditDialog): высота = левой колонки,
 *   длинный список цехов скроллится внутри, не растягивая окно.
 */
export function ApprovalWarehousesPanel({
  selected,
  query,
  onQueryChange,
  onChange,
  searchTop,
}: ApprovalWarehousesPanelProps): JSX.Element {
  const { t } = useTranslation();
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const byId = useWarehousesStore((s) => s.byId);
  const paintRef = useRef<PaintMode | null>(null);

  // ── Расписание текущего месяца (зафиксированный) ─────────────────────────
  const { year: curYear, month: curMonth } = useMemo(yekNow, []);
  const scheduleMonths = useMemo(
    () => [{ year: curYear, month: curMonth }],
    [curYear, curMonth],
  );
  const scheduleMeta = useScheduleMonthsMeta(scheduleMonths);

  /** Коды складов в зафиксированном графике текущего месяца. */
  const greenCodes = useMemo(() => {
    const key = monthKey(curYear, curMonth);
    const meta = scheduleMeta.get(key);
    if (!meta?.committed || !meta.shops.length) return new Set<string>();
    const s = new Set<string>();
    for (const shop of meta.shops) {
      for (const row of shop.rows) {
        for (const wc of row.warehouses) s.add(wc.code.toLowerCase());
      }
    }
    return s;
  }, [scheduleMeta, curYear, curMonth]);

  /** Тон пилюли склада: зелёный (в графике) / жёлтый (войдёт со след. месяца) / нет. */
  const toneFor = useCallback((id: string): ScheduleTone => {
    if (greenCodes.has(id.toLowerCase())) return 'green';
    if (byId.get(id)?.in_schedule === 1) return 'yellow';
    return 'none';
  }, [greenCodes, byId]);

  // ── Selection state ───────────────────────────────────────────────────────
  const selectedSet = useMemo(() => {
    const s = new Set<string>();
    for (const code of selected) s.add(code.toLowerCase());
    return s;
  }, [selected]);

  const shops = useMemo(() => buildShops(warehouses), [warehouses]);
  const parsed = useMemo(() => parseMolQuery(query), [query]);
  const filteredShops = useMemo(() => {
    if (parsed.mode === 'empty') {
      return shops.map((sh) => ({ name: sh.name, rows: sh.warehouses }));
    }
    return shops
      .map((sh) => ({
        name: sh.name,
        rows: sh.warehouses.filter((w) => warehouseMatchesParsed(w, parsed)),
      }))
      .filter((sh) => sh.rows.length > 0);
  }, [shops, parsed]);

  const isSelected = useCallback((id: string) => selectedSet.has(id.toLowerCase()), [selectedSet]);

  const setSelected = useCallback((id: string, on: boolean) => {
    const key = id.toLowerCase();
    if (on) {
      if (selectedSet.has(key)) return;
      onChange([...selected, id]);
      return;
    }
    onChange(selected.filter((c) => c.toLowerCase() !== key));
  }, [onChange, selected, selectedSet]);

  const clearShop = useCallback((rows: Warehouse[]) => {
    const keys = new Set(rows.map((w) => w.id.toLowerCase()));
    onChange(selected.filter((c) => !keys.has(c.toLowerCase())));
  }, [onChange, selected]);

  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handlePillMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const active = isSelected(id);
    paintRef.current = active ? 'deselect' : 'select';
    setSelected(id, !active);
  };

  const handlePillMouseEnter = (id: string) => () => {
    const mode = paintRef.current;
    if (!mode) return;
    const active = isSelected(id);
    if (mode === 'select' && !active) setSelected(id, true);
    if (mode === 'deselect' && active) setSelected(id, false);
  };

  const isEmpty = warehouses.length === 0;

  return (
    <div className="absolute inset-y-0 left-0 w-[580px] border-l border-border-subtle/60 bg-bg-elevated">

      {/* Заголовок «Согласуемые склады» + счётчик + пил «Сброс» — ровно по строке
          «Контакт» слева (симметрия), у верха панели. */}
      <div className="absolute left-0 right-0 top-0 flex items-center gap-2 px-3.5 pt-3.5">
        <span className="flex-1 truncate text-[13px] font-semibold text-text-strong">
          {t('mol.edit.approval_warehouses_title')}
        </span>
        {selected.length > 0 && (
          <>
            <span className="rounded bg-accent-clay/15 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-accent-clay">
              {selected.length}
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              className={cn(
                'flex h-6 items-center rounded border border-border-default bg-bg-surface px-2 text-[10.5px] font-medium text-text-muted outline-none',
                'transition-colors hover:border-danger/40 hover:text-danger',
              )}
            >
              {t('mol.edit.approval_warehouses_reset')}
            </button>
          </>
        )}
      </div>

      {/* Поиск — строго напротив поля «Статус» слева. */}
      <div className="absolute left-0 right-0 px-3.5" style={{ top: searchTop }}>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('mol.edit.approval_warehouses_search_ph')}
            spellCheck={false}
            className={cn(
              'h-8 w-full rounded border border-border-default bg-bg-surface px-2 pr-7',
              'font-mono text-[12.5px] text-text-primary outline-none placeholder:font-sans',
              'placeholder:text-text-muted/60 focus:border-accent-clay/45',
            )}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className={cn(
                'absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center',
                'rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong',
              )}
              title={t('mol.edit.approval_warehouses_clear_search')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Список цехов — от поиска до низа панели, скроллится внутри. */}
      <div
        className="absolute inset-x-0 bottom-0 overflow-y-auto px-2 pb-2"
        style={{ top: searchTop + 42 }}
      >
        {isEmpty ? (
          <p className="px-1 py-4 text-center text-[11.5px] text-text-muted">
            {t('mol.edit.approval_warehouses_empty')}
          </p>
        ) : filteredShops.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11.5px] text-text-muted">
            {t('mol.edit.approval_warehouses_no_match')}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredShops.map((sh) => {
              const shopSelected = sh.rows.some((w) => isSelected(w.id));
              return (
                <div
                  key={sh.name}
                  className="group flex items-start gap-3 rounded px-2 py-1.5"
                >
                  {/* Название цеха — целиком, перенос по словам; гарантированно не
                      вылезает на пилюли (длинное слово ломается только если шире колонки). */}
                  <span className="w-[9rem] shrink-0 overflow-hidden break-words pt-0.5 pr-1 text-[11px] leading-[1.3] text-text-secondary">
                    {sh.name}
                  </span>

                  {/* Склады. */}
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {sh.rows.map((w) => {
                      const active = isSelected(w.id);
                      const tone = toneFor(w.id);
                      const toneTitle =
                        tone === 'green' ? t('mol.edit.approval_warehouses_in_schedule')
                        : tone === 'yellow' ? t('mol.edit.approval_warehouses_next_month')
                        : undefined;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onMouseDown={handlePillMouseDown(w.id)}
                          onMouseEnter={handlePillMouseEnter(w.id)}
                          title={toneTitle}
                          className={cn(
                            'min-w-[2.5rem] select-none rounded border px-1.5 py-0.5',
                            'font-mono text-[10.5px] font-medium tabular-nums outline-none transition-colors',
                            pillClass(tone, active),
                          )}
                        >
                          {w.id}
                        </button>
                      );
                    })}
                  </div>

                  {/* Сброс выбора цеха — правее складов. */}
                  <button
                    type="button"
                    onClick={() => clearShop(sh.rows)}
                    disabled={!shopSelected}
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center self-start rounded outline-none transition-all',
                      shopSelected
                        ? 'text-text-muted opacity-60 hover:bg-danger/10 hover:text-danger group-hover:opacity-100'
                        : 'pointer-events-none opacity-0',
                    )}
                    title={t('mol.edit.approval_warehouses_clear_shop')}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
