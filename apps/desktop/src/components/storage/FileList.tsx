import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, FolderPlus, Upload } from 'lucide-react';
import { useStorageStore } from '@pyn/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { logStorageOpen } from '@pyn/core';
import { api } from '@/lib/api';
import { fileIconSpec } from '@/lib/file-icon';
import { formatFsSize, formatFsTime } from '@/lib/format-fs-time';
import { pushStorageHistory } from '@/lib/storage-history';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  fullPath: string;
}

interface FileListProps {
  currentPath: string;
}

interface ClipboardItem {
  path: string;
  name: string;
  operation: 'copy' | 'cut';
}

/** §pyn-1.2.43 — паттерн «Рассылка»: первый токен цифра/точка/пробел, потом текст. */
const MAILING_REGEX = /^\d+\.\s/;

/**
 * §pyn-1.2.48 — canonical Шаблон. Только `NEW СОГЛ.xlsm` / `NEW СОГЛ..xlsm`.
 * §pyn-1.2.49 — клоны Windows (`NEW СОГЛ - копия`, `(N)`) попадают в Подготовку
 * как обычные рабочие файлы; юзер удаляет вручную через lasso+delete.
 */
const TEMPLATE_CANON_RE = /^new\s*согл\.{0,2}\.xlsm?$/i;

/** Detect "Согласование и Рассылка" папку по basename (case-insensitive contains). */
function isRoutingFolder(p: string): boolean {
  const tail = p.split('\\').filter(Boolean).pop() ?? '';
  return tail.toLowerCase().includes('согласование');
}

function classifyForRouting(entries: FileEntry[]): {
  template: FileEntry[];
  consent: FileEntry[];
  mailing: FileEntry[];
  preparation: FileEntry[];
  folders: FileEntry[];
} {
  const template: FileEntry[] = [];
  const consent: FileEntry[] = [];
  const mailing: FileEntry[] = [];
  const preparation: FileEntry[] = [];
  const folders: FileEntry[] = [];
  for (const e of entries) {
    if (e.isDirectory) {
      folders.push(e);
      continue;
    }
    if (TEMPLATE_CANON_RE.test(e.name)) {
      template.push(e);
      continue;
    }
    if (MAILING_REGEX.test(e.name.trim())) {
      mailing.push(e);
      continue;
    }
    const first = e.name.trim().charAt(0);
    if (/[A-Za-z]/.test(first)) {
      consent.push(e);
    } else {
      // §pyn-1.2.49 — клоны Шаблона (`NEW СОГЛ - копия` от Windows) тоже
      // сюда: cyrillic-prefix → preparation. Юзер удалит когда захочет.
      preparation.push(e);
    }
  }
  const sortByName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, 'ru', { numeric: true });
  template.sort(sortByName);
  consent.sort(sortByName);
  mailing.sort(sortByName);
  preparation.sort(sortByName);
  folders.sort(sortByName);
  return { template, consent, mailing, preparation, folders };
}

