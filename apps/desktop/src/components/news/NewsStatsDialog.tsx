import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Circle, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import { computeInitials } from '@/lib/initials';
import { useUsersStore } from '@/lib/stores';
import {
  getNewsReaders,
  getPollStats,
  type NewsItem,
  type NewsReader,
  type NewsStats,
  type NewsViewerSummary,
  type Poll,
  type PollStats,
  type PollVoter,
} from '@pyn/core';

interface NewsStatsDialogProps {
  news: NewsItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Модал статистики:
 *   • news → Прочитавшие + Не прочитавшие (через `get_news_readers`)
 *   • poll → Линейная диаграмма + Проголосовавшие + Не проголосовавшие (`get_poll_stats`)
 *
 * Запросы async на open dialog. Permission: admin-only (сервер enforce'ит).
 */
export function NewsStatsDialog({ news, open, onOpenChange }: NewsStatsDialogProps) {
  const [newsStats, setNewsStats] = useState<NewsStats | null>(null);
  const [pollStats, setPollStats] = useState<PollStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Аватары приходят отдельно: server `get_news_readers` возвращает только
  // login+full_name. `usersStore` префетчится в App.tsx при логине админа —
  // здесь делаем lookup по login → blob params, и Avatar расшифровывает blob.
  //
  // 🔴 Zustand selector ВСЕГДА должен возвращать стабильную референцию —
  // иначе каждый render → новый объект → re-render → ∞. Селектор берёт массив
  // users (stable ref), а useMemo вычисляет lookup map когда users меняется.
  const users = useUsersStore((s) => s.users);
  const usersByLogin = useMemo(() => {
    const map: Record<string, (typeof users)[number]> = {};
    for (const u of users) map[u.login] = u;
    return map;
  }, [users]);

  useEffect(() => {
    if (!open) return;
    setNewsStats(null);
    setPollStats(null);
    setError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        if (news.kind === 'poll' && news.poll) {
          const stats = await getPollStats(api, news.poll.id);
          if (cancelled) return;
          setPollStats(wireToPollStats(stats));
        } else {
          const stats = await getNewsReaders(api, news.id);
          if (cancelled) return;
          setNewsStats(wireToNewsStats(stats));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, news.id, news.kind, news.poll?.id]);

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
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[480px] flex-col',
            '-translate-x-1/2 -translate-y-1/2 overflow-hidden',
            'rounded-xl border border-border-default bg-bg-elevated shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <header className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
              Статистика
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрыть"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  'text-text-muted outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading && <EmptyHint>Загрузка…</EmptyHint>}
            {!loading && error !== null && (
              <p className="py-4 text-center text-[12.5px] text-danger">{error}</p>
            )}
            {!loading && !error && news.kind === 'news' && (
              <NewsView stats={newsStats} usersByLogin={usersByLogin} />
            )}
            {!loading && !error && news.kind === 'poll' && (
              <PollView poll={news.poll} stats={pollStats} usersByLogin={usersByLogin} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── wire → domain mappers ─────────────────────────────────────────────────

function wireToNewsStats(wire: Awaited<ReturnType<typeof getNewsReaders>>): NewsStats {
  return {
    readers: wire.readUsers.map(
      (u): NewsReader => ({
        userId: u.user_login,
        name: u.full_name ?? u.user_login,
        initials: computeInitials(u.full_name ?? u.user_login),
        readAtLabel: u.read_at ? formatShortDate(u.read_at) : '',
      }),
    ),
    notReaders: wire.unreadUsers.map(
      (u): NewsViewerSummary => ({
        userId: u.user_login,
        name: u.full_name ?? u.user_login,
        initials: computeInitials(u.full_name ?? u.user_login),
      }),
    ),
  };
}

function wireToPollStats(wire: Awaited<ReturnType<typeof getPollStats>>): PollStats {
  return {
    voters: wire.voters.map(
      (v): PollVoter => ({
        userId: v.user_login,
        name: v.full_name ?? v.user_login,
        initials: computeInitials(v.full_name ?? v.user_login),
        votedOptionIds: [v.option_id],
        votedAtLabel: v.voted_at ? formatShortDate(v.voted_at) : '',
      }),
    ),
    notVoters: wire.nonVoters.map(
      (u): NewsViewerSummary => ({
        userId: u.user_login,
        name: u.full_name ?? u.user_login,
        initials: computeInitials(u.full_name ?? u.user_login),
      }),
    ),
  };
}

const formatShortDate = formatFullYek;

// ── news view ──────────────────────────────────────────────────────────────

type UsersByLogin = Record<string, import('@pyn/core').UserSummary>;

interface NewsViewProps {
  stats: NewsStats | null;
  usersByLogin: UsersByLogin;
}

function NewsView({ stats, usersByLogin }: NewsViewProps) {
  if (!stats) return <EmptyHint>Статистика по новости ещё не собрана.</EmptyHint>;

  const total = stats.readers.length + stats.notReaders.length;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] text-text-muted">
        Прочитали <span className="font-medium text-text-strong">{stats.readers.length}</span> из{' '}
        <span className="font-medium text-text-strong">{total}</span>, не прочитали{' '}
        <span className="font-medium text-text-strong">{stats.notReaders.length}</span>.
      </p>

      <SubSection title="Прочитали" count={stats.readers.length}>
        {stats.readers.length === 0 ? (
          <SubsectionEmpty>Никто ещё не прочитал.</SubsectionEmpty>
        ) : (
          stats.readers.map((r) => (
            <ReaderRow key={r.userId} reader={r} usersByLogin={usersByLogin} />
          ))
        )}
      </SubSection>

      <SubSection title="Не прочитали" count={stats.notReaders.length}>
        {stats.notReaders.length === 0 ? (
          <SubsectionEmpty>Все ознакомились.</SubsectionEmpty>
        ) : (
          stats.notReaders.map((u) => (
            <PersonRow key={u.userId} person={u} muted usersByLogin={usersByLogin} />
          ))
        )}
      </SubSection>
    </div>
  );
}

interface ReaderRowProps {
  reader: NewsReader;
  usersByLogin: UsersByLogin;
}

function ReaderRow({ reader, usersByLogin }: ReaderRowProps) {
  const u = usersByLogin[reader.userId];
  return (
    <div className="flex items-center gap-3 py-1">
      <Check className="h-3.5 w-3.5 shrink-0 text-presence-online" strokeWidth={2.25} />
      <Avatar
        initials={reader.initials}
        size={26}
        avatarUrl={u?.avatarUrl}
        avatarBlobKey={u?.avatarBlobKey}
        avatarBlobNonce={u?.avatarBlobNonce}
      />
      <span className="flex-1 truncate text-[13px] text-text-primary">{reader.name}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{reader.readAtLabel}</span>
    </div>
  );
}

// ── poll view ──────────────────────────────────────────────────────────────

interface PollViewProps {
  poll: Poll | null;
  stats: PollStats | null;
  usersByLogin: UsersByLogin;
}

function PollView({ poll, stats, usersByLogin }: PollViewProps) {
  if (!poll) return <EmptyHint>Опрос не найден.</EmptyHint>;
  if (!stats) return <EmptyHint>Статистика по опросу ещё не собрана.</EmptyHint>;

  const total = poll.totalVoters;
  const totalPolled = stats.voters.length + stats.notVoters.length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-[13.5px] font-medium leading-snug text-text-strong">{poll.question}</h3>
        {poll.description && <p className="mt-1 text-[12px] text-text-muted">{poll.description}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votesCount / total) * 100) : 0;
          const isMyVote = o.id === poll.myVoteOptionId;
          return (
            <div key={o.id} className="relative overflow-hidden rounded-md">
              <div
                className={cn(
                  'absolute inset-y-0 left-0',
                  isMyVote ? 'bg-accent-clay-bg' : 'bg-bg-hover',
                )}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                <span
                  className={cn(
                    'truncate',
                    isMyVote ? 'font-medium text-text-strong' : 'text-text-primary',
                  )}
                >
                  {o.text}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-text-muted">
                  {o.votesCount} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[12px] text-text-muted">
        Проголосовало{' '}
        <span className="font-medium text-text-strong">{stats.voters.length}</span> из{' '}
        <span className="font-medium text-text-strong">{totalPolled}</span>.
      </p>

      <SubSection title="Проголосовали" count={stats.voters.length}>
        {stats.voters.length === 0 ? (
          <SubsectionEmpty>Ещё никто не проголосовал.</SubsectionEmpty>
        ) : (
          stats.voters.map((v) => (
            <VoterRow key={v.userId} voter={v} poll={poll} usersByLogin={usersByLogin} />
          ))
        )}
      </SubSection>

      <SubSection title="Не проголосовали" count={stats.notVoters.length}>
        {stats.notVoters.length === 0 ? (
          <SubsectionEmpty>Все участники проголосовали.</SubsectionEmpty>
        ) : (
          stats.notVoters.map((u) => (
            <PersonRow key={u.userId} person={u} muted usersByLogin={usersByLogin} />
          ))
        )}
      </SubSection>
    </div>
  );
}

interface VoterRowProps {
  voter: PollVoter;
  poll: Poll;
  usersByLogin: UsersByLogin;
}

function VoterRow({ voter, poll, usersByLogin }: VoterRowProps) {
  const optionTexts = voter.votedOptionIds
    .map((id) => poll.options.find((o) => o.id === id)?.text)
    .filter((t): t is string => Boolean(t));
  const u = usersByLogin[voter.userId];

  return (
    <div className="flex items-center gap-3 py-1">
      <Check className="h-3.5 w-3.5 shrink-0 text-presence-online" strokeWidth={2.25} />
      <Avatar
        initials={voter.initials}
        size={26}
        avatarUrl={u?.avatarUrl}
        avatarBlobKey={u?.avatarBlobKey}
        avatarBlobNonce={u?.avatarBlobNonce}
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] text-text-primary">{voter.name}</span>
        <span className="truncate text-[11px] text-text-muted">{optionTexts.join(', ')}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{voter.votedAtLabel}</span>
    </div>
  );
}

// ── shared rows ────────────────────────────────────────────────────────────

interface PersonRowProps {
  person: NewsViewerSummary;
  muted?: boolean;
  usersByLogin: UsersByLogin;
}

function PersonRow({ person, muted, usersByLogin }: PersonRowProps) {
  const u = usersByLogin[person.userId];
  return (
    <div className="flex items-center gap-3 py-1">
      <Circle
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          muted ? 'text-text-muted' : 'text-text-secondary',
        )}
        strokeWidth={1.75}
      />
      <Avatar
        initials={person.initials}
        size={26}
        avatarUrl={u?.avatarUrl}
        avatarBlobKey={u?.avatarBlobKey}
        avatarBlobNonce={u?.avatarBlobNonce}
      />
      <span
        className={cn(
          'flex-1 truncate text-[13px]',
          muted ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        {person.name}
      </span>
    </div>
  );
}

interface SubSectionProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

function SubSection({ title, count, children }: SubSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
        <span>{title}</span>
        <span className="tabular-nums">{count}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function SubsectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[12px] italic text-text-muted">{children}</p>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-[12.5px] text-text-muted">{children}</p>;
}
