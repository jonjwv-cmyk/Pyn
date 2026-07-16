import { useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ListFilter, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface MolTopBarProps {
  /** Активный лист базы (переключается из сайдбара). */
  tab: 'mol' | 'warehouses';
  status: 'idle' | 'loading' | 'loaded' | 'error';
  errorMessage: string | null;
  recordCount: number;
  /** Сколько было в предыдущей версии базы. null = ещё не было. */
  previousCount: number | null;
  /** Лист «Склады»: кол-во складов и цехов (unique shop_name) «сейчас». */
  shopsCount: number;
  warehousesCount: number;
  /** Вкладка «Контакты»: сколько из контактов — МОЛ. */
  molCount: number;
  /** Сколько МОЛ было в предыдущей версии базы (для дельты). null = не было. */
  molPreviousCount: number | null;
  /** «+ Контакт» — открыть окно создания контакта. */
  onAddContact: () => void;
  /** Режим «Нормализация» (боковая панель с «кривыми» записями). */
  normalizeActive?: boolean;
  normalizeCount?: number;
  onToggleNormalize?: () => void;
  /** Поиск МОЛ — теперь в шапке (как в графике), а не нижним композером. */
  query: string;
  onQueryChange: (v: string) => void;
}

/**
 * Top-bar раздела «База». Заголовок (МОЛы / Цеха) + счётчики + diff. На листе
 * МОЛы — поле поиска прямо в шапке (как в графике): компактный пилл с clay-
 * контуром в активном состоянии. Нижний композер убран.
 */
export function MolTopBar({
  tab,
  status,
  errorMessage,
  recordCount,
  previousCount,
  shopsCount,
  warehousesCount,
  molCount,
  molPreviousCount,
  onAddContact,
  normalizeActive = false,
  normalizeCount = 0,
  onToggleNormalize,
  query,
  onQueryChange,
}: MolTopBarProps) {
  const { t } = useTranslation();
  const hasError = status === 'error';
  const diff: number | null =
    previousCount !== null ? recordCount - previousCount : null;
  const molDiff: number | null =
    molPreviousCount !== null ? molCount - molPreviousCount : null;
  return (
    <header className="drag-region relative flex h-9 shrink-0 items-center gap-2 px-4">
      {/* Заголовок = активный лист базы (переключение — в сайдбаре, флайаут «База»). */}
      <span className="no-drag-region shrink-0 text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
        {tab === 'mol' ? t('sidebar.nav_mol') : t('mol.tab_shops')}
      </span>

      {tab === 'mol'
        ? recordCount > 0 && (
            <>
              <span className="no-drag-region shrink-0 tabular-nums text-[12px] font-medium text-presence-online">
                {recordCount.toLocaleString('ru-RU')}
              </span>
              <span className="no-drag-region flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-text-muted">
                <span>
                  {t('mol.previous', {
                    count: previousCount !== null ? previousCount.toLocaleString('ru-RU') : '—',
                  })}
                </span>
                <span
                  className={cn(
                    'font-medium',
                    diff === null
                      ? 'text-text-muted'
                      : diff > 0
                        ? 'text-presence-online'
                        : diff < 0
                          ? 'text-danger'
                          : 'text-text-muted',
                  )}
                >
                  ({diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff}`})
                </span>
              </span>
              {/* Сколько из контактов — МОЛ: текущее + ранее + разница (как у Контактов). */}
              <span className="no-drag-region flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-text-muted">
                <span className="text-text-muted/50">·</span>
                <span>{t('mol.mols_label')}</span>
                <span className="text-[12px] font-medium text-accent-clay">{molCount.toLocaleString('ru-RU')}</span>
                <span>
                  {t('mol.previous', {
                    count: molPreviousCount !== null ? molPreviousCount.toLocaleString('ru-RU') : '—',
                  })}
                </span>
                <span
                  className={cn(
                    'font-medium',
                    molDiff === null
                      ? 'text-text-muted'
                      : molDiff > 0
                        ? 'text-presence-online'
                        : molDiff < 0
                          ? 'text-danger'
                          : 'text-text-muted',
                  )}
                >
                  ({molDiff === null ? '—' : `${molDiff > 0 ? '+' : ''}${molDiff}`})
                </span>
              </span>
            </>
          )
        : (
            <span className="no-drag-region flex items-center gap-1.5 text-[11.5px] tabular-nums text-text-muted">
              {/* Цеха: кол-во (зелёным = актуально сейчас) + ранее (серым) + разница. */}
              <span className="text-[12px] font-medium text-presence-online">{shopsCount.toLocaleString('ru-RU')}</span>
              <span>{t('mol.previous', { count: '—' })}</span>
              <span className="font-medium">(—)</span>
              <span className="text-text-muted/50">·</span>
              {/* Склады: подпись + кол-во (зелёным) + ранее (серым) + разница. */}
              <span>{t('mol.stat_warehouses')}</span>
              <span className="text-[12px] font-medium text-presence-online">{warehousesCount.toLocaleString('ru-RU')}</span>
              <span>{t('mol.previous', { count: '—' })}</span>
              <span className="font-medium">(—)</span>
            </span>
          )}

      {/* Единый поиск — на обеих вкладках, как у МОЛ. Плейсхолдер по вкладке. */}
      <MolSearchField
        value={query}
        onChange={onQueryChange}
        placeholder={tab === 'mol' ? t('mol.composer_placeholder') : t('shops.search_ph')}
      />
      <div className="flex-1" />

      {tab === 'mol' && (
        <div className="no-drag-region flex shrink-0 items-center gap-1.5">
          {onToggleNormalize && (
            <button
              type="button"
              onClick={onToggleNormalize}
              title={t('mol.normalize.tip')}
              className={cn(
                'flex h-7 items-center gap-1 rounded-md pl-1.5 pr-2.5 text-[12px] font-medium outline-none transition-colors',
                normalizeActive
                  ? 'bg-accent-clay/[0.14] text-accent-clay ring-1 ring-accent-clay/50'
                  : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.07] hover:text-text-secondary',
              )}
            >
              <ListFilter className="h-3.5 w-3.5" strokeWidth={1.85} />
              {t('mol.normalize.button')}
              {normalizeCount > 0 && (
                <span
                  className={cn(
                    'ml-0.5 tabular-nums',
                    normalizeActive ? 'text-accent-clay/90' : 'text-text-muted/80',
                  )}
                >
                  {normalizeCount.toLocaleString('ru-RU')}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onAddContact}
            title={t('mol.add_contact_tip')}
            className="flex h-7 items-center gap-1 rounded-md bg-accent-clay/[0.1] pl-1.5 pr-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/[0.16]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('mol.add_contact')}
          </button>
        </div>
      )}

      {hasError && errorMessage && (
        <span className="no-drag-region flex shrink-0 items-center gap-1 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {errorMessage}
        </span>
      )}
    </header>
  );
}

/**
 * Поле поиска в шапке Базы (Контакты / Цеха).
 * Компактный h-7 пилл, clay-контур когда активно. Esc — очистить.
 *
 * Ширина: по placeholder/короткому value (как раньше), НО с потолком —
 * paste 500–1000 складов больше не раздувает шапку и не сдвигает сайдбар.
 * Длинный текст крутится внутри input (нативный horizontal scroll).
 */
/** Мин. ширина пилла (иконки + короткий placeholder). */
const SEARCH_W_MIN = 140;
/** Макс. ширина — длинный paste не разъезжает header/сайдбар. */
const SEARCH_W_MAX = 280;
/** pl-7 + pr-7 + запас под иконки. */
const SEARCH_PAD_X = 58;

function MolSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}): JSX.Element {
  const { t } = useTranslation();
  const active = value.trim() !== '';
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [textW, setTextW] = useState(0);
  // Замер короткого текста/placeholder. Длинный value sizer'ом НЕ кормим —
  // иначе ResizeObserver + DOM на 10k символов; width и так упирается в MAX.
  const sizerText =
    value.length === 0
      ? placeholder
      : value.length > 48
        ? value.slice(0, 48)
        : value;
  useLayoutEffect(() => {
    const el = sizerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      if (w > 0) setTextW(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizerText]);
  const width = Math.min(SEARCH_W_MAX, Math.max(SEARCH_W_MIN, textW + SEARCH_PAD_X));
  return (
    <div
      className="no-drag-region relative flex h-7 shrink-0 items-center"
      style={{ width }}
    >
      <Search
        className={cn(
          'pointer-events-none absolute left-2 z-[1] h-3.5 w-3.5 transition-colors',
          active ? 'text-accent-clay/80' : 'text-text-muted/70',
        )}
        strokeWidth={1.75}
      />
      <span
        ref={sizerRef}
        aria-hidden
        className="pointer-events-none invisible absolute whitespace-pre text-[12px]"
      >
        {sizerText}
      </span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        title={value.length > 40 ? value : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        className={cn(
          // w-full + min-w-0: ширина от родителя (cap), overflow — скролл вбок.
          'h-7 w-full min-w-0 rounded-md pl-7 pr-7 text-[12px] text-text-primary outline-none',
          'overflow-x-auto whitespace-nowrap',
          'transition-[background-color,box-shadow] placeholder:text-text-muted/60',
          active
            ? 'bg-accent-clay/[0.08] ring-1 ring-accent-clay/55'
            : 'bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.07]',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('mol.clear_aria')}
          title={t('mol.clear_aria')}
          className="absolute right-1.5 z-[1] flex h-4 w-4 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.08] hover:text-text-strong"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