interface LassoRect {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export function FileList({ currentPath }: FileListProps) {
  const { t } = useTranslation();
  const navigateTo = useStorageStore((s) => s.navigateTo);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [deleteCandidates, setDeleteCandidates] = useState<FileEntry[]>([]);
  const [renameCandidate, setRenameCandidate] = useState<FileEntry | null>(null);
  const [openCandidate, setOpenCandidate] = useState<FileEntry | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * §pyn-1.2.49 — lasso rectangle (drag-select как в Windows Explorer).
   * `startX/Y` — где зажали; `x/y` — текущий cursor. null когда не active.
   */
  const [lasso, setLasso] = useState<LassoRect | null>(null);
  /**
   * §pyn-1.2.51 — флаг что был реальный drag (> 5px). Используется чтобы
   * click-after-mouseup НЕ сбрасывал selection через onBgClick.
   * Browser автоматически dispatch'ит click event после mousedown→mouseup
   * на одном target — без флага selection моментально очищался.
   */
  const wasDraggingRef = useRef(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.pyn?.fs?.list(currentPath).then((res) => {
      if (cancelled) return;
      if (res?.ok && res.entries) {
        setEntries(res.entries);
        setError(null);
      } else {
        setEntries([]);
        setError(res?.error ?? 'unknown');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentPath, reloadKey]);

  // §pyn-1.2.48 — при смене папки очищаем selection.
  useEffect(() => {
    setSelected(new Set());
  }, [currentPath]);

  const routingMode = isRoutingFolder(currentPath);

  // §pyn-1.2.48 — refetch при возврате окна в foreground.
  useEffect(() => {
    const onFocus = (): void => reload();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const offNative = window.pyn?.onVisibilityChange?.((state) => {
      if (state === 'foreground') reload();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      offNative?.();
    };
  }, [reload]);

  /**
   * §pyn-1.2.43 — для файлов Согласование/Рассылка/Шаблон single-click →
   * confirm dialog. Для папок и Подготовки — straight open.
   */
  const handleActivate = useCallback(
    async (entry: FileEntry, viaConfirm = false) => {
      if (entry.isDirectory) {
        // §pyn-1.2.51 — local LRU 10 для right-колонки Home.
        pushStorageHistory({
          fullPath: entry.fullPath,
          name: entry.name,
          isDirectory: true,
        });
        // §pyn-1.2.53 — серверная activity-запись (fire-and-forget),
        // чтобы Home History показывал кто другой админ открывал последним.
        void logStorageOpen(api, entry.fullPath);
        navigateTo(entry.fullPath);
        return;
      }
      if (routingMode && !viaConfirm) {
        const isTemplate = TEMPLATE_CANON_RE.test(entry.name);
        const isMailing = MAILING_REGEX.test(entry.name.trim());
        const firstChar = entry.name.trim().charAt(0);
        const isConsent = /[A-Za-z]/.test(firstChar);
        if (isTemplate || isMailing || isConsent) {
          setOpenCandidate(entry);
          return;
        }
      }
      pushStorageHistory({
        fullPath: entry.fullPath,
        name: entry.name,
        isDirectory: false,
      });
      void logStorageOpen(api, entry.fullPath);
      await window.pyn?.fs?.open(entry.fullPath);
    },
    [navigateTo, routingMode],
  );

  const handleReveal = useCallback(async (entry: FileEntry) => {
    await window.pyn?.fs?.reveal(entry.fullPath);
  }, []);

  /**
   * §pyn-1.2.48 — selection логика. Ctrl/Cmd-click toggle; click заменяет
   * на single. Readonly rows игнорируются.
   */
  const handleSelect = useCallback(
    (entry: FileEntry, e: ReactMouseEvent<HTMLDivElement>, readonly: boolean) => {
      if (readonly) return;
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(entry.fullPath)) next.delete(entry.fullPath);
          else next.add(entry.fullPath);
          return next;
        });
      } else {
        setSelected(new Set([entry.fullPath]));
      }
    },
    [],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // §pyn-1.2.49 — readonly check для filename (батч-фильтр).
  const isReadonlyEntry = useCallback(
    (e: FileEntry): boolean => {
      if (e.isDirectory) return false;
      if (!routingMode) return false;
      if (TEMPLATE_CANON_RE.test(e.name)) return true;
      if (MAILING_REGEX.test(e.name.trim())) return true;
      const first = e.name.trim().charAt(0);
      return /[A-Za-z]/.test(first);
    },
    [routingMode],
  );

  const requestDelete = useCallback(
    (entry: FileEntry) => {
      if (selected.has(entry.fullPath) && selected.size > 1) {
        const targets = entries.filter(
          (e) => selected.has(e.fullPath) && !isReadonlyEntry(e),
        );
        if (targets.length === 0) return;
        setDeleteCandidates(targets);
      } else {
        setDeleteCandidates([entry]);
      }
    },
    [selected, entries, isReadonlyEntry],
  );

  const confirmDelete = useCallback(async () => {
    if (deleteCandidates.length === 0) return;
    await Promise.all(
      deleteCandidates.map((c) => window.pyn?.fs?.delete?.(c.fullPath)),
    );
    setDeleteCandidates([]);
    setSelected(new Set());
    reload();
  }, [deleteCandidates, reload]);

  const confirmRename = useCallback(
    async (newName: string) => {
      if (!renameCandidate) return;
      await window.pyn?.fs?.rename?.(renameCandidate.fullPath, newName);
      setRenameCandidate(null);
      reload();
    },
    [renameCandidate, reload],
  );

  const handleCopy = useCallback((entry: FileEntry) => {
    setClipboard({ path: entry.fullPath, name: entry.name, operation: 'copy' });
  }, []);

