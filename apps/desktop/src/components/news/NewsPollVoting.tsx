import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import type { Poll } from '@pyn/core';

interface NewsPollVotingProps {
  poll: Poll;
  onVote?: (optionId: number) => void;
}

/**
 * Голосование / результаты опроса внутри NewsCard.
 *
 *   • До голосования — кликабельные radio-options.
 *   • После голосования (myVoteOptionId != null) — линейная диаграмма с
 *     процентами; выбранная пользователем опция выделена accent-clay tint'ом.
 *
 * Подробная разбивка (кто за что) — в NewsStatsDialog через "три точки".
 */
export function NewsPollVoting({ poll, onVote }: NewsPollVotingProps) {
  const [pendingOptionId, setPendingOptionId] = useState<number | null>(null);
  const voted = poll.myVoteOptionId !== null;
  const total = poll.totalVoters;

  const pendingOption =
    pendingOptionId !== null ? poll.options.find((o) => o.id === pendingOptionId) : null;

  const confirmVote = () => {
    if (pendingOptionId !== null) onVote?.(pendingOptionId);
    setPendingOptionId(null);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border-subtle bg-bg-primary/40 p-3">
      {/*
        Question/description в карточке-новости уже отрисованы в `news.text`
        выше нашего блока — сервер шлёт их с тем же содержанием (см. Kotlin
        `PollBuilderSheet.kt::onCreate(question, question, options)`). Здесь
        повторно их НЕ показываем, чтобы не было дубля.
      */}
      <div className="flex flex-col gap-1">
        {poll.options.map((o) => {
          const isMyVote = o.id === poll.myVoteOptionId;
          const pct = total > 0 ? Math.round((o.votesCount / total) * 100) : 0;
          return voted ? (
            <ResultBar key={o.id} text={o.text} pct={pct} votes={o.votesCount} isMyVote={isMyVote} />
          ) : (
            <VoteOption
              key={o.id}
              text={o.text}
              onClick={() => setPendingOptionId(o.id)}
              disabled={!poll.isActive}
            />
          );
        })}
      </div>

      <p className="text-[11px] text-text-muted">
        {voted
          ? `Проголосовало ${total} ${pluralVotes(total)}`
          : `Опрос ещё открыт — выберите вариант`}
      </p>

      <ConfirmDialog
        open={pendingOptionId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOptionId(null);
        }}
        title="Подтвердите выбор"
        description={
          pendingOption ? `Проголосовать за «${pendingOption.text}»?` : undefined
        }
        confirmLabel="Да"
        cancelLabel="Нет"
        onConfirm={confirmVote}
      />
    </div>
  );
}

interface VoteOptionProps {
  text: string;
  disabled: boolean;
  onClick: () => void;
}

function VoteOption({ text, disabled, onClick }: VoteOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
        'text-text-primary',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border-default" />
      <span className="truncate">{text}</span>
    </button>
  );
}

interface ResultBarProps {
  text: string;
  pct: number;
  votes: number;
  isMyVote: boolean;
}

function ResultBar({ text, pct, votes, isMyVote }: ResultBarProps) {
  // Явный border + bg делают опцию видимой даже при pct=0 (иначе бледный
  // progress-bar просто не отображается, и юзер думает "вариантов нет").
  // Выбранную опцию подкрашиваем accent-clay border'ом — мгновенно понятно
  // что именно ты выбрал.
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border bg-bg-primary/40',
        isMyVote ? 'border-accent-clay/50' : 'border-border-subtle',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 transition-[width]',
          isMyVote ? 'bg-accent-clay-bg' : 'bg-bg-hover',
        )}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-2 px-2.5 py-2 text-[12.5px]">
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5',
            isMyVote ? 'font-medium text-text-strong' : 'text-text-primary',
          )}
        >
          {isMyVote && (
            <span
              aria-label="Ваш выбор"
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent-clay text-[9px] font-bold text-white"
            >
              ✓
            </span>
          )}
          <span className="truncate">{text}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-text-muted">
          {votes} ({pct}%)
        </span>
      </div>
    </div>
  );
}

function pluralVotes(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'голосов';
  if (mod10 === 1) return 'голос';
  if (mod10 >= 2 && mod10 <= 4) return 'голоса';
  return 'голосов';
}
