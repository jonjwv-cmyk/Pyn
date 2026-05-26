import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Circle, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import { computeInitials } from '@/lib/initials';
import { usePresenceStore, useStatsStore, useUsersStore } from '@/lib/stores';
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
  const { t } = useTranslation();
  // Cache-first: при open берём cached snapshot из store, UI рендерит мгновенно.
  // Параллельно идёт silent fetch — если данные изменились, swap'ятся без
  // мигания «Загрузка». WS `news_update` инвалидирует кеш → следующий open
  // fetch'ит свежий. Loading-индикатор показываем только если кеша вообще нет.
  const cachedNewsStats = useStatsStore((s) =>
    news.kind === 'news' ? s.newsReadersByMessageId[news.id] ?? null : null,
  );
  const cachedPollStats = useStatsStore((s) =>
    news.kind === 'poll' && news.poll ? s.pollStatsByPollId[news.poll.id] ?? null : null,
  );
  const setStatsReaders = useStatsStore((s) => s.setNewsReaders);
  const setStatsPoll = useStatsStore((s) => s.setPollStats);

  const [newsStats, setNewsStats] = useState<NewsStats | null>(cachedNewsStats);
  const [pollStats, setPollStats] = useState<PollStats | null>(cachedPollStats);
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

  // При open — синхронно подменяем local state на cached snapshot, чтобы UI
  // моментально показал известное и не мигал «Загрузка». Loading включаем
  // только когда кеша вообще нет (первый open).
  useEffect(() => {
    if (!open) return;
    setNewsStats(cachedNewsStats);
    setPollStats(cachedPollStats);
    setError(null);
    const hasCached =
      (news.kind === 'news' && cachedNewsStats !== null) ||
      (news.kind === 'poll' && cachedPollStats !== null);
    setLoading(!hasCached);

    let cancelled = false;
    (async () => {
      try {
        if (news.kind === 'poll' && news.poll) {
          const wire = await getPollStats(api, news.poll.id);
          if (cancelled) return;
          // §pyn-1.2.40 — fill presenceStore из voters/nonVoters (server отдаёт
          // presence_status в response). PresenceDot в строках реактивный
          // через usePresenceStore (любой WS push presence_change обновит).
          usePresenceStore.getState().setMany([
            ...wire.voters.map((v) => ({ login: v.user_login, status: v.presence_status, lastSeenAt: v.last_seen_at })),
            ...wire.nonVoters.map((u) => ({ login: u.user_login, status: u.presence_status, lastSeenAt: u.last_seen_at })),
          ]);
          const stats = wireToPollStats(wire);
          setPollStats(stats);
          setStatsPoll(news.poll.id, stats);
        } else {
          const wire = await getNewsReaders(api, news.id);
          if (cancelled) return;
          usePresenceStore.getState().setMany([
            ...wire.readUsers.map((u) => ({ login: u.user_login, status: u.presence_status, lastSeenAt: u.last_seen_at })),
            ...wire.unreadUsers.map((u) => ({ login: u.user_login, status: u.presence_status, lastSeenAt: u.last_seen_at })),
          ]);
          const stats = wireToNewsStats(wire);
          setNewsStats(stats);
          setStatsReaders(news.id, stats);
        }
      } catch (err) {
        if (cancelled) return;
        // Ошибку показываем только если кеша не было (первый load). Если был
        // cached snapshot — оставляем его и тихо логируем, чтобы UI не мигал
        // на flaky-сетях.
        if (!hasCached) {
          setError(err instanceof Error ? err.message : t('news_stats.load_failed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              {t('news_card.action_stats')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
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
            {loading && <StatsSkeleton kind={news.kind} />}
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
  const optionsById: Record<number, string> = {};
  for (const o of wire.options) {
    // Поддерживаем оба именования полей — старое (`option_text` из БД) и новое
    // (`text`). Берём то, что не пустое.
    const text = o.option_text ?? o.text ?? '';
    if (text) optionsById[o.id] = text;
  }
  // Диагностический лог — помогает понять что пришло из сервера, если в UI
  // вариант голоса так и не отображается. Видно только в DevTools, в проде
  // мусора не плодит (тип debug).
  window.pyn?.debugLog?.(
    'poll-stats',
    `options=${JSON.stringify(optionsById)} voters=${wire.voters.length}` +
      (wire.voters[0]
        ? ` first=${JSON.stringify({
            login: wire.voters[0].user_login,
            ids: wire.voters[0].selected_option_ids,
            texts: wire.voters[0].selected_option_texts,
            legacy: wire.voters[0].option_id,
          })}`
        : ''),
  );
  return {
    voters: wire.voters.map((v): PollVoter => {
      const ids = v.selected_option_ids ?? (v.option_id ? [v.option_id] : []);
      // Источник text'a в порядке приоритета:
      //   1. server `selected_option_texts` (готовое из БД)
      //   2. optionsById lookup по ids
      // Если оба пусты — оставляем texts: []; VoterRow покажет «Проголосовал»
      // как graceful fallback, не #id (юзер просил без #id).
      let texts: string[] = [];
      if (v.selected_option_texts && v.selected_option_texts.length > 0) {
        texts = v.selected_option_texts.filter((t) => t && t.length > 0);
      }
      if (texts.length === 0) {
        texts = ids.map((id) => optionsById[id] ?? '').filter((t) => t.length > 0);
      }
      return {
        userId: v.user_login,
        name: v.full_name ?? v.user_login,
        initials: computeInitials(v.full_name ?? v.user_login),
        votedOptionIds: ids,
        votedOptionTexts: texts,
        votedAtLabel: v.voted_at ? formatShortDate(v.voted_at) : '',
      };
    }),
    notVoters: wire.nonVoters.map(
      (u): NewsViewerSummary => ({
        userId: u.user_login,
        name: u.full_name ?? u.user_login,
        initials: computeInitials(u.full_name ?? u.user_login),
      }),
    ),
    optionsById,
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
  const { t } = useTranslation();
  if (!stats) return <EmptyHint>{t('news_stats.empty_news')}</EmptyHint>;

  const total = stats.readers.length + stats.notReaders.length;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] text-text-muted">
        <Trans
          i18nKey="news_stats.summary_news"
          values={{ read: stats.readers.length, total, not: stats.notReaders.length }}
          components={{ b: <span className="font-medium text-text-strong" /> }}
        />
      </p>

      <SubSection title={t('news_stats.section_readers')} count={stats.readers.length}>
        {stats.readers.length === 0 ? (
          <SubsectionEmpty>{t('news_stats.empty_readers')}</SubsectionEmpty>
        ) : (
          stats.readers.map((r) => (
            <ReaderRow key={r.userId} reader={r} usersByLogin={usersByLogin} />
          ))
        )}
      </SubSection>

      <SubSection title={t('news_stats.section_not_readers')} count={stats.notReaders.length}>
        {stats.notReaders.length === 0 ? (
          <SubsectionEmpty>{t('news_stats.empty_not_readers')}</SubsectionEmpty>
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
      <AvatarWithPresence
        userId={reader.userId}
        initials={reader.initials}
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
  const { t } = useTranslation();
  if (!poll) return <EmptyHint>{t('news_stats.no_poll')}</EmptyHint>;
  if (!stats) return <EmptyHint>{t('news_stats.empty_poll')}</EmptyHint>;

  const total = poll.totalVoters;
  const totalPolled = stats.voters.length + stats.notVoters.length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-[13.5px] font-medium leading-snug text-text-strong">
          {poll.question}
        </h3>
        {/* Description показываем только если реально отличается от question'a —
            server обычно шлёт их одинаковыми (см. Kotlin PollBuilderSheet),
            и дублирование тела вверху диалога визуально шумит. */}
        {poll.description && poll.description.trim() !== poll.question.trim() && (
          <p className="mt-1 text-[12px] text-text-muted">{poll.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votesCount / total) * 100) : 0;
          const isMyVote = o.id === poll.myVoteOptionId;
          return (
            <div
              key={o.id}
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
              <div className="relative flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                <span
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5',
                    isMyVote ? 'font-medium text-text-strong' : 'text-text-primary',
                  )}
                >
                  {isMyVote && (
                    <span
                      aria-label={t('news_stats.my_choice_aria')}
                      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent-clay text-[9px] font-bold text-white"
                    >
                      ✓
                    </span>
                  )}
                  <span className="truncate">{o.text}</span>
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
        <Trans
          i18nKey="news_stats.summary_poll"
          values={{ voted: stats.voters.length, total: totalPolled }}
          components={{ b: <span className="font-medium text-text-strong" /> }}
        />
      </p>

      <SubSection title={t('news_stats.section_voters')} count={stats.voters.length}>
        {stats.voters.length === 0 ? (
          <SubsectionEmpty>{t('news_stats.empty_voters')}</SubsectionEmpty>
        ) : (
          stats.voters.map((v) => (
            <VoterRow
              key={v.userId}
              voter={v}
              poll={poll}
              optionsById={stats.optionsById}
              usersByLogin={usersByLogin}
            />
          ))
        )}
      </SubSection>

      <SubSection title={t('news_stats.section_not_voters')} count={stats.notVoters.length}>
        {stats.notVoters.length === 0 ? (
          <SubsectionEmpty>{t('news_stats.empty_not_voters')}</SubsectionEmpty>
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
  /** `optionId → text` lookup из stats response (авторитативный источник). */
  optionsById: Record<number, string>;
  usersByLogin: UsersByLogin;
}

function VoterRow({ voter, poll, optionsById, usersByLogin }: VoterRowProps) {
  const { t } = useTranslation();
  // Каскад: votedOptionTexts → optionsById → news.poll.options
  const optionTexts =
    voter.votedOptionTexts.length > 0
      ? voter.votedOptionTexts
      : voter.votedOptionIds
          .map(
            (id) => optionsById[id] || poll.options.find((o) => o.id === id)?.text || '',
          )
          .filter((s) => s.length > 0);
  const u = usersByLogin[voter.userId];
  // Если каскад не сработал — показываем «Проголосовал» (без #id, который
  // юзеру не нравится). По крайней мере viewer видит ЧТО юзер участвовал.
  const choiceLabel = optionTexts.length > 0 ? optionTexts.join(', ') : t('news_stats.voted_label');

  return (
    <div className="flex items-center gap-3 py-1">
      <Check className="h-3.5 w-3.5 shrink-0 text-presence-online" strokeWidth={2.25} />
      <AvatarWithPresence
        userId={voter.userId}
        initials={voter.initials}
        avatarUrl={u?.avatarUrl}
        avatarBlobKey={u?.avatarBlobKey}
        avatarBlobNonce={u?.avatarBlobNonce}
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] text-text-primary">{voter.name}</span>
        {choiceLabel && (
          <span className="truncate text-[11px] font-medium text-accent-clay">
            {choiceLabel}
          </span>
        )}
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
      <AvatarWithPresence
        userId={person.userId}
        initials={person.initials}
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

/**
 * §pyn-1.2.40 — Avatar + PresenceDot для строк статистики (readers / voters /
 * notReaders / notVoters). Presence реактивный через usePresenceStore —
 * WS push presence_change обновляет dot без re-fetch'а stats.
 */
interface AvatarWithPresenceProps {
  userId: string;
  initials: string;
  avatarUrl?: string;
  avatarBlobKey?: string | null;
  avatarBlobNonce?: string | null;
}

function AvatarWithPresence({
  userId,
  initials,
  avatarUrl,
  avatarBlobKey,
  avatarBlobNonce,
}: AvatarWithPresenceProps) {
  const presence = usePresenceStore((s) => s.byLogin[userId]?.status ?? 'offline');
  return (
    <span className="relative shrink-0">
      <Avatar
        initials={initials}
        size={26}
        login={userId}
        avatarUrl={avatarUrl}
        avatarBlobKey={avatarBlobKey ?? undefined}
        avatarBlobNonce={avatarBlobNonce ?? undefined}
      />
      <PresenceDot
        state={presence}
        size={9}
        ringClass="ring-bg-elevated"
        className="absolute -bottom-0.5 -right-0.5"
      />
    </span>
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

/**
 * Skeleton placeholder вместо «Загрузка…» — пульсирующие серые блоки,
 * имитирующие реальную structure (заголовок + список avatar+name+time).
 * Для poll'а — дополнительно imitate bar-graph рядов опций.
 */
function StatsSkeleton({ kind }: { kind: 'news' | 'poll' }) {
  return (
    <div className="flex animate-pulse flex-col gap-5">
      {kind === 'poll' && (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-3/4 rounded bg-bg-hover" />
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 rounded-md bg-bg-hover/70" />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="h-2.5 w-1/3 rounded bg-bg-hover" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-[26px] w-[26px] rounded-full bg-bg-hover" />
            <div className="h-2.5 flex-1 rounded bg-bg-hover/70" />
            <div className="h-2 w-10 rounded bg-bg-hover/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