  const handleCut = useCallback((entry: FileEntry) => {
    setClipboard({ path: entry.fullPath, name: entry.name, operation: 'cut' });
  }, []);

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    if (clipboard.operation === 'copy') {
      await window.pyn?.fs?.copy?.(clipboard.path, currentPath);
    } else {
      await window.pyn?.fs?.move?.(clipboard.path, currentPath);
      setClipboard(null);
    }
    reload();
  }, [clipboard, currentPath, reload]);

  // §pyn-1.2.50 — quick «Создать копию здесь» для Шаблона. Прямая копия в
  // текущую папку через fs.copy; имя получает суффикс `- копия[N]` автоматически
  // через uniqueDestPath. После reload файл появляется в Подготовке (cyrillic
  // префикс classifier'а).
  const handleDuplicateHere = useCallback(
    async (entry: FileEntry) => {
      await window.pyn?.fs?.copy?.(entry.fullPath, currentPath);
      reload();
    },
    [currentPath, reload],
  );

  // §pyn-1.2.52 — ref для currentPath. Защита от stale closure: если
  // useCallback dependency не обновился по какой-то причине, ref всегда
  // содержит самое свежее значение.
  const currentPathRef = useRef(currentPath);
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      const targetPath = currentPathRef.current;
      // Диагностика — юзер сообщает что папка иногда создаётся уровнем выше.
      // Логируем явно куда mkdir отправляется, чтобы в pyn-dev.log было видно
      // в каком dirState UI оказался при confirm'е inline-формы.
      window.pyn?.debugLog?.(
        'storage:mkdir',
        `target=${targetPath} name=${name}`,
      );
      const res = await window.pyn?.fs?.mkdir?.(targetPath, name);
      setShowCreateInline(false);
      if (res?.ok) reload();
    },
    [reload],
  );

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      for (const f of files) {
        const filePath = window.pyn?.webUtils?.getPathForFile?.(f);
        if (!filePath) continue;
        await window.pyn?.fs?.upload(filePath, currentPath);
      }
      reload();
    },
    [currentPath, reload],
  );

  // §pyn-1.2.48 — Del/Esc keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        if (selected.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      if (e.key === 'Delete' && selected.size > 0) {
        const targets = entries.filter(
          (en) => selected.has(en.fullPath) && !isReadonlyEntry(en),
        );
        if (targets.length === 0) return;
        e.preventDefault();
        setDeleteCandidates(targets);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, entries, clearSelection, isReadonlyEntry]);

  // §pyn-1.2.49 — lasso drag-select. Document-level listeners пока active.
  // Каждое движение пересчитывает intersection с editable rows (атрибуты
  // data-row-path + data-editable). Это работает с любой структурой DOM
  // (DefaultListView / RoutingFolderView, scroll-area, секции, etc).
  useEffect(() => {
    if (!lasso) return;
    const handleMove = (e: MouseEvent) => {
      setLasso((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
    };
    const handleUp = () => {
      setLasso(null);
      // §pyn-1.2.51 — флаг живёт один tick'а, чтобы onClick scroll-area
      // (dispatched browser'ом сразу после mouseup) не сбросил selection.
      // На следующий tick reset — onClick дальше работает как обычно.
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 0);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [lasso]);

  useEffect(() => {
    if (!lasso) return;
    const x1 = Math.min(lasso.startX, lasso.x);
    const y1 = Math.min(lasso.startY, lasso.y);
    const x2 = Math.max(lasso.startX, lasso.x);
    const y2 = Math.max(lasso.startY, lasso.y);
    // Tiny drag (< 5px) — treat as bg-click, не меняем selection.
    if (x2 - x1 < 5 && y2 - y1 < 5) return;
    wasDraggingRef.current = true;
    const rows = document.querySelectorAll<HTMLElement>(
      '[data-pyn-row][data-editable="true"]',
    );
    const next = new Set<string>();
    rows.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right < x1 || r.left > x2 || r.bottom < y1 || r.top > y2) return;
      const path = el.getAttribute('data-pyn-row');
      if (path) next.add(path);
    });
    setSelected(next);
  }, [lasso]);

  // §pyn-1.2.51 — clearSelection обёртка которая уважает wasDragging флаг.
  // Передаётся в DefaultListView/RoutingFolderView вместо прямой clearSelection.
  const handleBgClickClear = useCallback(() => {
    if (wasDraggingRef.current) return;
    clearSelection();
  }, [clearSelection]);

  // §pyn-1.2.51 — drag-drop файлов между папками. dropTargetPath для visual
  // highlight целевой папки. Multi-select drag: если row входит в selected
  // (>1), тащим всё выделенное; иначе single row.
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const handleDropMove = useCallback(
    async (srcPaths: string[], destDir: string) => {
      // Защита от move в самого себя или своего родителя.
      const valid = srcPaths.filter((p) => {
        if (p === destDir) return false;
        // Move в свой parent — no-op (файл уже там).
        const parent = p.replace(/\\[^\\]+$/, '');
        return parent !== destDir;
      });
      if (valid.length === 0) return;
      await Promise.all(
        valid.map((p) => window.pyn?.fs?.move?.(p, destDir)),
      );
      setSelected(new Set());
      setDropTargetPath(null);
      reload();
    },
    [reload],
  );

  const handleBgMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Только левая кнопка и только клик строго по пустой области scroll-area.
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      // Без Ctrl/Shift — fresh selection (drag заменит); иначе оставляем
      // существующий selected и расширяем при drag (additive lasso).
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setSelected(new Set());
      }
      setLasso({
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const folderName = useMemo(
    () => currentPath.split('\\').filter(Boolean).pop() ?? t('storage.root_label'),
    [currentPath, t],
  );

  const ops: FileOps = {
    onActivate: (e) => void handleActivate(e),
    onReveal: (e) => void handleReveal(e),
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: () => void handlePaste(),
    onRename: setRenameCandidate,
    onDelete: requestDelete,
    onDuplicateHere: (e) => void handleDuplicateHere(e),
    onSelect: handleSelect,
    onDropMove: (paths, dest) => void handleDropMove(paths, dest),
    dropTargetPath,
    setDropTarget: setDropTargetPath,
    selected,
    clipboard,
  };

  const deleteDialogProps = useMemo(() => {
    if (deleteCandidates.length > 1) {
      return {
        title: t('storage.confirm_delete_batch_title', 'Удалить выбранные?'),
        description: t('storage.confirm_delete_batch_desc', {
          count: deleteCandidates.length,
          defaultValue: 'Будет удалено {{count}} элементов. Действие можно отменить через локальную корзину на рабочем столе.',
        }),
      };
    }
    return {
      title: t('storage.confirm_delete_title'),
      description: t('storage.confirm_delete_desc', {
        name: deleteCandidates[0]?.name ?? '',
      }),
    };
  }, [deleteCandidates, t]);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className="relative flex flex-1 flex-col overflow-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOver(false);
            }}
            onDrop={handleDrop}
          >
            {loading && entries.length === 0 && (
              <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
                {t('storage.loading')}
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
                <FolderOpen className="h-12 w-12 text-text-muted opacity-40" strokeWidth={1.2} />
                <h3 className="text-base font-semibold text-text-primary">
                  {t('storage.error_title')}
                </h3>
                {error !== 'platform_not_supported' && (
                  <p className="max-w-sm text-sm text-text-muted">{error}</p>
                )}
              </div>
            )}

            {!loading && !error && (
              <>
                {entries.length === 0 && !showCreateInline && (
                  <EmptyState folderName={folderName} />
                )}
                {(entries.length > 0 || showCreateInline) &&
                  (routingMode ? (
                    <RoutingFolderView
                      entries={entries}
                      ops={ops}
                      onBgMouseDown={handleBgMouseDown}
                      onBgClick={handleBgClickClear}
                      createInline={
                        showCreateInline ? (
                          <CreateFolderInline
                            onConfirm={(name) => void handleCreateFolder(name)}
                            onCancel={() => setShowCreateInline(false)}
                          />
                        ) : null
                      }
                    />
                  ) : (
                    <DefaultListView
                      entries={entries}
                      ops={ops}
                      onBgMouseDown={handleBgMouseDown}
                      onBgClick={handleBgClickClear}
                      createInline={
                        showCreateInline ? (
                          <CreateFolderInline
                            onConfirm={(name) => void handleCreateFolder(name)}
                            onCancel={() => setShowCreateInline(false)}
                          />
                        ) : null
                      }
                    />
                  ))}
              </>
            )}

            {dragOver && (
              <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-clay bg-bg-surface/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-clay-bg">
                    <Upload className="h-7 w-7 text-accent-clay" strokeWidth={1.75} />
                  </div>
                  <div className="text-base font-medium text-text-strong">
                    {t('storage.drop_caption', { folder: folderName })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ContextMenu.Trigger>
        {/* §pyn-1.2.43 — Background context menu (правый клик по пустой
            области). Создать папку + Вставить (если clipboard не пуст). */}
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={cn(
              'z-50 min-w-[200px] rounded-xl border border-border-default bg-bg-elevated p-1 shadow-2xl',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            )}
          >
            <MenuItem onSelect={() => setShowCreateInline(true)}>
              <FolderPlus className="mr-2 inline h-3.5 w-3.5" strokeWidth={1.75} />
              {t('storage.menu.create_folder')}
            </MenuItem>
            {clipboard && (
              <MenuItem onSelect={() => void handlePaste()}>
                {t('storage.menu.paste', { name: clipboard.name })}
              </MenuItem>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {/* §pyn-1.2.49 — visual lasso rectangle. Fixed positioning так как
          getBoundingClientRect возвращает viewport-relative coords. */}
      {lasso && (() => {
        const w = Math.abs(lasso.startX - lasso.x);
        const h = Math.abs(lasso.startY - lasso.y);
        if (w < 5 && h < 5) return null;
        return (
          <div
            className="pointer-events-none fixed z-40 rounded-sm border border-accent-clay bg-accent-clay/15"
            style={{
              left: Math.min(lasso.startX, lasso.x),
              top: Math.min(lasso.startY, lasso.y),
              width: w,
              height: h,
            }}
          />
        );
      })()}

      <ConfirmDialog
        open={deleteCandidates.length > 0}
        onOpenChange={(o) => !o && setDeleteCandidates([])}
        title={deleteDialogProps.title}
        description={deleteDialogProps.description}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={confirmDelete}
      />

      <RenameDialog
        candidate={renameCandidate}
        onClose={() => setRenameCandidate(null)}
        onConfirm={(name) => void confirmRename(name)}
      />

      <ConfirmDialog
        open={!!openCandidate}
        onOpenChange={(o) => !o && setOpenCandidate(null)}
        title={t('storage.confirm_open_title', { name: openCandidate?.name ?? '' })}
        description=""
        confirmLabel={t('common.yes')}
        cancelLabel={t('common.cancel')}
        onConfirm={async () => {
          const c = openCandidate;
          setOpenCandidate(null);
          if (c) await handleActivate(c, true);
        }}
      />
    </>
  );
}

interface FileOps {
  onActivate: (e: FileEntry) => void;
  onReveal: (e: FileEntry) => void;
  onCopy: (e: FileEntry) => void;
  onCut: (e: FileEntry) => void;
  onPaste: () => void;
  onRename: (e: FileEntry) => void;
  onDelete: (e: FileEntry) => void;
  /** §pyn-1.2.50 — quick «Создать копию здесь» для Шаблона. */
  onDuplicateHere: (e: FileEntry) => void;
  onSelect: (e: FileEntry, ev: ReactMouseEvent<HTMLDivElement>, readonly: boolean) => void;
  /** §pyn-1.2.51 — drag-drop move: srcPaths → destDir. */
  onDropMove: (srcPaths: string[], destDir: string) => void;
  /** §pyn-1.2.51 — текущая папка-цель для drop'а (visual highlight). */
  dropTargetPath: string | null;
  setDropTarget: (path: string | null) => void;
  selected: Set<string>;
  clipboard: ClipboardItem | null;
}

/** Single dropdown / context-menu item. */
function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'cursor-pointer rounded-md px-3 py-2 text-[12.5px] outline-none transition-colors',
        danger ? 'text-danger' : 'text-text-primary',
        'data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
      )}
    >
      {children}
    </ContextMenu.Item>
  );
}

