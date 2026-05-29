import { AlertCircle, Search, X } from 'lucide-react';
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
  query,
  onQueryChange,
}: MolTopBarProps) {
  const { t } = useTranslation();
  const hasError = status === 'error';
  const diff: number | null =
    previousCount !== null ? recordCount - previousCount : null;
  return (
    <header className="drag-region relative flex h-9 shrink-0 items-center gap-2 px-4">
      {/* Заголовок = активный лист базы (переключение — в сайдбаре, флайаут «База»). */}
      <span className="no-drag-region shrink-0 text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
        {tab === 'mol' ? t('sidebar.nav_mol') : t('mol.tab_shops')}
      </span>

      {tab === 'mol' ? (
        <>
          {recordCount > 0 && (
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
            </>
          )}
          <MolSearchField value={query} onChange={onQueryChange} />
        </>
      ) : (
        <>
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
          <div className="flex-1" />
        </>
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
 * Esc — очистить. Растягивается на остаток ширины шапки.
 */
function MolSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const active = value.trim() !== '';
  return (
    <div className="no-drag-region relative flex h-7 min-w-0 flex-1 items-center">
      <Search
        className={cn(
          'pointer-events-none absolute left-2 h-3.5 w-3.5 transition-colors',
          active ? 'text-accent-clay/80' : 'text-text-muted/70',
        )}
        strokeWidth={1.75}
      />
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
        placeholder={t('mol.composer_placeholder')}
        className={cn(
          'h-7 w-full min-w-0 rounded-md pl-7 pr-7 text-[12px] text-text-primary outline-none',
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
