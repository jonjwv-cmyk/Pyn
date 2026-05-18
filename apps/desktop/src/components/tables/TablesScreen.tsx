import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Chrome, RefreshCcw } from 'lucide-react';
import {
  checkSheetActionStatus,
  getMacroBundle,
  runScript,
  submitMacroData,
  useSheetsLockStore,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUiStateStore } from '@/lib/stores';
import {
  customActionLabel,
  customTabName,
  useTablesRegistry,
  type TableAction,
  type TableFile,
  type TableTab,
} from '@/lib/use-tables-registry';
import {
  SHEETS_INSPECT_SCRIPT,
  buildClickMenuPathScript,
  buildExtractMenuScript,
  buildSheetsMaskScript,
  buildSwitchSheetScript,
} from './sheets-mask';
import { SHEETS_PRESENCE_SCRIPT, type PresenceMember } from './sheets-presence';
import { SheetsLockOverlay } from './SheetsLockOverlay';
import { SheetsPasswordPrompt } from './SheetsPasswordPrompt';

/**
 * Раздел «Таблицы» — embedded Google Sheets через Electron `<webview>`.
 *
 * Архитектура (pool + hash switch):
 *   • Каждая открывавшаяся таблица держит собственный `<webview>` в DOM.
 *     Активная — `visibility: visible` + `z-index: 2`. Остальные —
 *     `visibility: hidden` + `pointer-events: none` (НЕ `display:none`:
 *     это убивает guest-view Electron'а). Webview-инстансы продолжают
 *     рендериться в фоне, как фоновые вкладки браузера.
 *   • Смена листа в рамках одной таблицы — императивно через
 *     `webview.executeJavaScript("location.hash = '#gid=...'")`, без
 *     изменения React-prop'а `src`. Google делает client-side switch
 *     без full reload grid'a (как при клике в нативном tab-bar'е).
 *   • CSS-маска инжектится после `did-stop-loading` (первая загрузка
 *     каждого webview). Hash-навигация не trigger'ит stop-loading,
 *     инжектить повторно не нужно — `<style>` остаётся в DOM.
 */

const SHEETS_PARTITION = 'persist:google-sheets';

type TWebview = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
  reload?: () => void;
  openDevTools?: (opts?: { mode?: string }) => void;
  addEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
};

