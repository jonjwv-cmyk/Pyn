/**
 * Общие HTML-форматтеры для Tabulator (и любых других таблиц).
 * Один источник правды — подключаем в любом sheet-модуле без копипасты.
 */

export type PynStatusKind = 'ok' | 'wait' | 'danger' | 'neutral';

/** Канон маппинга статусов транспорта → визуальный kind. */
export const TRANSPORT_STATUS_KIND: Record<string, PynStatusKind> = {
  Размещен: 'ok',
  Дополнение: 'ok',
  'В работе': 'ok',
  Ожидание: 'wait',
  Новый: 'wait',
  Открыт: 'wait',
  Отклонен: 'danger',
  Отмена: 'danger',
  'Не приехал': 'danger',
  Отказ: 'danger',
};

export function statusKind(status: string, map: Record<string, PynStatusKind> = TRANSPORT_STATUS_KIND): PynStatusKind {
  return map[status] ?? 'neutral';
}

/** Бейдж статуса: полупрозрачный фон + неоновый текст (Grok HUD). */
export function pynStatusBadgeHtml(status: string, map?: Record<string, PynStatusKind>): string {
  const label = String(status ?? '').trim() || '—';
  const kind = statusKind(label, map);
  return `<span class="pyn-status-badge pyn-status-badge--${kind}">${escapeHtml(label)}</span>`;
}

/** Минималистичный моно id (Geist Mono / system mono через CSS). */
export function pynMonoHtml(value: unknown): string {
  const t = String(value ?? '').trim() || '—';
  return `<span class="pyn-mono">${escapeHtml(t)}</span>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
