/**
 * Выбор шрифта всего приложения. Активный шрифт применяется глобально через
 * CSS-переменную `--app-font` на `<html>` (Tailwind `font-sans` = `var(--app-font)`),
 * поэтому меняется ВЕЗДЕ разом: UI, таблицы, цифры, локали, PDF Графика.
 * Сам выбор персистится в ui-state-store (`appFont`). Файлы шрифтов — fonts.ts.
 */

export type AppFont = 'inter' | 'roboto-flex' | 'arimo';

export const DEFAULT_APP_FONT: AppFont = 'inter';

/** Системный хвост-fallback — пока @font-face не загрузился / на отсутствие глифа. */
const SYSTEM_FALLBACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif";

/** CSS font-family стек для каждого варианта (первым — встроенное семейство). */
export const FONT_STACKS: Record<AppFont, string> = {
  inter: `'Inter Variable', 'Inter', ${SYSTEM_FALLBACK}`,
  'roboto-flex': `'Roboto Flex Variable', 'Roboto Flex', ${SYSTEM_FALLBACK}`,
  arimo: `'Arimo', ${SYSTEM_FALLBACK}`,
};

/** Список для переключателя в Настройках (порядок = порядок в UI). */
export const APP_FONT_OPTIONS: { id: AppFont; label: string }[] = [
  { id: 'inter', label: 'Inter' },
  { id: 'roboto-flex', label: 'Roboto Flex' },
  { id: 'arimo', label: 'Arimo' },
];

/** Приводит произвольную строку из стора к валидному AppFont (fallback — дефолт). */
export function normalizeAppFont(value: string | null | undefined): AppFont {
  return value === 'inter' || value === 'roboto-flex' || value === 'arimo'
    ? value
    : DEFAULT_APP_FONT;
}

/** Применяет шрифт глобально: ставит `--app-font` на корневой `<html>`. */
export function applyAppFont(value: string | null | undefined): void {
  const font = normalizeAppFont(value);
  document.documentElement.style.setProperty('--app-font', FONT_STACKS[font]);
}