/** §pyn-1.2.43→1.2.45 — inline-edit для создания папки как row в file list. */
function CreateFolderInline({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(t('storage.create_folder_default', 'Новая папка'));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const isValid =
    value.trim().length > 0 && !/[\\/:*?"<>|]/.test(value) && value !== '.' && value !== '..';
  return (
    <div className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-bg-hover">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-clay-bg">
        <FolderPlus className="h-4 w-4 text-accent-clay" strokeWidth={1.75} />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isValid) onConfirm(value.trim());
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => {
          if (isValid) onConfirm(value.trim());
          else onCancel();
        }}
        className={cn(
          'min-w-0 flex-1 rounded-md bg-bg-primary px-2 py-1 text-sm font-medium text-text-strong outline-none',
          'border',
          isValid ? 'border-accent-clay/40' : 'border-danger/60',
        )}
      />
    </div>
  );
}

interface RowProps {
  entry: FileEntry;
  ops: FileOps;
  /** Read-only sections: Шаблон/Согласование/Рассылка. Только Open/Reveal. */
  readonly?: boolean;
  /**
   * §pyn-1.2.50 — для Шаблона: дополнительная опция «Создать копию здесь»
   * в context menu. Создаваемая копия имеет имя `<base> - копия[N].xlsm`
   * (см. fs-bridge::uniqueDestPath) и попадает в Подготовку через classifier.
   */
  isTemplate?: boolean;
  iconHint?: 'mailing' | 'consent';
}

