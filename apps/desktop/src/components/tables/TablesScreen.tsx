import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Chrome, RefreshCcw } from 'lucide-react';
import {
  checkSheetActionStatus,
  getMacroBundle,
  getSheetStats,
  releaseSheetLock,
  runScript,
  submitMacroData,
  useSheetsLockStore,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUiStateStore } from '@/lib/stores';
import { useGoogleAuthStatus } from '@/lib/use-google-auth';
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
  buildSheetsMaskScript,
  buildSwitchSheetScript,
} from './sheets-mask';
import { getFvid, setFvid } from '@/lib/filter-fvid-cache';
import { SHEETS_PRESENCE_SCRIPT, type PresenceMember } from './sheets-presence';
import { SheetsLockOverlay } from './SheetsLockOverlay';
import { SheetsPasswordPrompt } from './SheetsPasswordPrompt';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { PynLoader } from '@/components/ui/PynLoader';
import { SheetsConfirmPrompt } from './SheetsConfirmPrompt';

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
  loadURL?: (url: string) => void;
  openDevTools?: (opts?: { mode?: string }) => void;
  addEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener: (e: string, cb: (...args: unknown[]) => void) => void;
};

export function TablesScreen({
  currentUserName,
  currentUserLogin,
}: {
  currentUserName: string;
  /** §pyn-1.2.43 — login для sheet_lock_acquired broadcast (avatar/presence lookup). */
  currentUserLogin: string;
}): JSX.Element {
  const { t } = useTranslation();
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
  // §v1.2.14 — открытый Pyn-popover (Фильтр / Скрипты). Radix перехватывает
  // outside click в renderer, но клик в webview-зоне (другой document) до
  // нас не доходит → popover висит. Поэтому когда popover открыт, рендерим
  // `<div>` поверх webview (z-30) — он перехватывает mousedown и закрывает.
  const [openPopover, setOpenPopover] = useState<'filter' | 'scripts' | 'check' | null>(null);

  /**
   * §v1.2.14 — Menubar-style hover navigation. Если уже какой-то popover
   * открыт, hover по соседней кнопке переключает на её popover (или
   * закрывает, если у кнопки нет popover'a). Юзер кликает один раз и
   * дальше водит курсором по header — как в нативном menubar Mac/Win.
   */
  const handleTriggerHover = useCallback(
    (target: 'filter' | 'scripts' | 'check' | null): void => {
      setOpenPopover((current) => {
        if (current === null) return null; // no session started
        if (current === target) return current;
        return target;
      });
    },
    [],
  );

  // §v1.2.14 — реактивный набор fileId-ов, у которых маска уже инжектнулась
  // и таблица отрендерена. До этого момента поверх webview лежит dark overlay
  // «Загрузка таблицы…» — юзер не видит raw Google UI с menubar'ом и не видит
  // как у нас на глазах применяется маска. После reload (Google login) набор
  // очищается → overlay снова появляется → did-stop-loading → set → overlay
  // убирается.
  const [readyFileIds, setReadyFileIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const webviewRefs = useRef<Map<string, TWebview>>(new Map());
  const eventsSetupRef = useRef<Set<string>>(new Set());
  const readyRef = useRef<Set<string>>(new Set());
  const pendingHashRef = useRef<Map<string, number>>(new Map());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §v1.2.14 — URL per fileId на последнем did-stop-loading. Google
  // повторно эмитит did-stop-loading с тем же URL (fetch'и, refresh state)
  // — на таких событиях мы НЕ пере-инжектим маску и не сбрасываем blur,
  // чтобы юзер не видел "применение маски на пустом месте".
  const lastUrlRef = useRef<Map<string, string>>(new Map());

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
      const currentUrl = view.getURL?.() ?? '';
      const wasReady = readyRef.current.has(fileId);
      dbg('did-stop-loading url=' + currentUrl);
      // §pyn-1.2.20 — ВСЕГДА re-inject mask на каждом did-stop-loading.
      // Раньше был skip когда wasReady && URL same — но Google revert
      // версии в Sheets UI и webview.reload() после макроса делают full
      // DOM reset на том же URL → наш `<style id="pyn-sheets-mask">`
      // уничтожается → маска слетает → юзер видел raw Google UI с
      // menubar/toolbar/etc. Юзер: «слетает маска и не возвращается».
      //
      // Скрипт инжекта идемпотентен (гейт `window.__pynMaskBootstrapped` +
      // наличие `<style id=STYLE_ID>` внутри самого скрипта). Поэтому безопасно
      // вызывать на ЛЮБОМ did-stop-loading: если DOM жив и бутстрап был —
      // no-op (без повторного tryCollapse/спама); если DOM перерисован (style
      // исчез) — восстановит стиль и прогонит бутстрап заново. Overhead minimal.
      lastUrlRef.current.set(fileId, currentUrl);
      try {
        await view.executeJavaScript?.(buildSheetsMaskScript());
        dbg('mask ensured');
      } catch (e) {
        dbg('mask inject error: ' + String(e).slice(0, 120));
      }
      updateUrlIfActive();
      readyRef.current.add(fileId);
      setReadyFileIds((prev) => {
        if (prev.has(fileId)) return prev;
        const next = new Set(prev);
        next.add(fileId);
        return next;
      });
      if (!wasReady) {
        try {
          const insp = await view.executeJavaScript?.(SHEETS_INSPECT_SCRIPT);
          dbg('inspect-after-load ' + JSON.stringify(insp));
        } catch (_) {}
        const pending = pendingHashRef.current.get(fileId);
        if (pending !== undefined) {
          pendingHashRef.current.delete(fileId);
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

  // §v1.2.14 — после успешного Google login reload'им все webview'ы. Иначе
  // они держат старые logged-out cookies и таблицы рендерятся с «войдите в
  // аккаунт» баннером несмотря на то что cookies уже скопированы в persist
  // partition. Event dispatch'ится из GoogleAccountPanel.onLogin.
  useEffect(() => {
    const handler = (): void => {
      readyRef.current.clear();
      setReadyFileIds(new Set());
      for (const [, view] of webviewRefs.current) {
        view.reload?.();
      }
    };
    window.addEventListener('pyn:google-login-success', handler);
    return () => window.removeEventListener('pyn:google-login-success', handler);
  }, []);

  // §bridge — после включения моста (корп-прокси) перезагружаем webview'ы через
  // loadURL: они могли стартануть до применения PAC и застрять на chrome-error
  // (reload() там бесполезен — перезагрузил бы сам chrome-error, а не таблицу).
  useEffect(() => {
    const handler = (): void => {
      readyRef.current.clear();
      setReadyFileIds(new Set());
      for (const f of files) {
        const view = webviewRefs.current.get(f.id);
        if (!view?.loadURL) continue;
        const initialTab = f.tabs.find((tab) => !tab.hidden);
        const u = initialTab
          ? `https://docs.google.com/spreadsheets/d/${f.id}/edit#gid=${initialTab.gid}`
          : `https://docs.google.com/spreadsheets/d/${f.id}/edit`;
        try {
          view.loadURL(u);
        } catch {
          /* webview ещё не attached — пропускаем */
        }
      }
    };
    window.addEventListener('pyn:bridge-ready', handler);
    return () => window.removeEventListener('pyn:bridge-ready', handler);
  }, [files]);

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
      // §2026-05-21 — executeJavaScript бросает SYNC throw "WebView must be
      // attached to the DOM" когда guest ещё не готов (только что mounted или
      // unmounted). Promise.catch такие throw не ловит — попадают в window.
      // onerror и засоряют логи. Оборачиваем sync вызов в try.
      try {
        const promise = view.executeJavaScript(SHEETS_PRESENCE_SCRIPT);
        if (promise && typeof (promise as Promise<unknown>).then === 'function') {
          (promise as Promise<unknown>)
            .then((result) => {
              if (Array.isArray(result)) setPresence(result as PresenceMember[]);
            })
            .catch(() => {});
        }
      } catch {
        // Webview ещё не attached — пропускаем тик, следующий через 5с попробует.
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [activeFile]);

  const reload = (): void => {
    if (!activeFile) return;
    const fileId = activeFile.id;
    // §v1.2.14 — при ручном reload сбрасываем ready-флаг, чтобы blur
    // overlay снова появился. После did-stop-loading + mask injected →
    // setReadyFileIds(add) → overlay fade-out плавно. Юзер не видит
    // как Google перерисовывает grid и как мы прикладываем маску.
    readyRef.current.delete(fileId);
    setReadyFileIds((prev) => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
    webviewRefs.current.get(fileId)?.reload?.();
  };

  const clickGoogleMenuPath = useCallback(
    (path: readonly string[]): void => {
      if (!activeFile) return;
      const view = webviewRefs.current.get(activeFile.id);
      if (!view?.executeJavaScript) return;
      const fileIdShort = activeFile.id.slice(0, 8);
      view.executeJavaScript(buildClickMenuPathScript(path))
        .then((r) => {
          window.pyn?.debugLog?.(
            `pyn-tables:${fileIdShort}`,
            'menu-click ' + JSON.stringify(path) + ' = ' + JSON.stringify(r),
          );
        })
        .catch(() => {});
    },
    [activeFile],
  );

  /**
   * Отправить keyboard shortcut в webview. Используется для Cmd+P (Печать) —
   * Google открывает свой print dialog без открытия меню.
   */
  const sendKeyboardShortcut = useCallback(
    (key: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }): void => {
      if (!activeFile) return;
      const view = webviewRefs.current.get(activeFile.id);
      if (!view?.executeJavaScript) return;
      const code = JSON.stringify({
        key,
        ctrl: modifiers.ctrl ?? false,
        alt: modifiers.alt ?? false,
        shift: modifiers.shift ?? false,
        meta: modifiers.meta ?? false,
      });
      const script =
        '(function(){var m=' + code + ';' +
        'var ev=function(t){return new KeyboardEvent(t,{key:m.key,code:"Key"+m.key.toUpperCase(),keyCode:m.key.toUpperCase().charCodeAt(0),which:m.key.toUpperCase().charCodeAt(0),ctrlKey:m.ctrl,altKey:m.alt,shiftKey:m.shift,metaKey:m.meta,bubbles:true,cancelable:true})};' +
        'var t=document.activeElement||document.body;' +
        't.dispatchEvent(ev("keydown"));t.dispatchEvent(ev("keypress"));t.dispatchEvent(ev("keyup"));' +
        'return "sent:"+m.key})()';
      view.executeJavaScript(script).catch(() => {});
    },
    [activeFile],
  );

  const isMac = window.pyn?.platform === 'darwin';

  const openPrintDialog = useCallback((): void => {
    // Cmd+P (Mac) / Ctrl+P (Win) — direct hotkey Google'а для печати.
    sendKeyboardShortcut('p', { meta: isMac, ctrl: !isMac });
  }, [sendKeyboardShortcut, isMac]);

  /**
   * Извлечь список сохранённых Filter Views для текущего листа.
   * Путь в RU UI Google'а: `Данные › Изменить фильтр`. Submenu содержит
   * названия filter view'ов; служебные пункты («Создать новый фильтр» и т.п.)
   * Google возвращает в том же list — фильтруем их по эвристике (пунктам
   * с эмодзи/глаголами действия они не маркируются, поэтому считаем
   * filter view'ом всё, что не совпадает по началу с известными action'ами).
   */
  const loadFilterViews = useCallback(async (): Promise<string[]> => {
    if (!activeFile) return [];
    const view = webviewRefs.current.get(activeFile.id);
    if (!view?.executeJavaScript) return [];
    const fileIdShort = activeFile.id.slice(0, 8);
    // §v1.2.14 — Только через toolbar-кнопку «Режимы фильтрации». Cache
    // и menubar-fallback убраны — раньше показывали дубли (stale-cache
    // entries поверх actual toolbar list). Один источник правды — Google.
    try {
      const res = await view.executeJavaScript(
        '(typeof window.__pynExtractFilterViews === "function" ? ' +
        'window.__pynExtractFilterViews() : null)',
      );
      const arr = Array.isArray(res) ? (res as string[]) : [];
      window.pyn?.debugLog?.(
        `pyn-tables:${fileIdShort}`,
        'filter-views via toolbar ' + arr.length +
          (arr.length > 0 ? ' = ' + arr.join(' | ') : ''),
      );
      return arr;
    } catch (e) {
      window.pyn?.debugLog?.(
        `pyn-tables:${fileIdShort}`,
        'toolbar-extract error: ' + String(e).slice(0, 120),
      );
      return [];
    }
  }, [activeFile]);

  /**
   * Применить filter view. Если fvid сохранён в кэше — мгновенно через
   * `window.location.hash = "gid=X&fvid=Y"` (Google перехватит hashchange
   * и активирует view без открытия menu). Если fvid'a нет — fallback через
   * `__pynClickMenuPath` (мерцание menu один раз), после resolved читаем
   * актуальный hash и сохраняем fvid для следующих применений.
   */
  const applyFilterView = useCallback(
    (label: string): void => {
      if (!activeFile || !activeTab) return;
      const view = webviewRefs.current.get(activeFile.id);
      if (!view?.executeJavaScript) return;
      const fileIdShort = activeFile.id.slice(0, 8);
      const cachedFvid = getFvid(activeFile.id, label);
      if (cachedFvid) {
        const hash = `gid=${activeTab.gid}&fvid=${cachedFvid}`;
        view.executeJavaScript(
          `window.location.hash = ${JSON.stringify(hash)}`,
        ).catch(() => {});
        window.pyn?.debugLog?.(
          `pyn-tables:${fileIdShort}`,
          'apply-filter-instant "' + label + '" fvid=' + cachedFvid,
        );
        return;
      }
      // Fallback: через toolbar-кнопку (один click, popup CSS-скрыт).
      // После apply Google обновит URL hash → читаем fvid → save для
      // следующего instant apply.
      const fileId = activeFile.id;
      view.executeJavaScript(
        '(typeof window.__pynApplyFilterView === "function" ? ' +
        'window.__pynApplyFilterView(' + JSON.stringify(label) + ') : "no-fn")',
      )
        .then(() => {
          setTimeout(async () => {
            try {
              const hash = await view.executeJavaScript?.(
                'window.location.hash',
              );
              const m =
                typeof hash === 'string' ? hash.match(/fvid=(\d+)/) : null;
              if (m && m[1]) {
                setFvid(fileId, label, m[1]);
                window.pyn?.debugLog?.(
                  `pyn-tables:${fileIdShort}`,
                  'apply-filter-saved "' + label + '" fvid=' + m[1],
                );
              }
            } catch {
              /* ignore */
            }
          }, 600);
        })
        .catch(() => {});
    },
    [activeFile, activeTab],
  );

  const showToast = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // §pyn-1.2.43 — authoritative loggedIn из Google account state (main process
  // проверяет partition cookies через window.pyn.google.checkStatus). Раньше
  // был URL-based proxy (currentUrl.startsWith) — ненадёжно при истёкших
  // cookies или logout через Settings без reload webview.
  const { loggedIn } = useGoogleAuthStatus();
  const actions: TableAction[] = activeTab?.actions ?? [];

  const [pendingPwAction, setPendingPwAction] = useState<TableAction | null>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<TableAction | null>(null);

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
        userLogin: currentUserLogin,
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
            showToast(t('tables.toast_wrong_password'));
          } else {
            showToast(t('tables.toast_error', { message: result.error ?? 'unknown' }));
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
        showToast(t('tables.toast_action_done', { action: action.label }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('tables.toast_error', { message: msg.slice(0, 80) }));
      } finally {
        // §pyn-1.2.20 — server-side broadcast `sheet_lock_released` (раньше
        // server делал это сразу после Apps Script dispatch → маска
        // снималась через 5 сек у всех клиентов). Теперь release делает
        // initiator после polling alive=false.
        await releaseSheetLock(api, action.id).catch(() => undefined);
        useSheetsLockStore.getState().release(action.id);
      }
    },
    [activeFile, activeTab, currentUserName, showToast, t],
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
        showToast(t('tables.toast_macro_mac'));
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
        userLogin: currentUserLogin,
        tabName,
        lockedTabRawNames: lockedTabs,
      });

      try {
        const bundle = await getMacroBundle(api, {
          actionId: action.id,
          password,
          // §pyn-1.2.20 — server теперь broadcastит sheet_lock_acquired при
          // выдаче bundle, чтобы и другие клиенты видели маску при macro.
          // Передаём labels/names для содержательного отображения у них.
          tabName,
          actionLabel: action.label,
          userName: currentUserName,
        });
        if (!bundle.ok) {
          if (bundle.error === 'wrong_password') showToast(t('tables.toast_wrong_password'));
          else showToast(t('tables.toast_no_vbs', { error: bundle.error }));
          return;
        }

        const vbsRun = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource);
        if (!vbsRun || !vbsRun.ok || !vbsRun.tsv) {
          showToast(t('tables.toast_vbs_failed', { error: vbsRun?.error ?? 'unknown' }));
          return;
        }

        const submit = await submitMacroData(api, {
          macroToken: bundle.bundle.macroToken,
          data: vbsRun.tsv,
          actionId: action.id,
        });
        if (!submit.ok) {
          showToast(t('tables.toast_submit_rejected', { error: submit.error ?? 'unknown' }));
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
          t('tables.toast_action_done_rows', {
            action: action.label,
            count: submit.rowsInserted ?? '?',
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('tables.toast_error', { message: msg.slice(0, 80) }));
      } finally {
        // §pyn-1.2.20 — release всех клиентов через server WS broadcast.
        // Symmetric с acquired broadcast в handleGetMacroBundle.
        await releaseSheetLock(api, action.id).catch(() => undefined);
        useSheetsLockStore.getState().release(action.id);
      }
    },
    [activeFile, activeTab, currentUserName, showToast, t],
  );

  const handleAction = (action: TableAction): void => {
    if (!loggedIn) {
      showToast(t('tables.toast_need_google_login'));
      return;
    }
    if (action.requiresPassword) {
      setPendingPwAction(action);
      return;
    }
    // Скрипты без пароля — confirm dialog (юзер: «выплывает окно Запустить скрипт?»).
    setPendingConfirmAction(action);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <header className="drag-region relative flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region truncate text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {activeTab ? customTabName(activeTab.displayName || activeTab.rawName) : t('tables.title_default')}
        </span>

        <div
          className="no-drag-region ml-auto flex items-center gap-1.5"
          onMouseOver={(e) => {
            // §v1.2.14 — Menubar-style: event delegation на parent. Radix
            // asChild перехватывает onPointerEnter на Popover.Trigger,
            // поэтому ловим mouseover bubbling здесь по data-pyn-trigger
            // атрибуту. Если есть открытый popover — переключаем на тот
            // что под курсором (или закрываем если кнопка без popover'а).
            if (!openPopover) return;
            const t = e.target as HTMLElement;
            const btn = t.closest('[data-pyn-trigger]') as HTMLElement | null;
            if (!btn) return;
            const target = btn.getAttribute('data-pyn-trigger');
            if (target === 'filter' || target === 'scripts' || target === 'check') {
              handleTriggerHover(target);
            } else {
              handleTriggerHover(null);
            }
          }}
        >
          {activeTab && activeTab.rawName.toLowerCase() === 'workflow' && (
            <div data-pyn-trigger="filter">
              <FilterDropdown
                disabled={!loggedIn}
                open={openPopover === 'filter'}
                onOpenChange={(o) =>
                  setOpenPopover((curr) => {
                    if (o) return 'filter';
                    return curr === 'filter' ? null : curr;
                  })
                }
                loadFilterViews={loadFilterViews}
                onApply={applyFilterView}
              />
            </div>
          )}
          {activeFile?.statsUrl &&
            activeTab &&
            (activeTab.rawName === 'workflow' || activeTab.rawName === 'wf_plan') && (
              <div data-pyn-trigger="check">
                <CheckDropdown
                  disabled={!loggedIn}
                  open={openPopover === 'check'}
                  onOpenChange={(o) =>
                    setOpenPopover((curr) => {
                      if (o) return 'check';
                      return curr === 'check' ? null : curr;
                    })
                  }
                  fileId={activeFile.id}
                />
              </div>
            )}
          {activeTab && (
            <button
              type="button"
              data-pyn-trigger="none"
              disabled={!loggedIn}
              onClick={openPrintDialog}
              className={cn(
                'flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium',
                'outline-none transition-colors',
                !loggedIn
                  ? 'cursor-not-allowed text-text-muted opacity-60'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              {t('tables.btn_print')}
            </button>
          )}
          {actions.length > 0 && (
            <div data-pyn-trigger="scripts">
              <ScriptsDropdown
                actions={actions}
                disabled={!loggedIn}
                open={openPopover === 'scripts'}
                onOpenChange={(o) =>
                  setOpenPopover((curr) => {
                    if (o) return 'scripts';
                    return curr === 'scripts' ? null : curr;
                  })
                }
                onPick={handleAction}
              />
            </div>
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
              aria-label={t('tables.reload')}
              title={t('tables.reload')}
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
            {error}
          </button>
        )}
      </header>

      <WorkspaceCard>
        <section className="relative flex flex-1 flex-col overflow-hidden bg-bg-deep">
          {activatedFileIds.length === 0 && (
            <EmptyHint
              title={t('tables.empty_title')}
              body={t('tables.empty_subtitle')}
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
            // §v1.2.14 — webview visibility управляется ИМПЕРАТИВНО через
            // ref в onDidStartLoading/onDidStopLoading. React state binding
            // создавал async gap: Google уже paint'нул UI ДО того как React
            // успел re-render с visibility:hidden. Imperative style.visibility
            // через DOM API применяется синхронно в том же tick'е.
            return (
              <webview
                key={fileId}
                ref={refCallback(fileId)}
                src={initialUrl}
                partition={SHEETS_PARTITION}
                allowpopups
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'inline-flex',
                  width: '100%',
                  height: '100%',
                  pointerEvents: isActive ? 'auto' : 'none',
                  zIndex: isActive ? 2 : 1,
                  backgroundColor: '#161611',
                }}
              />
            );
          })}
          {openPopover && (
            // §v1.2.14 — overlay поверх webview когда Pyn-popover открыт.
            // mousedown закрывает popover. Radix не получает outside-click из
            // webview-document, поэтому ловим click в renderer слое сами.
            <div
              aria-hidden
              className="absolute inset-0 z-30"
              onMouseDown={() => setOpenPopover(null)}
            />
          )}
          {files.length > 0 && (!activeFile || !readyFileIds.has(activeFile.id)) && (
            // §v1.2.14 — Solid loader пока mask не инжектнулась при ПЕРВОЙ
            // загрузке spreadsheet'a (или ручном reload). На subsequent
            // navigations (возврат с /revisions, sheet switch) — silent
            // reinject без loader'a, юзер не видит ничего лишнего.
            //
            // §pyn-1.2.50 — overlay активен также пока activeFile ещё не
            // выбран (useEffect выбора default-table занимает один React tick).
            // Без этого юзер видел raw Google UI «секунду» до того как loader
            // успевал смонтироваться.
            <div
              className={cn(
                'absolute inset-0 z-10 flex items-center justify-center',
                'bg-bg-deep',
              )}
            >
              {/* §pyn-1.2.54 — text "Загрузка таблицы…" покрупнее + inline
                  PynLoader sm рядом (полоски сходятся в логотип и расходятся
                  в маленьком невидимом квадрате 16×16). */}
              <div className="flex items-center gap-2.5">
                <span className="text-[15px] font-medium text-text-secondary">
                  {t('tables.loading_overlay')}
                </span>
                <PynLoader size="sm" />
              </div>
            </div>
          )}
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
          <SheetsConfirmPrompt
            open={pendingConfirmAction !== null}
            actionLabel={pendingConfirmAction?.label ?? ''}
            onConfirm={() => {
              const a = pendingConfirmAction;
              setPendingConfirmAction(null);
              if (!a) return;
              if (a.macroId) void runMacroAction(a);
              else void runScriptAction(a);
            }}
            onCancel={() => setPendingConfirmAction(null)}
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
      </WorkspaceCard>
    </main>
  );
}


