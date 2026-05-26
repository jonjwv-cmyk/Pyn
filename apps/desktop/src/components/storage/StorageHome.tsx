import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import {
  getStorageOpeners,
  logStorageOpen,
  useStorageStore,
  type StorageOpenerInfo,
} from '@pyn/core';
import { api } from '@/lib/api';
import { fileIconSpec } from '@/lib/file-icon';
import { formatFsTime } from '@/lib/format-fs-time';
import {
  pushStorageHistory,
  readStorageHistory,
  type StorageHistoryItem,
} from '@/lib/storage-history';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';

interface StorageHomeProps {
  root: string;
}

interface FsFolder {
  name: string;
  fullPath: string;
}

interface FsEntryLite {
  name: string;
  isDirectory: boolean;
  fullPath: string;
}

type TileBehavior = 'direct' | 'year-files' | 'plans';

interface TileDef {
  matchPrefix: string;
  icon: LucideIcon;
  labelKey: string;
  fallbackLabel: string;
  accent: string;
  iconColor: string;
  behavior: TileBehavior;
}

/**
 * §pyn-1.2.47 — Storage home через Radix DropdownMenu.Sub (Google-Sheets style).
 *
 *   • 4 плитки 2×2, выровненные по baseline (иконка слева, текст и chevron справа).
 *   • Click на плитку → DropdownMenu.Content (popover).
 *   • Items с children = SubTrigger → submenu открывается **сбоку** при hover.
 *   • Первый item в submenu = «Открыть «X»» → navigate в эту папку.
 *     Дальше идут вложенные folders/files.
 *   • Pills для «Планы» — внутри плитки снизу, формат `22 мая` (Intl).
 *   • Локализация месяцев — через `Intl.DateTimeFormat`.
 */
const TILES: TileDef[] = [
  {
    matchPrefix: '1.',
    icon: Inbox,
    labelKey: 'storage.home.consent_routing',
    fallbackLabel: 'Согласование и Рассылка',
    accent: 'bg-sky-500/10',
    iconColor: 'text-sky-400',
    behavior: 'direct',
  },
  {
    matchPrefix: '2.',
    icon: CalendarDays,
    labelKey: 'storage.home.plans',
    fallbackLabel: 'Планы экспедиции',
    accent: 'bg-emerald-500/10',
    iconColor: 'text-emerald-400',
    behavior: 'plans',
  },
  {
    matchPrefix: '3.',
    icon: FolderOpen,
    labelKey: 'storage.home.delivery_schedule',
    fallbackLabel: 'График доставки ВМ (ТМЦ)',
    accent: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    behavior: 'year-files',
  },
  {
    matchPrefix: '4.',
    icon: BarChart3,
    labelKey: 'storage.home.reports',
    fallbackLabel: 'Отчёты',
    accent: 'bg-violet-500/10',
    iconColor: 'text-violet-400',
    behavior: 'year-files',
  },
];