function FileRow({ entry, ops, readonly = false, isTemplate = false, iconHint }: RowProps) {
  const { t } = useTranslation();
  const { Icon, iconColor, bgColor } = fileIconSpec(entry.name, entry.isDirectory, iconHint);
  const isSelected = ops.selected.has(entry.fullPath);
  const isCut = ops.clipboard?.operation === 'cut' && ops.clipboard.path === entry.fullPath;
  const isDropTarget = entry.isDirectory && ops.dropTargetPath === entry.fullPath;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          /* §pyn-1.2.49 — атрибуты для lasso intersection scan'а. */
          data-pyn-row={entry.fullPath}
          data-editable={readonly ? 'false' : 'true'}
          /* §pyn-1.2.51 — drag-source. Только editable rows draggable
             (Шаблон/Согласование/Рассылка readonly — drag запрещён). */
          draggable={!readonly}
          onDragStart={(e) => {
            // Если row выделен и есть multi-select — тащим все выделенные.
            const paths =
              ops.selected.has(entry.fullPath) && ops.selected.size > 1
                ? Array.from(ops.selected)
                : [entry.fullPath];
            e.dataTransfer.setData('text/pyn-paths', JSON.stringify(paths));
            e.dataTransfer.effectAllowed = 'move';
          }}
          /* §pyn-1.2.51 — drag-target. Принимаем drop только на папки. */
          onDragOver={(e) => {
            if (!entry.isDirectory) return;
            if (!e.dataTransfer.types.includes('text/pyn-paths')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDragEnter={(e) => {
            if (!entry.isDirectory) return;
            if (!e.dataTransfer.types.includes('text/pyn-paths')) return;
            ops.setDropTarget(entry.fullPath);
          }}
          onDragLeave={(e) => {
            if (!entry.isDirectory) return;
            // Срабатывает на children — игнорируем кроме случая когда
            // указатель ушёл с самой строки.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX >= rect.right ||
              e.clientY < rect.top ||
              e.clientY >= rect.bottom
            ) {
              if (ops.dropTargetPath === entry.fullPath) ops.setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            if (!entry.isDirectory) return;
            e.preventDefault();
            e.stopPropagation();
            const json = e.dataTransfer.getData('text/pyn-paths');
            if (!json) return;
            try {
              const paths = JSON.parse(json) as string[];
              if (Array.isArray(paths) && paths.length > 0) {
                ops.onDropMove(paths, entry.fullPath);
              }
            } catch {
              /* invalid payload — ignore */
            }
            ops.setDropTarget(null);
          }}
          onClick={(e) => ops.onSelect(entry, e, readonly)}
          onDoubleClick={() => ops.onActivate(entry)}
          className={cn(
            'group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors',
            isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover',
            isCut && 'opacity-50',
            // §pyn-1.2.51 — visual highlight target папки при drag-over.
            isDropTarget && 'bg-accent-clay-bg/40 ring-1 ring-accent-clay/60',
          )}
        >
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', bgColor)}>
            <Icon className={cn('h-4 w-4', iconColor)} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-primary">{entry.name}</div>
            <div className="mt-0.5 truncate text-xs text-text-muted">
              {formatFsTime(entry.mtime)}
              {!entry.isDirectory && (
                <>
                  <span className="mx-1.5 opacity-50">·</span>
                  {formatFsSize(entry.size)}
                </>
              )}
            </div>
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            'z-50 min-w-[200px] rounded-xl border border-border-default bg-bg-elevated p-1 shadow-2xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <MenuItem onSelect={() => ops.onActivate(entry)}>
            {entry.isDirectory ? t('storage.menu.open_folder') : t('storage.menu.open_file')}
          </MenuItem>
          <MenuItem onSelect={() => ops.onReveal(entry)}>
            {t('storage.menu.reveal')}
          </MenuItem>
          {/* §pyn-1.2.50 — quick action для Шаблона: создать копию в этой
              же папке. Копия получит имя `NEW СОГЛ - копия[N].xlsm` и через
              classifier попадёт в раздел «Подготовка» где её можно редактировать
              и удалить. Оригинал NEW СОГЛ остаётся в Шаблоне нетронутый. */}
          {isTemplate && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border-subtle" />
              <MenuItem onSelect={() => ops.onDuplicateHere(entry)}>
                {t('storage.menu.duplicate_here', 'Создать копию здесь')}
              </MenuItem>
            </>
          )}
          {!readonly && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border-subtle" />
              <MenuItem onSelect={() => ops.onCopy(entry)}>
                {t('storage.menu.copy')}
              </MenuItem>
              <MenuItem onSelect={() => ops.onCut(entry)}>
                {t('storage.menu.cut')}
              </MenuItem>
              {ops.clipboard && (
                <MenuItem onSelect={ops.onPaste}>
                  {t('storage.menu.paste', { name: ops.clipboard.name })}
                </MenuItem>
              )}
              <ContextMenu.Separator className="my-1 h-px bg-border-subtle" />
              <MenuItem onSelect={() => ops.onRename(entry)}>
                {t('storage.menu.rename')}
              </MenuItem>
              <MenuItem
                danger
                onSelect={() => ops.onDelete(entry)}
              >
                {ops.selected.has(entry.fullPath) && ops.selected.size > 1
                  ? t('storage.menu.delete_batch', {
                      count: ops.selected.size,
                      defaultValue: 'Удалить выбранные ({{count}})',
                    })
                  : t('storage.menu.delete')}
              </MenuItem>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function DefaultListView({
  entries,
  ops,
  createInline,
  onBgMouseDown,
  onBgClick,
}: {
  entries: FileEntry[];
  ops: FileOps;
  createInline?: React.ReactNode;
  onBgMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onBgClick: () => void;
}) {
  return (
    <div
      // §pyn-1.2.50 — padding-top убран со scroll-area, перенесён внутрь.
      // Это позволит будущим sticky-блокам прилипать без щели от padding'а.
      className="flex-1 overflow-y-auto px-3 pb-32"
      onMouseDown={onBgMouseDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBgClick();
      }}
    >
      <div className="pt-3">
        {createInline}
        {entries.map((entry) => (
          <FileRow key={entry.fullPath} entry={entry} ops={ops} />
        ))}
      </div>
    </div>
  );
}

function RoutingFolderView({
  entries,
  ops,
  createInline,
  onBgMouseDown,
  onBgClick,
}: {
  entries: FileEntry[];
  ops: FileOps;
  createInline?: React.ReactNode;
  onBgMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onBgClick: () => void;
}) {
  const { t } = useTranslation();
  const { template, consent, mailing, preparation, folders } = classifyForRouting(entries);

  return (
    // §pyn-1.2.54 — раскладка с фиксированными заголовками. Никаких sticky:
    // верхняя часть (Папки / Шаблон) — shrink-0 (не скроллится), под ней
    // три колонки каждая со своим независимым scroll'ом. Заголовки колонок
    // — внутри той же колонки `shrink-0`, поэтому при прокрутке файлов
    // в колонке заголовок остаётся на месте намертво.
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Inline form создания папки + Folders section — фиксированы сверху. */}
      {createInline && <div className="shrink-0 px-4 pt-3">{createInline}</div>}
      {folders.length > 0 && (
        <div className="shrink-0 px-4 pt-3">
          <Section title={t('storage.routing.folders', 'Папки')}>
            {folders.map((e) => (
              <FileRow key={e.fullPath} entry={e} ops={ops} />
            ))}
          </Section>
        </div>
      )}

      {/* Шаблон — fixed top, не скроллится. Soft blur-fade снизу. */}
      {template.length > 0 && (
        <div className="relative shrink-0 bg-bg-surface px-4 pb-1 pt-3 shadow-[0_4px_8px_-6px_rgba(0,0,0,0.4)]">
          <SectionTitle>{t('storage.routing.template', 'Шаблон')}</SectionTitle>
          <div>
            {template.map((e) => (
              <FileRow key={e.fullPath} entry={e} ops={ops} readonly isTemplate />
            ))}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-4 h-4 bg-gradient-to-b from-bg-surface to-transparent"
          />
        </div>
      )}

      {/* 3-col grid с тонкими vertical dividers (Linear/Figma). divide-x
          проходит ОТ верха headers ДО низа scroll-area колонок. Каждая
          колонка имеет свой overflow-y-auto — файлы скроллятся независимо,
          заголовок намертво фиксирован. */}
      {(consent.length > 0 || mailing.length > 0 || preparation.length > 0) && (
        <div className="grid flex-1 grid-cols-3 divide-x divide-border-subtle/40 overflow-hidden px-4 pt-3">
          <ColumnPanel
            title={t('storage.routing.consent', 'Согласование')}
            entries={consent}
            ops={ops}
            iconHint="consent"
            readonly
            side="first"
            onBgMouseDown={onBgMouseDown}
            onBgClick={onBgClick}
          />
          <ColumnPanel
            title={t('storage.routing.mailing', 'Рассылка')}
            entries={mailing}
            ops={ops}
            iconHint="mailing"
            readonly
            side="middle"
            onBgMouseDown={onBgMouseDown}
            onBgClick={onBgClick}
          />
          <ColumnPanel
            title={t('storage.routing.preparation', 'Подготовка')}
            entries={preparation}
            ops={ops}
            side="last"
            onBgMouseDown={onBgMouseDown}
            onBgClick={onBgClick}
          />
        </div>
      )}
    </div>
  );
}

/**
 * §pyn-1.2.54 — колонка в трёхколоночной routing-раскладке. Заголовок
 * фиксирован сверху (shrink-0), список файлов под ним — независимый
 * overflow-y-auto. Никакого sticky — header не «плавает» при прокрутке,
 * крутится только содержимое колонки.
 */
function ColumnPanel({
  title,
  entries,
  ops,
  readonly = false,
  iconHint,
  side,
  onBgMouseDown,
  onBgClick,
}: {
  title: string;
  entries: FileEntry[];
  ops: FileOps;
  readonly?: boolean;
  iconHint?: 'mailing' | 'consent';
  /** Положение колонки: для inner-padding (compensate divide-x). */
  side: 'first' | 'middle' | 'last';
  onBgMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onBgClick: () => void;
}) {
  const padClass =
    side === 'first' ? 'pr-3' : side === 'last' ? 'pl-3' : 'px-3';
  return (
    <div className={cn('flex flex-col overflow-hidden', padClass)}>
      {/* Header — namertvo fixed. */}
      <div className="shrink-0 pb-2">
        <SectionTitle>{title}</SectionTitle>
      </div>
      {/* Content — независимый scroll, переход справа-сверху красивый. */}
      <div
        className="flex-1 overflow-y-auto pb-4"
        onMouseDown={onBgMouseDown}
        onClick={(e) => {
          if (e.target === e.currentTarget) onBgClick();
        }}
      >
        {entries.length > 0 ? (
          entries.map((e) => (
            <FileRow
              key={e.fullPath}
              entry={e}
              ops={ops}
              readonly={readonly}
              iconHint={iconHint}
            />
          ))
        ) : (
          <ColumnEmpty />
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <SectionTitle>{title}</SectionTitle>
      <div>{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </div>
  );
}

function ColumnEmpty() {
  return <div className="h-12 rounded-xl border border-dashed border-border-subtle" />;
}

function EmptyState({ folderName }: { folderName: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated">
        <FolderOpen className="h-8 w-8 text-text-muted opacity-50" strokeWidth={1.2} />
      </div>
      <h3 className="text-base font-semibold text-text-primary">
        {t('storage.empty_title')}
      </h3>
      <p className="max-w-sm text-sm text-text-muted">
        {t('storage.empty_desc', { folder: folderName })}
      </p>
    </div>
  );
}

/** Простой диалог переименования: input + Save/Cancel. */
function RenameDialog({
  candidate,
  onClose,
  onConfirm,
}: {
  candidate: FileEntry | null;
  onClose: () => void;
  onConfirm: (newName: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (candidate) setValue(candidate.name);
  }, [candidate]);
  const isValid =
    value.trim().length > 0 &&
    !/[\\/:*?"<>|]/.test(value) &&
    value !== '.' &&
    value !== '..';
  return (
    <Dialog.Root open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isValid) onConfirm(value.trim());
            if (e.key === 'Escape') onClose();
          }}
        >
          <Dialog.Title className="mb-2 text-[14px] font-semibold text-text-strong">
            {t('storage.rename_dialog_title')}
          </Dialog.Title>
          <label className="mb-3 block text-[11.5px] text-text-muted">
            {t('storage.rename_dialog_label')}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            className={cn(
              'w-full rounded-md bg-bg-primary px-3 py-2 text-sm text-text-strong outline-none',
              'border',
              isValid ? 'border-border-default' : 'border-danger/60',
            )}
          />
          {!isValid && value.length > 0 && (
            <p className="mt-1.5 text-[11px] text-danger">{t('storage.rename_invalid')}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => isValid && onConfirm(value.trim())}
              disabled={!isValid}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium outline-none transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {t('common.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
