import { Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUsersStore } from '@/lib/stores';
import { getUsers, isDeveloper, type Role, type UserSummary } from '@pyn/core';
import { CreateUserDialog } from './UserDialogs';
import { UserListRow } from './UserListRow';

// §pyn-1.2.46 — было 5_000 (720 req/час когда юзер в Settings/Users panel).
// 60_000 даёт 60 req/час — для имени/role изменений 1 минуты достаточно.
// Presence changes идут live через WS push presence_change → этот polling
// нужен только для редких rename/role/role-change events.
const POLL_MS = 60_000;
/** Через сколько ms toast'а message исчезает. */
const TOAST_FADE_MS = 4_000;

interface UseUsersPanelArgs {
  myRole: Role;
  myLogin: string;
  /** false — panel не активна, polling выключен (хук всё равно вызывается). */
  active: boolean;
}

interface UsersPanelUi {
  /** Заголовок для SettingsTopBar — включает count. */
  title: string;
  /** Контролы в правую зону topbar'a (search, refresh, +Создать). */
  actions: ReactNode;
  /** Тело — список + toast + dialogs (mount в section content area). */
  body: ReactNode;
}

/**
 * Inversion-of-control для UsersPanel: вся логика state'a + рендер topbar'a
 * actions + body отдаётся через возвращаемые JSX-узлы. Это нужно потому что
 * SettingsScreen рендерит единый SettingsTopBar **на всю ширину окна**
 * (поверх inner sidebar + content), а контролы panel'и должны жить рядом с
 * заголовком в этом topbar'е. Lift state вверх → single rendered topbar.
 *
 * `active=false` — хук не делает polling и не fetch'ит users (когда юзер
 * выбрал другую подсекцию Settings). Store остаётся как есть.
 */
export function useUsersPanelState({ myRole, myLogin, active }: UseUsersPanelArgs): UsersPanelUi {
  const { t } = useTranslation();
  const users = useUsersStore((s) => s.users);
  const setUsers = useUsersStore((s) => s.setUsers);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const refresh = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const fresh = await getUsers(api);
      setUsers(fresh);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('getUsers failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [setUsers]);

  // Cache-first: при mount panel'и если users уже есть в store (загружены
  // из safeStorage persist'a) — НЕ показываем spinner, refresh идёт в фоне.
  // Spinner только когда панель открыта впервые и cache пустой.
  useEffect(() => {
    if (!active) return;
    const initialSilent = users.length > 0;
    void refresh(initialSilent);
    const id = setInterval(() => {
      void refresh(true);
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refresh]);

  const handleStatusChange = useCallback((msg: string): void => {
    setStatusMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setStatusMessage(''), TOAST_FADE_MS);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.login.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q),
    );
  }, [users, query]);

  // Сортировка: developer → admin → client → user; внутри роли — алфавит.
  const sorted = useMemo(() => {
    const order: Record<UserSummary['role'], number> = {
      developer: 0,
      admin: 1,
      client: 2,
      user: 3,
    };
    return [...filtered].sort((a, b) => {
      const r = order[a.role] - order[b.role];
      if (r !== 0) return r;
      return a.fullName.localeCompare(b.fullName, 'ru');
    });
  }, [filtered]);

  const title =
    users.length > 0
      ? t('users_panel.title_with_count', { count: users.length })
      : t('users_panel.title');

  // Admin видит только список (avatar + имя + last seen). Поиск / refresh /
  // create — read-write controls, доступны только developer'у. UserListRow
  // тоже скрывает три точки управления для не-developer'ов (см. {isDev && ...}).
  const isDev = isDeveloper(myRole);
  const actions = isDev ? (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('users_panel.search_placeholder')}
        className={cn(
          'w-[240px] rounded-md border border-border-default bg-bg-elevated px-2.5 py-1 text-[12.5px]',
          'text-text-primary outline-none transition-colors',
          'placeholder:text-text-muted focus:border-accent-clay',
        )}
      />
      <button
        type="button"
        onClick={() => void refresh(false)}
        disabled={loading}
        aria-label={t('users_panel.refresh_aria')}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md',
          'text-text-muted outline-none transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
          'disabled:opacity-50',
        )}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => setShowCreate(true)}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md bg-accent-clay px-2.5 text-[12.5px]',
          'font-medium text-white outline-none transition-colors',
          'hover:bg-accent-clay-dim',
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        {t('users_panel.create')}
      </button>
    </>
  ) : null;

  const body = (
    <>
      {statusMessage && (
        <div
          className={cn(
            'border-b border-border-subtle bg-bg-elevated/60 px-4 py-1.5 text-[12px]',
            'text-text-secondary',
            'animate-in fade-in-0 slide-in-from-top-1 duration-200',
          )}
        >
          {statusMessage}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && users.length === 0 ? (
          <p className="text-center text-[12px] text-text-muted">{t('common.loading')}</p>
        ) : sorted.length === 0 ? (
          <p className="text-center text-[12px] text-text-muted">
            {query.trim() ? t('users_panel.not_found') : t('users_panel.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((u) => (
              <UserListRow
                key={u.login}
                user={u}
                myRole={myRole}
                myLogin={myLogin}
                onStatusChange={handleStatusChange}
                onRefresh={() => void refresh(true)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateUserDialog
        open={showCreate}
        myRole={myRole}
        onClose={() => setShowCreate(false)}
        onSuccess={(m) => {
          handleStatusChange(m);
          void refresh(true);
        }}
      />
    </>
  );

  return { title, actions, body };
}
