import { useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Plus, Search, X } from 'lucide-react';
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
        <button
          type="button"
          onClick={onAddContact}
          title={t('mol.add_contact_tip')}
          className="no-drag-region flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent-clay/[0.1] pl-1.5 pr-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/[0.16]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {t('mol.add_contact')}
        </button>
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
 * Поле поиска МОЛ в шапке — зеркало ProbaSearchField графика: компактный
 * h-7 пилл, clay-контур + clay-иконка когда активно. Живой фильтр (onChange),
 * Esc — очистить. Ширина пилла — РОВНО по тексту (placeholder, либо значение
 * если оно длиннее): плашка «обнимает» текст и сразу заканчивается, не
 * растягиваясь на всю шапку. Замер через скрытый sizer-span (точная ширина
 * проп. шрифта + кириллица), `+58px` — место под иконки поиска/очистки.
 */
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
  // Ширину берём из offsetWidth скрытого sizer'а. Раздел МОЛ всегда смонтирован
  // и переключается через display:none (App.tsx) → при ПЕРВОМ маунте (вкладка
  // скрыта) offsetWidth = 0, пилюля схлопывается в иконку и без re-measure такой
  // и остаётся (помогал лишь «прыжок по вкладкам»). ResizeObserver ловит переход
  // 0→N в момент, когда вкладка становится видимой, и переизмеряет сам.
  useLayoutEffect(() => {
    const el = sizerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      if (w > 0) setTextW(w); // не сбрасываем в 0, когда вкладка прячется
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, placeholder]);
  return (
    <div className="no-drag-region relative flex h-7 shrink-0 items-center">
      <Search
        className={cn(
          'pointer-events-none absolute left-2 h-3.5 w-3.5 transition-colors',
          active ? 'text-accent-clay/80' : 'text-text-muted/70',
        )}
        strokeWidth={1.75}
      />
      {/* Невидимый sizer — мерит ширину текста (placeholder либо длинного value)
          тем же шрифтом 12px, чтобы инпут был точно по тексту. */}
      <span
        ref={sizerRef}
        aria-hidden
        className="pointer-events-none invisible absolute whitespace-pre text-[12px]"
      >
        {value.length > placeholder.length ? value : placeholder}
      </span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        style={{ width: textW + 58 }}
        className={cn(
          'h-7 rounded-md pl-7 pr-7 text-[12px] text-text-primary outline-none',
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
          className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.08] hover:text-text-strong"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
