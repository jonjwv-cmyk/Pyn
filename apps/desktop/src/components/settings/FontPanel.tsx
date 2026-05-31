import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUiStateStore } from '@/lib/stores';
import { APP_FONT_OPTIONS, FONT_STACKS, normalizeAppFont } from '@/lib/app-font';
import { cn } from '@/lib/cn';

/**
 * Settings → Шрифт. Выбор шрифта ВСЕГО приложения (UI, таблицы, цифры, локали,
 * PDF Графика). Применяется мгновенно — App-эффект на `appFont` двигает CSS-
 * переменную `--app-font`; выбор персистится в ui-state-store. Каждый вариант
 * отрисован своим же шрифтом — живой превью названия.
 */
export function FontPanel(): JSX.Element {
  const { t } = useTranslation();
  const appFont = useUiStateStore((s) => s.appFont);
  const setAppFont = useUiStateStore((s) => s.setAppFont);
  const current = normalizeAppFont(appFont);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col gap-1.5 px-6 py-6">
        {/* Секция «Шрифт» внутри Оформления (sentence-case, приглушённый заголовок). */}
        <h3 className="px-1 pb-1 text-[11px] font-medium text-text-muted/70">
          {t('settings_sidebar.font')}
        </h3>
        {APP_FONT_OPTIONS.map(({ id, label }) => {
          const selected = id === current;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setAppFont(id)}
              style={{ fontFamily: FONT_STACKS[id] }}
              className={cn(
                'flex h-11 items-center gap-2.5 rounded-md px-3 text-left text-[15px]',
                'outline-none transition-colors',
                selected
                  ? 'bg-bg-hover text-text-strong'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <span className="flex-1 truncate">{label}</span>
              {selected && <Check className="h-4 w-4 shrink-0 text-accent-clay" strokeWidth={1.75} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