export function TablesScreen({
  currentUserName,
}: {
  currentUserName: string;
}): JSX.Element {
  const { files, error, refresh } = useTablesRegistry();
  const activeFileId = useUiStateStore((s) => s.activeTableFileId);
  const activeTabName = useUiStateStore((s) => s.activeTableTabName);
  const setActiveTable = useUiStateStore((s) => s.setActiveTable);
  const activeLock = useSheetsLockStore((s) => s.activeLock);

  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  // file IDs которые когда-либо были активированы и держатся в pool'е.
  const [activatedFileIds, setActivatedFileIds] = useState<readonly string[]>([]);

  const webviewRefs = useRef<Map<string, TWebview>>(new Map());
  const eventsSetupRef = useRef<Set<string>>(new Set());
  const readyRef = useRef<Set<string>>(new Set());
  const pendingHashRef = useRef<Map<string, number>>(new Map());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default-table выбор на первом рендере (если ничего не активно).
  useEffect(() => {
    if (activeFileId || files.length === 0) return;
    for (const f of files) {
      const tab = f.tabs.find((t) => !t.hidden);
      if (tab) {
        setActiveTable(f.id, tab.rawName);
        break;
      }
    }
  }, [files, activeFileId, setActiveTable]);

  const activeFile = useMemo<TableFile | null>(
    () => files.find((f) => f.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  const activeTab = useMemo<TableTab | null>(() => {
    if (!activeFile || !activeTabName) return null;
    return activeFile.tabs.find((t) => t.rawName === activeTabName) ?? null;
  }, [activeFile, activeTabName]);

  // Preload ВСЕХ таблиц при mount раздела (как фоновые «вкладки браузера»).
  // Переключение между файлами без подгрузки. Memory price ОК для 2-3 таблиц.
  useEffect(() => {
    if (files.length === 0) return;
    setActivatedFileIds((prev) => {
      const set = new Set(prev);
      let changed = false;
      for (const f of files) {
        if (!set.has(f.id)) {
          set.add(f.id);
          changed = true;
        }
      }
      return changed ? Array.from(set) : prev;
    });
  }, [files]);

  /**
   * Подписка на webview-события — один раз на каждый webview-инстанс.
   * Вызывается через `ref`-callback, как только Electron создаёт guest.
   */
  const setupWebviewEvents = useCallback((view: TWebview, fileId: string): void => {
    if (eventsSetupRef.current.has(fileId)) return;
    eventsSetupRef.current.add(fileId);

    const dbg = (msg: string): void => {
      window.pyn?.debugLog?.(`pyn-tables:${fileId.slice(0, 8)}`, msg);
    };

    const updateUrlIfActive = (): void => {
      const ui = useUiStateStore.getState();
      if (fileId === ui.activeTableFileId) {
        const url = view.getURL?.();
        if (url) setCurrentUrl(url);
      }
    };

    const onDidStopLoading = async (): Promise<void> => {
      dbg('did-stop-loading url=' + (view.getURL?.() ?? '?'));
      // Жмём маску и ЖДЁМ — она регистрирует window.__pynSwitchSheet и др.
      try {
        await view.executeJavaScript?.(buildSheetsMaskScript());
        dbg('mask injected');
      } catch (e) {
        dbg('mask inject error: ' + String(e).slice(0, 120));
      }
      updateUrlIfActive();
      if (!readyRef.current.has(fileId)) {
        readyRef.current.add(fileId);
        // Лог инспекта DOM сразу после маски — увидим что в DOM (tabs, collapse, etc.)
        try {
          const insp = await view.executeJavaScript?.(SHEETS_INSPECT_SCRIPT);
          dbg('inspect-after-load ' + JSON.stringify(insp));
        } catch (_) {}
        const pending = pendingHashRef.current.get(fileId);
        if (pending !== undefined) {
          pendingHashRef.current.delete(fileId);
          // Найти rawName из текущего state для этого fileId.
          const ui = useUiStateStore.getState();
          let pendingName = '';
          if (ui.activeTableFileId === fileId) {
            pendingName = ui.activeTableTabName ?? '';
          }
          try {
            const diag = await view.executeJavaScript?.(
              buildSwitchSheetScript(pending, pendingName),
            );
            dbg('pending-switch ' + JSON.stringify(diag));
          } catch (_) {}
        }
      }
    };
    const onDidNavigateInPage = (): void => {
      dbg('did-navigate-in-page url=' + (view.getURL?.() ?? '?'));
      updateUrlIfActive();
    };

    // Forward webview console -> main log. Это даёт нам логи нашего
    // sheets-mask скрипта и любые ошибки Google.
    type ConsoleMessageEvt = Event & { level?: number; message?: string };
    const onConsoleMessage = (...args: unknown[]): void => {
      const evt = args[0] as ConsoleMessageEvt | undefined;
      const msg = evt?.message ?? '';
      if (!msg) return;
      // Фильтруем только что-то полезное для диагностики (наши теги + ошибки).
      if (
        msg.indexOf('[pyn:sheets-mask]') !== -1 ||
        msg.indexOf('[pyn:') !== -1 ||
        (evt?.level ?? 0) >= 2 // warning/error
      ) {
        dbg('webview-console: ' + msg.slice(0, 400));
      }
    };

    view.addEventListener('did-stop-loading', onDidStopLoading);
    view.addEventListener('did-navigate-in-page', onDidNavigateInPage);
    view.addEventListener('console-message', onConsoleMessage);
  }, []);

  const refCallback = useCallback(
    (fileId: string) =>
      (el: HTMLElement | null): void => {
        if (!el) {
          webviewRefs.current.delete(fileId);
          return;
        }
        const view = el as TWebview;
        webviewRefs.current.set(fileId, view);
        setupWebviewEvents(view, fileId);
      },
    [setupWebviewEvents],
  );

  // Смена активного листа в той же таблице — эмулируем клик по нативной
  // tab-кнопке Google через window.__pynSwitchSheet(gid). `location.hash`
  // в Electron `<webview>` триггерит full reload, что недопустимо.
  useEffect(() => {
    if (!activeFile || !activeTab) return;
    const view = webviewRefs.current.get(activeFile.id);
    if (!view || !readyRef.current.has(activeFile.id)) {
      pendingHashRef.current.set(activeFile.id, activeTab.gid);
      return;
    }
    view
      .executeJavaScript?.(buildSwitchSheetScript(activeTab.gid, activeTab.rawName))
      .then((diag) => {
        window.pyn?.debugLog?.(
          `pyn-tables:${activeFile.id.slice(0, 8)}`,
          'switch gid=' + activeTab.gid + ' diag=' + JSON.stringify(diag),
        );
      })
      .catch(() => {});
    const url = view.getURL?.();
    if (url) setCurrentUrl(url);
  }, [activeFile, activeTab]);

  // Presence-тикер — на active webview каждые 5 сек.
  useEffect(() => {
    if (!activeFile) {
      setPresence([]);
      return;
    }
    const fileId = activeFile.id;
    const tick = (): void => {
      const view = webviewRefs.current.get(fileId);
      if (!view || !view.executeJavaScript) return;
      view
        .executeJavaScript(SHEETS_PRESENCE_SCRIPT)
        .then((result) => {
          if (Array.isArray(result)) setPresence(result as PresenceMember[]);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [activeFile]);

  const reload = (): void => {
    if (!activeFile) return;
    webviewRefs.current.get(activeFile.id)?.reload?.();
  };

  const clickGoogleMenuPath = useCallback(
    (path: readonly string[]): void => {
      if (!activeFile) return;
      const view = webviewRefs.current.get(activeFile.id);
      view?.executeJavaScript?.(buildClickMenuPathScript(path)).catch(() => {});
    },
    [activeFile],
  );

  const extractGoogleMenu = useCallback(
    async (path: readonly string[]): Promise<GoogleMenuItem[]> => {
      if (!activeFile) return [];
      const view = webviewRefs.current.get(activeFile.id);
      if (!view?.executeJavaScript) return [];
      try {
        const result = await view.executeJavaScript(buildExtractMenuScript(path));
        const items = Array.isArray(result) ? (result as GoogleMenuItem[]) : [];
        window.pyn?.debugLog?.(
          `pyn-tables:${activeFile.id.slice(0, 8)}`,
          'extract path=' + JSON.stringify(path) + ' count=' + items.length +
            ' first=' + (items[0]?.label ?? '-'),
        );
        return items;
      } catch (e) {
        window.pyn?.debugLog?.(
          `pyn-tables:${activeFile.id.slice(0, 8)}`,
          'extract ERROR ' + String(e).slice(0, 120),
        );
        return [];
      }
    },
    [activeFile],
  );

  const showToast = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const loggedIn = currentUrl.startsWith('https://docs.google.com/spreadsheets');
  const actions: TableAction[] = activeTab?.actions ?? [];

  const [pendingPwAction, setPendingPwAction] = useState<TableAction | null>(null);

  /**
   * Запуск action'а — путь скрипта (macroId === null). Macro-path требует
   * VBS на Windows и пока не реализован.
   *  1. Оптимистичный acquire lock.
   *  2. `run_script` на сервере (он сам делает WS broadcast).
   *  3. Если `hasStatusUrl` — polling `check_sheet_action_status` до alive=false
   *     или таймаут (180 × 2 сек = 6 мин).
   *  4. Reload active webview — Google пересчитает grid после изменений.
   *  5. Release lock (только если actionId совпадает, server WS обычно
   *     уже снял).
   */
  const runScriptAction = useCallback(
    async (action: TableAction, password?: string): Promise<void> => {
      if (!activeFile || !activeTab) return;
      const tabName = activeTab.rawName;
      const lockedTabs = action.locksTabs && action.locksTabs.length > 0
        ? action.locksTabs
        : [tabName];

      useSheetsLockStore.getState().acquire({
        actionId: action.id,
        actionLabel: action.label,
        userName: currentUserName,
        tabName,
        lockedTabRawNames: lockedTabs,
      });

      try {
        const result = await runScript(api, {
          actionId: action.id,
          actionLabel: action.label,
          tabName,
          userName: currentUserName,
          lockedTabs,
          password,
        });
        if (!result.ok) {
          if (result.error === 'wrong_password') {
            showToast('Неверный пароль');
          } else {
            showToast(`Ошибка: ${result.error ?? 'unknown'}`);
          }
          return;
        }

        if (action.hasStatusUrl) {
          const POLL_INTERVAL = 2000;
          const MAX_ATTEMPTS = 180;
          for (let i = 0; i < MAX_ATTEMPTS; i++) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            const status = await checkSheetActionStatus(api, action.id).catch(
              () => ({ alive: false } as const),
            );
            if (!status.alive) break;
          }
        }

        // Перезагрузка active webview — Google'е grid обновится.
        webviewRefs.current.get(activeFile.id)?.reload?.();
        showToast(`«${action.label}» — готово`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Ошибка: ${msg.slice(0, 80)}`);
      } finally {
        useSheetsLockStore.getState().release(action.id);
      }
    },
    [activeFile, activeTab, currentUserName, showToast],
  );

  /**
   * SAP-макрос (action.macroId !== null). Pipeline:
   *  1. Optimistic acquire lock.
   *  2. get_macro_bundle → server отдаёт VBS-source + macro_token.
   *  3. main process пишет VBS, spawn'ит cscript, читает TSV-output.
   *  4. submit_macro_data → server пишет TSV в Sheets API и (опц.) запускает
   *     Apps Script processor.
   *  5. Если есть statusUrl — polling до alive=false.
   *  6. Reload webview, release lock.
   *
   * Windows-only — cscript отсутствует на Mac/iOS/Android.
   */
  const runMacroAction = useCallback(
    async (action: TableAction, password?: string): Promise<void> => {
      if (!activeFile || !activeTab) return;
      const platform = window.pyn?.platform;
      if (platform !== 'win32') {
        showToast('SAP-макросы доступны только в Windows-версии');
        return;
      }
      const tabName = activeTab.rawName;
      const lockedTabs = action.locksTabs && action.locksTabs.length > 0
        ? action.locksTabs
        : [tabName];

      useSheetsLockStore.getState().acquire({
        actionId: action.id,
        actionLabel: action.label,
        userName: currentUserName,
        tabName,
        lockedTabRawNames: lockedTabs,
      });

      try {
        const bundle = await getMacroBundle(api, {
          actionId: action.id,
          password,
        });
        if (!bundle.ok) {
          if (bundle.error === 'wrong_password') showToast('Неверный пароль');
          else showToast(`Не получили VBS: ${bundle.error}`);
          return;
        }

        const vbsRun = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource);
        if (!vbsRun || !vbsRun.ok || !vbsRun.tsv) {
          showToast(`VBS не отработал: ${vbsRun?.error ?? 'unknown'}`);
          return;
        }

        const submit = await submitMacroData(api, {
          macroToken: bundle.bundle.macroToken,
          data: vbsRun.tsv,
          actionId: action.id,
        });
        if (!submit.ok) {
          showToast(`Сервер отверг данные: ${submit.error ?? 'unknown'}`);
          return;
        }

        if (action.hasStatusUrl) {
          const POLL_INTERVAL = 2000;
          const MAX_ATTEMPTS = 180;
          for (let i = 0; i < MAX_ATTEMPTS; i++) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            const status = await checkSheetActionStatus(api, action.id).catch(
              () => ({ alive: false } as const),
            );
            if (!status.alive) break;
          }
        }

        webviewRefs.current.get(activeFile.id)?.reload?.();
        showToast(
          `«${action.label}» — готово (строк: ${submit.rowsInserted ?? '?'})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Ошибка: ${msg.slice(0, 80)}`);
      } finally {
        useSheetsLockStore.getState().release(action.id);
      }
    },
    [activeFile, activeTab, currentUserName, showToast],
  );

  const handleAction = (action: TableAction): void => {
    if (!loggedIn) {
      showToast('Войдите в Google чтобы запускать скрипты');
      return;
    }
    if (action.requiresPassword) {
      setPendingPwAction(action);
      return;
    }
    if (action.macroId) void runMacroAction(action);
    else void runScriptAction(action);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <header
        className={cn(
          'drag-region relative flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3',
          'bg-bg-surface',
        )}
      >
        <span className="no-drag-region truncate text-[13.5px] font-semibold tracking-[-0.005em] text-text-strong">
          {activeTab ? customTabName(activeTab.displayName || activeTab.rawName) : 'Таблицы'}
        </span>

        <div className="no-drag-region ml-auto flex items-center gap-1.5">
          {activeTab && (
            <EditDropdown
              disabled
              extractMenu={extractGoogleMenu}
              onPick={clickGoogleMenuPath}
            />
          )}
          {actions.length > 0 && (
            <ScriptsDropdown actions={actions} disabled={!loggedIn} onPick={handleAction} />
          )}
          {activeFile && <PresencePill members={presence} loggedIn={loggedIn} />}
          {activeFile && (
            <button
              type="button"
              onClick={reload}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md',
                'text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong',
              )}
              aria-label="Перезагрузить"
              title="Перезагрузить"
            >
              <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {error && (
          <button
            type="button"
            onClick={() => void refresh()}
            className="no-drag-region text-[12px] text-text-muted hover:text-text-strong"
          >
            {error} — повторить
          </button>
        )}
      </header>

      <section className="relative flex flex-1 flex-col overflow-hidden bg-bg-deep">
        {activatedFileIds.length === 0 && (
          <EmptyHint
            title="Выберите таблицу"
            body="В левой панели — список Google-таблиц. Наведите курсор на таблицу, чтобы увидеть вкладки."
          />
        )}
        {activatedFileIds.map((fileId) => {
          const file = files.find((f) => f.id === fileId);
          if (!file) return null;
          const isActive = fileId === activeFileId;
          // Initial gid — первая видимая вкладка. Дальше переключение
          // листов идёт императивно через executeJavaScript hash.
          const initialTab = file.tabs.find((t) => !t.hidden);
          const initialUrl = initialTab
            ? `https://docs.google.com/spreadsheets/d/${file.id}/edit#gid=${initialTab.gid}`
            : `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
          return (
            <webview
              key={fileId}
              ref={refCallback(fileId)}
              src={initialUrl}
              partition={SHEETS_PARTITION}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              allowpopups
              style={{
                position: 'absolute',
                inset: 0,
                display: 'inline-flex',
                width: '100%',
                height: '100%',
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none',
                zIndex: isActive ? 2 : 1,
                backgroundColor: '#161611',
              }}
            />
          );
        })}
        {activeLock &&
          activeTab &&
          activeLock.lockedTabRawNames.includes(activeTab.rawName) && (
            <SheetsLockOverlay lock={activeLock} />
          )}
        <SheetsPasswordPrompt
          open={pendingPwAction !== null}
          actionLabel={pendingPwAction?.label ?? ''}
          onSubmit={(pw) => {
            const a = pendingPwAction;
            setPendingPwAction(null);
            if (!a) return;
            if (a.macroId) void runMacroAction(a, pw);
            else void runScriptAction(a, pw);
          }}
          onCancel={() => setPendingPwAction(null)}
        />
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2',
              'rounded-full border border-border-default bg-bg-elevated/95 px-3.5 py-1.5',
              'text-[12px] text-text-strong shadow-lg backdrop-blur-sm',
            )}
          >
            {toast}
          </div>
        )}
      </section>
    </main>
  );
}

interface GoogleMenuItem {
  label: string;
  hasSubmenu: boolean;
}

const EDIT_PARENTS = ['Правка', 'Вставка', 'Данные'] as const;

/**
 * Dropdown «Редактирование» — N-уровневое кастомное меню. Каждый уровень
 * рендерится нашим компонентом `MenuColumn` (Linear-style). При hover на
 * пункт с `hasSubmenu === true` — запрашиваем содержимое подменю у Google
 * через `extractMenu(path)` и рендерим следующий уровень справа.
 * Google'е popup-ы скрыты CSS-классом `pyn-menu-extracting` во время
 * extraction'a — юзер их не видит.
 *
 * Клик на leaf-пункт → `onPick(path)` → `__pynClickMenuPath` → Google
 * выполняет действие. UI закрывается, popup'ы Google не мелькают.
 */
function EditDropdown({
  disabled,
  extractMenu,
  onPick,
}: {
  disabled: boolean;
  extractMenu: (path: readonly string[]) => Promise<GoogleMenuItem[]>;
  onPick: (path: readonly string[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // root-items это статичный список {label, hasSubmenu:true} — у каждого
  // top-level пункта однозначно есть submenu (это и есть наше меню).
  const rootItems: GoogleMenuItem[] = EDIT_PARENTS.map((label) => ({
    label,
    hasSubmenu: true,
  }));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium',
            'outline-none transition-colors',
            disabled
              ? 'cursor-not-allowed text-text-muted opacity-60'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          Редактирование
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <MenuColumn
            items={rootItems}
            path={[]}
            width={44 * 4}
            extractMenu={extractMenu}
            onPickLeaf={(path) => {
              onPick(path);
              close();
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Один уровень меню. Hover на пункт с submenu → загружает дочерние
 * через `extractMenu(path + [item])` и рендерит next-level колонку
 * справа (рекурсивно). Все колонки прижаты вплотную без gap'a — мышь
 * не теряется при переходе между уровнями.
 */
function MenuColumn({
  items,
  path,
  width,
  extractMenu,
  onPickLeaf,
}: {
  items: readonly GoogleMenuItem[];
  path: readonly string[];
  width: number;
  extractMenu: (path: readonly string[]) => Promise<GoogleMenuItem[]>;
  onPickLeaf: (path: readonly string[]) => void;
}): JSX.Element {
  const [hovered, setHovered] = useState<string | null>(null);
  const [childItems, setChildItems] = useState<GoogleMenuItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hovered) {
      setChildItems(null);
      return;
    }
    const item = items.find((i) => i.label === hovered);
    if (!item || !item.hasSubmenu) {
      setChildItems(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    extractMenu([...path, hovered]).then((children) => {
      if (cancelled) return;
      setChildItems(children);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hovered, items, path, extractMenu]);

  return (
    <div
      className={cn(
        'relative flex max-h-[460px] flex-col gap-0.5 overflow-y-auto overflow-x-visible',
        'rounded-lg border border-border-default bg-bg-elevated p-1 shadow-xl',
      )}
      style={{ width }}
    >
      {items.map((it) => {
        const isHovered = hovered === it.label;
        return (
          <button
            key={it.label}
            type="button"
            onMouseEnter={() => setHovered(it.label)}
            onClick={() => {
              if (!it.hasSubmenu) onPickLeaf([...path, it.label]);
            }}
            className={cn(
              'flex h-8 items-center justify-between rounded-md px-2 text-left text-[12.5px]',
              'text-text-secondary outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
              isHovered && 'bg-bg-hover text-text-strong',
            )}
          >
            <span className="flex-1 truncate">{it.label}</span>
            {it.hasSubmenu && (
              <span className="ml-2 text-text-muted">›</span>
            )}
          </button>
        );
      })}
      {hovered && items.find((i) => i.label === hovered)?.hasSubmenu && (
        <div
          className="absolute top-0 z-10"
          style={{ left: '100%' }}
        >
          {loading && !childItems && (
            <div
              className="rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-[12px] italic text-text-muted shadow-xl"
            >
              Загрузка…
            </div>
          )}
          {childItems && (
            <MenuColumn
              items={childItems}
              path={[...path, hovered]}
              width={Math.max(width, 240)}
              extractMenu={extractMenu}
              onPickLeaf={onPickLeaf}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ScriptsDropdown({
  actions,
  disabled,
  onPick,
}: {
  actions: TableAction[];
  disabled: boolean;
  onPick: (a: TableAction) => void;
}): JSX.Element {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium',
            'outline-none transition-colors',
            disabled
              ? 'cursor-not-allowed text-text-muted opacity-60'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          Скрипты
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            'z-50 flex w-60 flex-col gap-0.5 rounded-lg border border-border-default',
            'bg-bg-elevated p-1 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {actions.map((a) => (
            <Popover.Close key={a.id} asChild>
              <button
                type="button"
                onClick={() => onPick(a)}
                className={cn(
                  'flex h-8 items-center rounded-md px-2 text-left text-[12.5px]',
                  'text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <span className="truncate">{customActionLabel(a.label)}</span>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}


function PresencePill({
  members,
  loggedIn,
}: {
  members: PresenceMember[];
  loggedIn: boolean;
}): JSX.Element | null {
  if (!loggedIn) return null;
  if (members.length === 0) {
    return (
      <span className="rounded-md border border-border-subtle px-2 py-0.5 text-[11px] text-text-muted">
        Только вы
      </span>
    );
  }
  const anonCount = members.filter((m) => m.anonymous).length;
  const namedCount = members.length - anonCount;
  const tooltip = members.map((m) => m.name).join('\n');
  return (
    <span
      title={tooltip}
      className={cn(
        'flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
        anonCount > 0 && namedCount === 0
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
          : 'border-presence-online/30 bg-presence-online/10 text-presence-online',
      )}
    >
      <span>+{members.length}</span>
      <span className="text-text-muted">
        {namedCount > 0 && `${namedCount} ` + plural(namedCount, 'юзер', 'юзера', 'юзеров')}
        {namedCount > 0 && anonCount > 0 && ', '}
        {anonCount > 0 && `${anonCount} ` + plural(anonCount, 'аноним', 'анонима', 'анонимов')}
      </span>
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function EmptyHint({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex max-w-[420px] flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-hover">
          <Chrome className="h-6 w-6 text-text-muted" strokeWidth={1.5} />
        </div>
        <h2 className="mt-2 text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
          {title}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-text-muted">{body}</p>
      </div>
    </div>
  );
}