export function StorageHome({ root }: StorageHomeProps) {
  const { t } = useTranslation();
  const navigateTo = useStorageStore((s) => s.navigateTo);

  const [folders, setFolders] = useState<FsFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.pyn?.fs?.list(root).then((res) => {
      if (cancelled) return;
      if (res?.ok && res.entries) {
        setFolders(
          res.entries
            .filter((e) => e.isDirectory)
            .map((e) => ({ name: e.name, fullPath: e.fullPath })),
        );
        setError(null);
      } else {
        setFolders([]);
        setError(res?.error ?? 'unknown');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // §pyn-1.2.52 — обёртки навигации/открытия файла с записью в Историю
  // (LRU 10). TileCard / pills / submenus вызывают эти callbacks вместо
  // прямого navigateTo, чтобы History panel заполнялся.
  const basename = (p: string): string =>
    p.split('\\').filter(Boolean).pop() ?? p;

  const handleNavigate = useCallback(
    (path: string) => {
      pushStorageHistory({
        fullPath: path,
        name: basename(path),
        isDirectory: true,
      });
      // §pyn-1.2.53 — server activity log (fire-and-forget).
      void logStorageOpen(api, path);
      navigateTo(path);
    },
    [navigateTo],
  );

  const handleOpenFile = useCallback(async (filePath: string) => {
    pushStorageHistory({
      fullPath: filePath,
      name: basename(filePath),
      isDirectory: false,
    });
    void logStorageOpen(api, filePath);
    await window.pyn?.fs?.open(filePath);
  }, []);

  const resolved = TILES.map((tile) => {
    const folder = folders.find((f) => f.name.trim().startsWith(tile.matchPrefix));
    return { tile, folder };
  });

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
        {t('storage.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <FolderOpen className="h-12 w-12 text-text-muted opacity-40" strokeWidth={1.2} />
        <h3 className="text-base font-semibold text-text-primary">
          {t('storage.error_title')}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">{error}</p>
      </div>
    );
  }

  return (
    // §pyn-1.2.51 — двухколоночный layout: слева 4 плитки 2×2, справа История
    // (LRU 10 недавно открытых файлов/папок).
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-6">
        {/* §pyn-1.2.53 — плитки вертикальный стек в порядке TILES:
            Согласование Рассылка → Планы → График доставки → Отчёты.
            Plans tile с 8 pills (4×2) расширяется на свою высоту. */}
        <div className="flex flex-col gap-3 self-start">
          {resolved.map(({ tile, folder }) => (
            <TileCard
              key={tile.matchPrefix}
              tile={tile}
              folder={folder}
              onNavigate={handleNavigate}
              onOpenFile={(p) => void handleOpenFile(p)}
            />
          ))}
        </div>
        <HistoryPanel
          root={root}
          onNavigate={handleNavigate}
          onOpenFile={(p) => void handleOpenFile(p)}
        />
      </div>
    </div>
  );
}

// ── History Panel ──────────────────────────────────────────────────────────

/**
 * §pyn-1.2.51 — right-колонка StorageHome. Показывает 10 последних
 * открытых файлов/папок (LRU из localStorage). Click → открыть файл / войти
 * в папку.
 */
function HistoryPanel({
  root,
  onNavigate,
  onOpenFile,
}: {
  root: string;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [history, setHistory] = useState<StorageHistoryItem[]>(() =>
    readStorageHistory(),
  );
  // §pyn-1.2.53 — server-side last-opener для каждого path в истории.
  // Map обновляется при mount + focus + после изменения history.
  const [openers, setOpeners] = useState<Map<string, StorageOpenerInfo>>(
    () => new Map(),
  );

  useEffect(() => {
    const refresh = (): void => setHistory(readStorageHistory());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  // §pyn-1.2.53 — fetch последних открывших для всех путей в истории.
  // Один bulk-запрос на 10 путей, повторяется при изменении history.
  useEffect(() => {
    if (history.length === 0) {
      setOpeners(new Map());
      return;
    }
    let cancelled = false;
    void getStorageOpeners(
      api,
      history.map((h) => h.fullPath),
    ).then((map) => {
      if (!cancelled) setOpeners(map);
    });
    return () => {
      cancelled = true;
    };
  }, [history]);

  const handleClick = useCallback(
    (item: StorageHistoryItem) => {
      if (item.isDirectory) onNavigate(item.fullPath);
      else onOpenFile(item.fullPath);
    },
    [onNavigate, onOpenFile],
  );

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-2 px-2">
        <Clock className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t('storage.history.title', 'История')}
        </h3>
      </div>
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-subtle px-4 py-8 text-center text-[12px] text-text-muted">
          {t('storage.history.empty', 'Нет недавно открытых файлов')}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {history.map((item) => (
            <HistoryRow
              key={item.fullPath}
              item={item}
              root={root}
              opener={openers.get(item.fullPath) ?? null}
              onClick={() => handleClick(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * §pyn-1.2.53 — категория (откуда файл) по первому сегменту после root.
 * `\\…\Экспедиция\2. Планы экспедиции\…` → matchPrefix='2.' → "Планы".
 * Используется в HistoryRow subtitle для маленького тэга.
 */
function getCategoryLabel(
  fullPath: string,
  root: string,
  translate: (key: string, fallback: string) => string,
): string {
  if (!fullPath.toLowerCase().startsWith(root.toLowerCase())) return '';
  const rel = fullPath.slice(root.length).replace(/^\\+/, '');
  const firstSegment = rel.split('\\')[0]?.trim() ?? '';
  if (!firstSegment) return '';
  const tile = TILES.find((tl) => firstSegment.startsWith(tl.matchPrefix));
  if (!tile) return '';
  if (tile.matchPrefix === '1.') {
    return translate('storage.home.consent_routing_short', 'Согласование');
  }
  return translate(tile.labelKey, tile.fallbackLabel);
}

function buildInitials(fullName: string, login: string): string {
  const source = (fullName || login).trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function HistoryRow({
  item,
  root,
  opener,
  onClick,
}: {
  item: StorageHistoryItem;
  root: string;
  opener: StorageOpenerInfo | null;
  onClick: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const spec = fileIconSpec(item.name, item.isDirectory);
  const Icon = item.isDirectory ? Folder : spec.Icon;
  // i18next `t` имеет overloaded signature — пробрасываем через узкий тип.
  const category = getCategoryLabel(item.fullPath, root, (k, f) => t(k, f));

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-bg-hover"
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          spec.bgColor,
        )}
      >
        <Icon className={cn('h-4 w-4', spec.iconColor)} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {item.name}
        </div>
        {/* §pyn-1.2.53 — subtitle: категория · время · кто открывал. Всё
            одной строкой с truncate, чтобы не раздувалось. */}
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-muted">
          {category && (
            <span className="shrink-0 rounded-md bg-bg-elevated px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide text-text-secondary">
              {category}
            </span>
          )}
          <span className="shrink-0">{formatFsTime(item.openedAt)}</span>
          {opener?.fullName && (
            <>
              <span className="shrink-0 opacity-50">·</span>
              <span className="truncate">{opener.fullName}</span>
            </>
          )}
        </div>
      </div>
      {/* §pyn-1.2.53 — аватарка последнего открывшего + presence dot.
          Только если сервер вернул opener'a (т.е. кто-то уже открывал
          этот путь после deploy'а 1.2.53). */}
      {opener?.login && (
        <div className="relative shrink-0">
          <Avatar
            initials={buildInitials(opener.fullName, opener.login)}
            avatarUrl={opener.avatarUrl || undefined}
            avatarBlobKey={opener.avatarBlobKey || undefined}
            avatarBlobNonce={opener.avatarBlobNonce || undefined}
            login={opener.login}
            size={26}
          />
          <PresenceDot
            state={opener.presenceStatus}
            size={8}
            className="absolute -bottom-0.5 -right-0.5"
            ringClass="ring-2 ring-bg-surface"
          />
        </div>
      )}
    </button>
  );
}

// ── Tile Card ──────────────────────────────────────────────────────────────

interface TileCardProps {
  tile: TileDef;
  folder: FsFolder | undefined;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function TileCard({ tile, folder, onNavigate, onOpenFile }: TileCardProps): JSX.Element {
  const { t } = useTranslation();
  const Icon = tile.icon;
  const label = t(tile.labelKey, tile.fallbackLabel);
  const disabled = !folder;

  // Direct = моментально navigate без меню.
  // §pyn-1.2.48 — flex-1 на button чтобы кнопка вытягивалась по всей высоте
  // grid-cell (grid stretches all tiles до самой высокой = Plans tile с pills).
  // Без этого текст плитки visually прижат к top, а не центрирован.
  if (tile.behavior === 'direct') {
    return (
      <div className="flex flex-col rounded-2xl border border-border-subtle bg-bg-elevated">
        <button
          type="button"
          disabled={disabled}
          onClick={() => folder && onNavigate(folder.fullPath)}
          className={cn(
            'group flex flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:bg-bg-primary/40',
          )}
        >
          <TileIconCell tile={tile} Icon={Icon} />
          <span className="min-w-0 flex-1 whitespace-pre-line text-[14.5px] font-medium leading-tight text-text-strong">
            {label}
          </span>
        </button>
      </div>
    );
  }

  // Year-files (График / Отчёты) — 2-level menu.
  if (tile.behavior === 'year-files') {
    return (
      <YearFilesTile
        tile={tile}
        folder={folder}
        label={label}
        Icon={Icon}
        disabled={disabled}
        onNavigate={onNavigate}
        onOpenFile={onOpenFile}
      />
    );
  }

  // Plans — 3-level menu (year → month → day) + pills внутри.
  return (
    <PlansTile
      tile={tile}
      folder={folder}
      label={label}
      Icon={Icon}
      disabled={disabled}
      onNavigate={onNavigate}
    />
  );
}

function TileIconCell({ tile, Icon }: { tile: TileDef; Icon: LucideIcon }): JSX.Element {
  return (
    <div
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
        tile.accent,
      )}
    >
      <Icon className={cn('h-5 w-5', tile.iconColor)} strokeWidth={1.75} />
    </div>
  );
}

// ── Year-files Tile (График, Отчёты) ───────────────────────────────────────

interface CommonTileProps {
  tile: TileDef;
  folder: FsFolder | undefined;
  label: string;
  Icon: LucideIcon;
  disabled: boolean;
  onNavigate: (path: string) => void;
}

interface YearFilesTileProps extends CommonTileProps {
  onOpenFile: (path: string) => void;
}

function YearFilesTile({
  tile,
  folder,
  label,
  Icon,
  disabled,
  onNavigate,
  onOpenFile,
}: YearFilesTileProps): JSX.Element {
  const [years, setYears] = useState<FsFolder[]>([]);

  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    void window.pyn?.fs?.list(folder.fullPath).then((res) => {
      if (cancelled || !res?.ok || !res.entries) return;
      setYears(
        res.entries
          .filter((e) => e.isDirectory)
          .map((e) => ({ name: e.name, fullPath: e.fullPath }))
          .sort((a, b) => b.name.localeCompare(a.name, 'ru', { numeric: true })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            // §pyn-1.2.48 — h-full чтобы кнопка занимала всю высоту grid-cell
            // (контейнер растягивается по самой высокой Plans-плитке с pills).
            'group flex h-full w-full items-center gap-3 rounded-2xl border border-border-subtle bg-bg-elevated px-4 py-3.5 text-left transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:bg-bg-primary/40 data-[state=open]:border-border-default data-[state=open]:bg-bg-primary/40',
          )}
        >
          <TileIconCell tile={tile} Icon={Icon} />
          <span className="min-w-0 flex-1 whitespace-pre-line text-[14.5px] font-medium leading-tight text-text-strong">
            {label}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      {folder && (
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className={menuContentClass}
          >
            {years.length === 0 ? (
              <EmptyMenuHint />
            ) : (
              years.map((y) => (
                <YearFilesSub
                  key={y.fullPath}
                  year={y}
                  onNavigate={onNavigate}
                  onOpenFile={onOpenFile}
                />
              ))
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      )}
    </DropdownMenu.Root>
  );
}

function YearFilesSub({
  year,
  onNavigate,
  onOpenFile,
}: {
  year: FsFolder;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FsEntryLite[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pyn?.fs?.list(year.fullPath).then((res) => {
      if (cancelled || !res?.ok || !res.entries) return;
      setFiles(
        res.entries
          .filter((e) => !e.isDirectory)
          .map((e) => ({ name: e.name, isDirectory: false, fullPath: e.fullPath }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [year.fullPath, open]);

  return (
    <DropdownMenu.Sub open={open} onOpenChange={setOpen}>
      <DropdownMenu.SubTrigger className={menuItemClass}>
        <span className="flex-1 truncate">{year.name.trim()}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          className={menuContentClass}
        >
          <DropdownMenu.Item
            className={cn(menuItemClass, 'font-medium')}
            onSelect={() => onNavigate(year.fullPath)}
          >
            {t('storage.menu.open_folder_name', { name: year.name.trim() })}
          </DropdownMenu.Item>
          {files.length > 0 && (
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          )}
          {files.map((f) => (
            <DropdownMenu.Item
              key={f.fullPath}
              className={menuItemClass}
              onSelect={() => onOpenFile(f.fullPath)}
            >
              <span className="flex-1 truncate">{f.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

// ── Plans Tile (год → месяц → день) ────────────────────────────────────────

function PlansTile({
  tile,
  folder,
  label,
  Icon,
  disabled,
  onNavigate,
}: CommonTileProps): JSX.Element {
  const [years, setYears] = useState<FsFolder[]>([]);

  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    void window.pyn?.fs?.list(folder.fullPath).then((res) => {
      if (cancelled || !res?.ok || !res.entries) return;
      setYears(
        res.entries
          .filter((e) => e.isDirectory)
          .map((e) => ({ name: e.name, fullPath: e.fullPath }))
          .sort((a, b) => b.name.localeCompare(a.name, 'ru', { numeric: true })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  return (
    <div className="flex flex-col rounded-2xl border border-border-subtle bg-bg-elevated">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              // §pyn-1.2.48 — flex-1 чтобы button занимал всё доступное space
              // между TileIconCell и pills внизу: текст vertically centered.
              'group flex flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors',
              disabled
                ? 'cursor-not-allowed opacity-40'
                : 'cursor-pointer hover:bg-bg-primary/40 data-[state=open]:bg-bg-primary/40',
            )}
          >
            <TileIconCell tile={tile} Icon={Icon} />
            <span className="min-w-0 flex-1 whitespace-pre-line text-[14.5px] font-medium leading-tight text-text-strong">
              {label}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
          </button>
        </DropdownMenu.Trigger>
        {folder && (
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className={menuContentClass}
            >
              {years.length === 0 ? (
                <EmptyMenuHint />
              ) : (
                years.map((y) => (
                  <PlansYearSub
                    key={y.fullPath}
                    year={y}
                    onNavigate={onNavigate}
                  />
                ))
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </DropdownMenu.Root>
      {folder && <QuickPlanPills folder={folder} onNavigate={onNavigate} />}
    </div>
  );
}

function PlansYearSub({
  year,
  onNavigate,
}: {
  year: FsFolder;
  onNavigate: (path: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<FsFolder[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pyn?.fs?.list(year.fullPath).then((res) => {
      if (cancelled || !res?.ok || !res.entries) return;
      setMonths(
        res.entries
          .filter((e) => e.isDirectory)
          .map((e) => ({ name: e.name, fullPath: e.fullPath }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [year.fullPath, open]);

  return (
    <DropdownMenu.Sub open={open} onOpenChange={setOpen}>
      <DropdownMenu.SubTrigger className={menuItemClass}>
        <span className="flex-1 truncate">{year.name.trim()}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={menuContentClass}>
          <DropdownMenu.Item
            className={cn(menuItemClass, 'font-medium')}
            onSelect={() => onNavigate(year.fullPath)}
          >
            {t('storage.menu.open_folder_name', { name: year.name.trim() })}
          </DropdownMenu.Item>
          {months.length > 0 && (
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          )}
          {months.map((m) => (
            <PlansMonthSub key={m.fullPath} month={m} onNavigate={onNavigate} />
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function PlansMonthSub({
  month,
  onNavigate,
}: {
  month: FsFolder;
  onNavigate: (path: string) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<FsFolder[]>([]);

  // §pyn-1.2.47 — название месяца локализовано через Intl.
  // «5. Май» → монаp index → "Май" / "May" / etc.
  const monthLabel = useMemo(() => {
    const stripped = month.name.trim().replace(/^\d+\.\s*/, '');
    // Резолвим какой именно месяц (по cyrillic prefix).
    const monthIdx = guessMonthIdx(stripped);
    if (monthIdx < 0) return stripped;
    return formatMonthName(monthIdx, i18n.language);
  }, [month.name, i18n.language]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pyn?.fs?.list(month.fullPath).then((res) => {
      if (cancelled || !res?.ok || !res.entries) return;
      setDays(
        res.entries
          .filter((e) => e.isDirectory)
          .map((e) => ({ name: e.name, fullPath: e.fullPath }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [month.fullPath, open]);

  return (
    <DropdownMenu.Sub open={open} onOpenChange={setOpen}>
      <DropdownMenu.SubTrigger className={menuItemClass}>
        <span className="flex-1 truncate">{monthLabel}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={menuContentClass}>
          <DropdownMenu.Item
            className={cn(menuItemClass, 'font-medium')}
            onSelect={() => onNavigate(month.fullPath)}
          >
            {t('storage.menu.open_folder_name', { name: monthLabel })}
          </DropdownMenu.Item>
          {days.length > 0 && (
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          )}
          {days.map((d) => {
            const label = formatDayFolderLabel(d.name, i18n.language);
            return (
              <DropdownMenu.Item
                key={d.fullPath}
                className={menuItemClass}
                onSelect={() => onNavigate(d.fullPath)}
              >
                <span className="flex-1 truncate">{label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

// ── Quick Plan Pills (внутри плитки Плана) ─────────────────────────────────

interface PillCandidate {
  date: Date;
  label: string;
  fullPath: string | null;
  isToday: boolean;
}

function QuickPlanPills({
  folder,
  onNavigate,
}: {
  folder: FsFolder;
  onNavigate: (path: string) => void;
}): JSX.Element | null {
  const { i18n } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const [pills, setPills] = useState<PillCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    void resolveSmartPlanPills(folder.fullPath, today, i18n.language).then((arr) => {
      if (!cancelled) setPills(arr);
    });
    return () => {
      cancelled = true;
    };
  }, [folder.fullPath, today, i18n.language]);

  if (pills.length === 0) return null;

  return (
    // §pyn-1.2.53 — 8 pills в 4×2 grid'е (Linear/Figma compact layout).
    // Не flex-wrap чтобы строго 4 колонки; каждая ячейка одинаковой ширины.
    <div className="grid grid-cols-4 gap-1 border-t border-border-subtle px-3 py-2">
      {pills.map((p) => (
        <button
          key={p.date.getTime()}
          type="button"
          disabled={!p.fullPath}
          onClick={() => p.fullPath && onNavigate(p.fullPath)}
          className={cn(
            'flex h-7 items-center justify-center rounded-md border px-2 text-[11px] font-medium transition-colors',
            !p.fullPath
              ? 'cursor-not-allowed border-border-subtle text-text-muted/50'
              : 'border-border-subtle text-text-secondary hover:border-border-default hover:bg-bg-primary hover:text-text-strong',
            p.isToday && p.fullPath && 'border-accent-clay/40 bg-accent-clay-bg text-text-strong',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Menu helpers ───────────────────────────────────────────────────────────

const menuContentClass = cn(
  'z-50 min-w-[200px] max-h-[420px] overflow-y-auto rounded-xl border border-border-default',
  'bg-bg-elevated p-1 shadow-2xl',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
);

const menuItemClass = cn(
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-text-primary',
  'outline-none transition-colors',
  'data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
  'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
);

function EmptyMenuHint(): JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="px-3 py-2 text-[12px] italic text-text-muted">
      {t('storage.year_picker.empty')}
    </p>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

const RU_MONTH_PREFIXES = [
  'январ', 'феврал', 'март', 'апрел', 'май', 'июн',
  'июл', 'август', 'сентяб', 'октяб', 'ноябр', 'декаб',
];

/** Резолв month-index (0..11) из cyrillic-name. -1 если не распознан. */
function guessMonthIdx(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < 12; i++) {
    if (lower.startsWith(RU_MONTH_PREFIXES[i]!)) return i;
  }
  for (let i = 0; i < 12; i++) {
    if (lower.includes(RU_MONTH_PREFIXES[i]!)) return i;
  }
  return -1;
}

/** Локализованное название месяца в номинативе («Май», «May», ...). */
function formatMonthName(monthIdx: number, locale: string): string {
  return new Date(2000, monthIdx, 1).toLocaleDateString(locale, { month: 'long' });
}

/** Локализованный label дня: `22 мая`, `24-25 мая`, `22 May`. */
function formatDayFolderLabel(name: string, locale: string): string {
  const trimmed = name.trim();
  const range = trimmed.match(/^(\d+)-(\d+)\.(\d+)\.(\d+)/);
  if (range) {
    const a = parseInt(range[1] ?? '', 10);
    const b = parseInt(range[2] ?? '', 10);
    const m = parseInt(range[3] ?? '', 10);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(m)) {
      return `${a}-${b} ${formatMonthForDay(m - 1, locale)}`;
    }
  }
  const single = trimmed.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (single) {
    const d = parseInt(single[1] ?? '', 10);
    const m = parseInt(single[2] ?? '', 10);
    if (Number.isFinite(d) && Number.isFinite(m)) {
      return `${d} ${formatMonthForDay(m - 1, locale)}`;
    }
  }
  return trimmed;
}

/**
 * Месяц в форме для «N <месяц>» — для русского даёт genitive («мая»).
 *
 * §pyn-1.2.48 — раньше использовали `toLocaleDateString({day,month})` +
 * `replace(/^\d+\s+/, '')`, но в EN/US формате результат `"March 1"`
 * (day после month) — strip leading-digit regex не срабатывал и в popover
 * оставался хвост `"5 March 1"`. Сейчас берём только month part через
 * formatToParts — locale-aware и без хрупких regex'ов.
 */
function formatMonthForDay(monthIdx: number, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  const parts = fmt.formatToParts(new Date(2000, monthIdx, 1));
  return parts.find((p) => p.type === 'month')?.value ?? '';
}

function formatPillLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
    .replace(/\s+г\.?$/, '');
}

/**
 * §pyn-1.2.45/47 — 7 pills: 1 prev + today (+ disabled?) + next до 7-total.
 */
async function resolveSmartPlanPills(
  plansRoot: string,
  today: Date,
  locale: string,
): Promise<PillCandidate[]> {
  if (!window.pyn?.fs) return [];

  const yearRes = await window.pyn.fs.list(plansRoot);
  if (!yearRes?.ok || !yearRes.entries) return [];
  const yearFolderMap = new Map<number, string>();
  for (const e of yearRes.entries) {
    if (!e.isDirectory) continue;
    const yNum = parseInt(e.name.trim(), 10);
    if (Number.isFinite(yNum)) yearFolderMap.set(yNum, e.fullPath);
  }

  const yearsToScan = new Set<number>();
  const monthsToScan = new Set<string>();
  // §pyn-1.2.52 — scan ±60 дней. Когда today близок к концу месяца и в
  // текущем месяце не хватает 7 будущих папок, алгоритм должен find pills
  // в следующем месяце (например 28 мая → 1, 3 июня).
  for (let d = -30; d <= 60; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    yearsToScan.add(date.getFullYear());
    monthsToScan.add(`${date.getFullYear()}-${date.getMonth()}`);
  }

  const monthFolderMap = new Map<string, string>();
  for (const yearNum of yearsToScan) {
    const yearPath = yearFolderMap.get(yearNum);
    if (!yearPath) continue;
    const monthRes = await window.pyn.fs.list(yearPath);
    if (!monthRes?.ok || !monthRes.entries) continue;
    for (const e of monthRes.entries) {
      if (!e.isDirectory) continue;
      const idx = guessMonthIdx(e.name);
      if (idx >= 0) monthFolderMap.set(`${yearNum}-${idx}`, e.fullPath);
    }
  }

  const dayMap = new Map<string, string>();
  for (const monthKey of monthsToScan) {
    const path = monthFolderMap.get(monthKey);
    if (!path) continue;
    const [yStr, mStr] = monthKey.split('-');
    const yNum = parseInt(yStr ?? '0', 10);
    const mNum = parseInt(mStr ?? '0', 10);
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum)) continue;
    const yearShort = String(yNum).slice(-2);
    const monthCal = mNum + 1;

    const dayRes = await window.pyn.fs.list(path);
    if (!dayRes?.ok || !dayRes.entries) continue;
    for (const e of dayRes.entries) {
      if (!e.isDirectory) continue;
      const days = parseDayFolderName(e.name.trim(), monthCal, yearShort);
      for (const dNum of days) {
        dayMap.set(`${yNum}-${monthCal}-${dNum}`, e.fullPath);
      }
    }
  }

  const result: PillCandidate[] = [];

  for (let d = 1; d <= 14; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (dayMap.has(key)) {
      result.push({
        date,
        label: formatPillLabel(date, locale),
        fullPath: dayMap.get(key) ?? null,
        isToday: false,
      });
      break;
    }
  }

  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if (dayMap.has(todayKey)) {
    result.push({
      date: today,
      label: formatPillLabel(today, locale),
      fullPath: dayMap.get(todayKey) ?? null,
      isToday: true,
    });
  }

  // §pyn-1.2.53 — 8 pills total (4×2 grid). 1 prev + 1 today + 6 next
  // (или 2 prev если today нет в FS, и т.д. — нижняя строка всегда заполнена).
  const nextNeeded = 8 - result.length;
  let collected = 0;
  // §pyn-1.2.52 — расширили до 60 дней вперёд: если в текущем месяце
  // папок мало, добираем из следующего месяца (28-29 мая + 1-3 июня …).
  for (let d = 1; d <= 60 && collected < nextNeeded; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (dayMap.has(key)) {
      result.push({
        date,
        label: formatPillLabel(date, locale),
        fullPath: dayMap.get(key) ?? null,
        isToday: false,
      });
      collected++;
    }
  }

  return result;
}

function parseDayFolderName(name: string, monthCal: number, yearShort: string): number[] {
  const range = name.match(/^(\d+)-(\d+)\.(\d+)\.(\d+)/);
  if (range && range[1] && range[2] && range[3] && range[4]) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    const fm = parseInt(range[3], 10);
    const fy = range[4];
    if (Number.isFinite(a) && Number.isFinite(b) && fm === monthCal && fy === yearShort) {
      const days: number[] = [];
      for (let d = Math.min(a, b); d <= Math.max(a, b); d++) days.push(d);
      return days;
    }
  }
  const single = name.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (single && single[1] && single[2] && single[3]) {
    const d = parseInt(single[1], 10);
    const fm = parseInt(single[2], 10);
    const fy = single[3];
    if (Number.isFinite(d) && fm === monthCal && fy === yearShort) return [d];
  }
  return [];
}
