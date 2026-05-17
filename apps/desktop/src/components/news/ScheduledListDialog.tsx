import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Clock, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import { useStatsStore } from '@/lib/stores';
import {
  cancelScheduled,
  listScheduled,
  type ScheduledMessage,
  type ScheduledStatus,
} from '@pyn/core';

interface ScheduledListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Список запланированных постов (admin-only, как `list_scheduled` на сервере).
 *
 * UX-зеркало Kotlin `ScheduledListSheet.kt`:
 *   • Строка показывает: badge статуса + дата + body preview + cancel (только pending)
 *   • Группировка по статусу не явная — server возвращает pending сверху +
 *     sent/cancelled за последние 30 дней (sorted)
 *   • Empty / loading / error states
 *
 * Cancel мгновенно мутирует local state (optimistic), при ошибке refresh'имся.
 */
export function ScheduledListDialog({ open, onOpenChange }: ScheduledListDialogProps) {
  // Cache-first: при open сразу берём cached list. Loading-state включаем
  // только при первом open (когда `cachedList === null`). WS news_update
  // kind=scheduled_sent инвалидирует кеш в NewsFeed.tsx.
  const cachedList = useStatsStore((s) => s.scheduledList);
  const setScheduledList = useStatsStore((s) => s.setScheduledList);
  const [items, setItems] = useState<ScheduledMessage[] | null>(cachedList);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const fresh = await listScheduled(api);
      setItems(fresh);
      setScheduledList(fresh);
    } catch {
      // Auth-failure'ы (`session_expired_window` и т.п.) перехватывает
      // глобальный `api.setOnAuthFailure` в App.tsx — компонент исчезнет
      // вместе с LoginScreen-flip'ом. Тут показываем generic-сообщение для
      // прочих ошибок без сырых серверных code'ов наружу.
      // Если кешированный список уже отрендерен — не блокируем UI ошибкой,
      // даём ему остаться и тихо логируем (юзер увидит свежую попытку при
      // следующем open).
      if (items === null) {
        setError('Не удалось загрузить запланированные публикации');
      }
    } finally {
      setLoading(false);
    }
  }, [items, setScheduledList]);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    // Cache-first: cached items уже в local state. Loading включаем только
    // если кеша нет. silent refresh идёт всегда.
    if (cachedList !== null) {
      setItems(cachedList);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCancel = (id: number): void => {
    // Optimistic: помечаем cancelled + ставим cancelledAt = now (Yek-string'a
    // сейчас нет, оставим current ISO — formatFullYek падёт fallback на raw).
    setItems((prev) => {
      const next =
        prev?.map((it) =>
          it.id === id
            ? { ...it, status: 'cancelled' as const, cancelledAt: new Date().toISOString() }
            : it,
        ) ?? null;
      if (next) setScheduledList(next);
      return next;
    });
    cancelScheduled(api, id)
      .then(() => refresh())
      .catch(() => refresh());
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col',
            'max-h-[80vh] rounded-xl border border-border-default bg-bg-elevated shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="shrink-0 border-b border-border-subtle px-5 pb-3 pt-4">
            <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
              Запланированные публикации
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[12px] text-text-muted">
              История за 30 дней.
            </Dialog.Description>
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto p-3">
            {loading && (
              <ul className="flex animate-pulse flex-col gap-1">
                {[0, 1, 2].map((i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-bg-primary/40 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-20 rounded-full bg-bg-hover/80" />
                      <div className="h-2.5 w-32 rounded bg-bg-hover/60" />
                    </div>
                    <div className="h-2.5 w-3/4 rounded bg-bg-hover/70" />
                    <div className="h-2.5 w-1/2 rounded bg-bg-hover/50" />
                  </li>
                ))}
              </ul>
            )}
            {!loading && error !== null && (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                {error}
              </div>
            )}
            {!loading && !error && items !== null && items.length === 0 && (
              <div className="flex flex-col items-center gap-1 px-2 py-6 text-center text-text-muted">
                <Clock className="h-6 w-6" strokeWidth={1.5} />
                <p className="text-[12.5px]">Ничего не запланировано</p>
              </div>
            )}
            {!loading && !error && items !== null && items.length > 0 && (
              <ul className="flex flex-col gap-1">
                {items.map((item) => (
                  <ScheduledRow key={item.id} item={item} onCancel={handleCancel} />
                ))}
              </ul>
            )}
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Закрыть"
              className={cn(
                'absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md',
                'text-text-muted outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ScheduledRowProps {
  item: ScheduledMessage;
  onCancel: (id: number) => void;
}

function ScheduledRow({ item, onCancel }: ScheduledRowProps) {
  const isPending = item.status === 'pending';
  const isCancelled = item.status === 'cancelled';
  const primaryDate = formatFullYek(
    isCancelled
      ? item.cancelledAt ?? item.sendAt
      : item.status === 'sent'
        ? item.sentAt ?? item.sendAt
        : item.sendAt,
  );
  const secondaryDate = isCancelled ? formatFullYek(item.sendAt) : '';
  const kind = item.kind === 'poll' ? 'Опрос' : 'Новость';
  const preview = previewText(item);

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-bg-primary/40 p-3',
      )}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="text-[11.5px] text-text-muted">{primaryDate}</span>
      </div>
      {secondaryDate !== '' && (
        <span className="text-[10.5px] text-text-muted">Планировалось на {secondaryDate}</span>
      )}
      <p className="line-clamp-3 text-[12.5px] leading-snug text-text-primary">
        <span className="font-medium text-text-strong">{kind}:</span>{' '}
        {preview || <span className="text-text-muted">(без текста)</span>}
      </p>
      {isPending && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className={cn(
              'rounded-md px-2 py-1 text-[12px] font-medium outline-none transition-colors',
              'text-danger hover:bg-danger/15',
            )}
          >
            Отменить
          </button>
        </div>
      )}
    </li>
  );
}

interface StatusBadgeProps {
  status: ScheduledStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10.5px] font-medium text-success">
        <Check className="h-3 w-3" strokeWidth={2} />
        Отправлено
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-bg-hover px-1.5 py-0.5 text-[10.5px] font-medium text-text-muted">
        <X className="h-3 w-3" strokeWidth={2} />
        Отменено
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-clay-bg px-1.5 py-0.5 text-[10.5px] font-medium text-accent-clay">
      <Clock className="h-3 w-3" strokeWidth={2} />
      Запланировано
    </span>
  );
}

/**
 * Превью текста из payload. Для poll берём title (заголовок вопроса), для news
 * — text. Если ничего нет — пусто (fallback rendering выше).
 */
function previewText(item: ScheduledMessage): string {
  const p = item.payload as Record<string, unknown>;
  if (item.kind === 'poll') {
    const title = typeof p.title === 'string' ? p.title : '';
    return title;
  }
  const text = typeof p.text === 'string' ? p.text : '';
  return text;
}