/**
 * Кнопка «Фильтр» — popup со списком сохранённых Filter Views для текущего
 * листа. Список тянется через programmatic open menu `Данные › Изменить
 * фильтр` (sheets-mask CSS-класс `pyn-menu-extracting` скрывает Google menu
 * на время extract'а). Клик по элементу → `__pynClickMenuPath` сразу
 * применяет filter view, никакого Pyn-overlay'я.
 */
function FilterDropdown({
  disabled,
  open,
  onOpenChange,
  loadFilterViews,
  onApply,
}: {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadFilterViews: () => Promise<string[]>;
  onApply: (label: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [items, setItems] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    loadFilterViews()
      .then((res) => {
        if (cancelled) return;
        setItems(res);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-pyn-trigger="filter"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium',
            'outline-none transition-colors',
            disabled
              ? 'cursor-not-allowed text-text-muted opacity-60'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          {t('tables.btn_filter')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            'z-50 flex max-h-[380px] w-64 flex-col gap-0.5 overflow-y-auto rounded-lg',
            'border border-border-default bg-bg-elevated p-1 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {items === null && (
            <div className="px-2 py-1.5 text-[12px] italic text-text-muted">
              {t('tables.filter_loading')}
            </div>
          )}
          {items && items.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-text-muted">
              {t('tables.filter_empty')}
            </div>
          )}
          {items?.map((label) => (
            <Popover.Close key={label} asChild>
              <button
                type="button"
                onClick={() => onApply(label)}
                className={cn(
                  'flex h-8 items-center rounded-md px-2 text-left text-[12.5px]',
                  'text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <span className="truncate">{label}</span>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * §2026-05-23 — Кнопка «Проверка» (только на табах workflow/wf_plan). Polling'ует
 * standalone Apps Script web app (URL приходит с сервера в `TableFile.statsUrl`)
 * только пока popover открыт. Скрипт отдаёт `{rows, matched, total, mode, v}`;
 * `v` — версия, выставляется onEdit-trigger'ом в скрипте при изменении
 * workflow B:H или wf_plan W:X. Когда `?v=<known>` — сервер мгновенно
 * отвечает `{unchanged:true}` без чтения таблицы (~50ms).
 */
interface CheckPayload {
  rows: string[];
  matched: number;
  total: number;
  mode: 'no_sheets' | 'no_supply' | 'all_ok' | 'missing';
}

const CHECK_POLL_MS = 1200;

function CheckDropdown({
  disabled,
  open,
  onOpenChange,
  fileId,
}: {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<CheckPayload | null>(null);
  const versionRef = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        // §bridge — через CF (get_sheet_stats), не прямой fetch на script.google.com
        // (тот режется корп-прокси). Version-poll сохранён.
        const json = await getSheetStats(api, fileId, versionRef.current || undefined);
        if (cancelled) return;
        if (json.unchanged !== true) {
          if (typeof json.v === 'string') versionRef.current = json.v;
          setPayload({
            rows: Array.isArray(json.rows) ? json.rows : [],
            matched: typeof json.matched === 'number' ? json.matched : 0,
            total: typeof json.total === 'number' ? json.total : 0,
            mode: (json.mode as CheckPayload['mode']) ?? 'no_supply',
          });
        }
      } catch {
        // Сеть/Apps Script упал — silent retry на следующем тике.
      }
      if (!cancelled) {
        timer = setTimeout(() => void tick(), CHECK_POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, fileId]);

  const hasSupply = payload !== null
    && payload.mode !== 'no_supply'
    && payload.mode !== 'no_sheets'
    && payload.total > 0;
  const isOk = hasSupply && payload!.matched === payload!.total;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-pyn-trigger="check"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium',
            'outline-none transition-colors',
            disabled
              ? 'cursor-not-allowed text-text-muted opacity-60'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          {t('tables.btn_check')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            'z-50 flex w-72 flex-col gap-1 rounded-lg p-1',
            'border border-border-default bg-bg-elevated shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {payload === null && (
            <div className="px-2 py-1.5 text-[12px] italic text-text-muted">
              {t('tables.filter_loading')}
            </div>
          )}
          {payload !== null && !hasSupply && (
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400/90" />
              <span className="text-[12.5px] font-medium text-text-secondary">
                {t('tables.check_no_supply')}
              </span>
            </div>
          )}
          {hasSupply && (
            <>
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      isOk ? 'bg-emerald-400/95' : 'bg-rose-400/95',
                    )}
                  />
                  <span className="text-[12.5px] font-semibold text-text-strong">OBD</span>
                </div>
                <span className="text-[12.5px] font-semibold tabular-nums text-text-strong">
                  {payload!.matched} / {payload!.total}
                </span>
              </div>
              {!isOk && payload!.rows.length > 0 && (
                <ul
                  className={cn(
                    'flex max-h-[300px] flex-col gap-0.5 overflow-y-auto rounded-md p-1',
                    'border border-border-subtle/40 bg-bg-deep/40',
                  )}
                >
                  {payload!.rows.map((row, i) => (
                    <li
                      key={i}
                      className="rounded bg-rose-400/5 px-2 py-1 text-[12px] leading-tight text-rose-300/90"
                    >
                      {row}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ScriptsDropdown({
  actions,
  disabled,
  open,
  onOpenChange,
  onPick,
}: {
  actions: TableAction[];
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (a: TableAction) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-pyn-trigger="scripts"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium',
            'outline-none transition-colors',
            disabled
              ? 'cursor-not-allowed text-text-muted opacity-60'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          {t('tables.btn_scripts')}
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
  const { t } = useTranslation();
  if (!loggedIn) return null;
  // §v1.2.14 — раньше при members.length === 0 показывали «Только вы».
  // Юзер: не информативно, убрать. Pill теперь появляется только когда
  // в таблице реально есть другие юзеры (members > 0).
  if (members.length === 0) return null;
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
      <span>{t('tables_presence.overflow', { count: members.length })}</span>
      <span className="text-text-muted">
        {namedCount > 0 && t(`tables_presence.${pluralKey('named', namedCount)}`, { n: namedCount })}
        {namedCount > 0 && anonCount > 0 && ', '}
        {anonCount > 0 && t(`tables_presence.${pluralKey('anon', anonCount)}`, { n: anonCount })}
      </span>
    </span>
  );
}

/**
 * Slavic plural-rule selector — three forms (one/few/many) для tables_presence.
 * EN/DE/ES в JSON используют те же 3 ключа с идентичным переводом, поэтому
 * результат корректен для всех языков.
 */
function pluralKey(prefix: 'named' | 'anon', n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${prefix}_one`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${prefix}_few`;
  return `${prefix}_many`;
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
