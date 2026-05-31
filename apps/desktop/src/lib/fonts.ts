/**
 * Встроенные (bundled) шрифты приложения — грузятся из node_modules через Vite,
 * без сети (важно за корп-прокси). Все три свободные и с полной кириллицей:
 *   • Inter Variable  — OFL, дефолт (как у Linear/GitHub);
 *   • Roboto Flex Variable — Apache 2.0;
 *   • Arimo (Helvetica-metric, Liberation Sans) — Apache 2.0, статичные веса.
 * @font-face объявляются этими импортами; выбор активного шрифта — через
 * CSS-переменную `--app-font` (см. app-font.ts), которой управляет Настройки→Шрифт.
 */
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/roboto-flex/index.css';
import '@fontsource/arimo/400.css';
import '@fontsource/arimo/500.css';
import '@fontsource/arimo/600.css';
import '@fontsource/arimo/700.css';
