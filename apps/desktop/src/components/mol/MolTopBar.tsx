import { IdCard, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface MolTopBarProps {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  errorMessage: string | null;
  recordCount: number;
  /** Сколько было в предыдущей версии базы. null = ещё не было. */
  previousCount: number | null;
}

/**
 * Top-bar раздела МОЛы. Заголовок «МОЛы» + счётчик загруженных записей +
 * diff с предыдущей версией.
 *
 * §pyn-1.2.27 — inline-фильтр «Уточнить по найденному» удалён: per-column
 * фильтры в заголовках таблицы покрывают эту функциональность.
 *
 * Кнопки обновления тут нет — она единственная и живёт в попап-меню юзера
 * (DbVersionRow). Дублировать здесь смысла нет.
 *
 * Снизу — тонкая indeterminate progress-полоска во время download'a
 * snapshot'a (status='loading').
 */
export function MolTopBar({
  status,
  errorMessage,
  recordCount,
  previousCount,
}: MolTopBarProps) {
  const { t } = useTranslation();
  const loading = status === 'loading';
  const hasError = status === 'error';
  // Diff показываем как абсолютную разницу когда previous есть. Если previous
  // нет (старые base_meta до миграции records_count, или впервые после deploy)
  // — `previous = —`, `diff = —`. Юзер видит явно что историч. сравнения пока
  // нет, а не отсутствие индикатора.
  const diff: number | null =
    previousCount !== null ? recordCount - previousCount : null;
  return (
    <header
      className={cn(
        'drag-region relative flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4',
        'bg-bg-surface',
      )}
    >
      <IdCard className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="no-drag-region text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
        {t('tables_registry.tab_mol')}
      </span>
      {recordCount > 0 && (
        <span className="no-drag-region tabular-nums text-[12px] text-text-muted">
          {recordCount.toLocaleString('ru-RU')}
        </span>
      )}
      {recordCount > 0 && (
        <span className="no-drag-region flex items-center gap-1 text-[11.5px] tabular-nums text-text-muted">
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
            ({diff === null
              ? '—'
              : `${diff > 0 ? '+' : ''}${diff}`})
          </span>
        </span>
      )}
      {hasError && errorMessage && (
        <span className="no-drag-region flex items-center gap-1 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {errorMessage}
        </span>
      )}

      {/* Indeterminate progress на нижней границе. Чистый CSS — анимированная
          полоска бежит слева направо во время loading. Не блокирует drag. */}
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <div className="mol-progress-bar h-full w-1/3 rounded-full bg-accent-clay" />
        </div>
      )}
    </header>
  );
}
