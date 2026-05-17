import type { ApiClient } from '../api/client';

/**
 * Scheduled messages — отложенная отправка новостей/опросов.
 *
 * Server cron каждую минуту проходит по `scheduled_messages` где
 * `status='pending' AND send_at <= now()`, переносит запись в `app_messages`
 * и шлёт push + WS `news_update {kind:'scheduled_sent'}`.
 *
 * Permission: admin/developer для всех трёх actions.
 */

// ── SCHEDULE_MESSAGE ───────────────────────────────────────────────────────

export type ScheduledKind = 'news' | 'poll';

export interface ScheduleNewsPayload {
  text: string;
  priority?: 'normal' | 'high' | 'urgent';
  attachments?: Array<{
    file_url: string;
    file_name: string;
    file_type: string;
    file_size: number;
  }>;
}

export interface ScheduleMessageRequest {
  kind: ScheduledKind;
  /** Серверный insert использует поля как при обычном send_news. */
  payload: ScheduleNewsPayload | Record<string, unknown>;
  /** Момент отправки. Конвертим в формат сервера (UTC `YYYY-MM-DD HH:MM:SS`). */
  sendAt: Date;
}

export interface ScheduleMessageResponse {
  id: number;
  /** Серверный формат как был прислан — для отображения "запланировано на ...". */
  sendAt: string;
}

/**
 * Запланировать отправку. `sendAt` должно быть строго в будущем — иначе
 * server отдаёт `send_at_not_in_future` (мы пробрасываем как ApiError).
 */
export async function scheduleMessage(
  client: ApiClient,
  req: ScheduleMessageRequest,
): Promise<ScheduleMessageResponse> {
  const wire = await client.call<{
    data?: { id: number; send_at: string };
  }>('schedule_message', {
    kind: req.kind,
    payload: req.payload,
    send_at: toServerSendAt(req.sendAt),
  });
  if (!wire.data) throw new Error('schedule_message: empty data');
  return { id: wire.data.id, sendAt: wire.data.send_at };
}

// ── LIST_SCHEDULED ─────────────────────────────────────────────────────────

export type ScheduledStatus = 'pending' | 'sent' | 'cancelled';

export interface ScheduledMessageWire {
  id: number;
  kind: ScheduledKind;
  payload: Record<string, unknown>;
  send_at: string;
  status: ScheduledStatus;
  sent_at?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  created_at?: string | null;
}

export interface ScheduledMessage {
  id: number;
  kind: ScheduledKind;
  payload: Record<string, unknown>;
  /** Сырое серверное время `YYYY-MM-DD HH:MM:SS` UTC. UI парсит через formatFullYek. */
  sendAt: string;
  status: ScheduledStatus;
  sentAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string | null;
}

/**
 * Все scheduled-сообщения текущего admin'а: pending (ближайшие сверху) +
 * sent/cancelled за последние 30 дней.
 */
export async function listScheduled(client: ApiClient): Promise<ScheduledMessage[]> {
  const wire = await client.call<{ data?: ScheduledMessageWire[] }>('list_scheduled', {});
  return (wire.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    sendAt: r.send_at,
    status: r.status,
    sentAt: r.sent_at ?? null,
    cancelledAt: r.cancelled_at ?? null,
    cancelledBy: r.cancelled_by ?? null,
    createdAt: r.created_at ?? null,
  }));
}

// ── CANCEL_SCHEDULED ───────────────────────────────────────────────────────

/**
 * Отменить отложенную отправку. Разрешено только автору и только если запись
 * ещё `pending`. После отмены server-row остаётся, но status='cancelled' —
 * запись виден в listScheduled для UI «удалено в HH:MM».
 */
export async function cancelScheduled(client: ApiClient, id: number): Promise<void> {
  await client.call('cancel_scheduled', { id });
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Конвертирует `Date` в серверный формат `YYYY-MM-DD HH:MM:SS` UTC.
 * Server парсит через `Date.parse(s.replace(' ', 'T') + 'Z')` —
 * наш формат сюда подходит 1:1.
 */
function toServerSendAt(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
