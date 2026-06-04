import type { Theme } from '@glideapps/glide-data-grid';

/**
 * Тема грида «Поток» — ВСЕГДА СВЕТЛАЯ (решение юзера: так читабельнее; таблица —
 * это светлый «документ» внутри приложения, независимо от темы приложения,
 * как лист Google/Excel). Тёмный хром приложения (сайдбар, шапка раздела,
 * рамка карточки) обрамляет светлый лист.
 *
 * Выделение — в стиле листа МОЛ: clay-акцент (рамка диапазона + лёгкая заливка
 * активной ячейки). Точное «перо-свечение» МОЛ — это CSS box-shadow на HTML-
 * overlay; Glide рисует на canvas (ради скорости на десятках тыс. строк), поэтому
 * здесь — чистая clay-рамка + тонкая заливка (тот же цвет, близкий вид).
 */
export const FLOW_GRID_THEME: Partial<Theme> = {
  // Акцент выделения — clay (как на листе МОЛ).
  accentColor: '#D97757',
  accentLight: 'rgba(217,119,87,0.14)',
  accentFg: '#FFFFFF',

  // Текст — тёплый «почти чёрный» на светлом.
  textDark: '#0A0A0A',
  textMedium: '#33312E',
  textLight: '#6B6862',
  textBubble: '#0A0A0A',
  textHeader: '#33312E',
  textHeaderSelected: '#0A0A0A',

  // Иконка меню (▾) в заголовке.
  bgIconHeader: '#6B6862',
  fgIconHeader: '#FFFFFF',

  // Фоны — тёплый белый лист, чуть приподнятая шапка.
  bgCell: '#FDFDFB',
  bgCellMedium: '#F6F5F1',
  bgHeader: '#F2F1EC',
  bgHeaderHasFocus: '#E9E8E2',
  bgHeaderHovered: '#ECEBE5',
  bgBubble: '#ECEBE5',
  bgBubbleSelected: '#E4E2DB',
  bgSearchResult: 'rgba(217,119,87,0.22)',

  // Границы — ультра-тонкие тёмные на светлом (Linear-вкус).
  borderColor: 'rgba(0,0,0,0.07)',
  horizontalBorderColor: 'rgba(0,0,0,0.05)',
  drilldownBorder: 'rgba(0,0,0,0.14)',
  linkColor: '#B35E45',

  cellHorizontalPadding: 6,
  cellVerticalPadding: 2,
  headerFontStyle: '600 12px',
  baseFontStyle: '12px',
  editorFontSize: '12px',
  // ВАЖНО: грид рисует на canvas — ctx.font НЕ резолвит CSS-переменные, поэтому
  // здесь конкретное имя шрифта (Inter), а не var(--app-font). Иначе текст уезжает
  // в системный шрифт И расходится с замером авто-ширины колонок.
  fontFamily:
    '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};
