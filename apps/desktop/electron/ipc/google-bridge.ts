import { app, BrowserWindow, ipcMain, session } from 'electron';

/**
 * Google account flow для embedded Sheets (раздел «Таблицы»).
 *
 * Подход: тот же что в OTLHelper2 — НЕ explicit OAuth code-exchange, а
 * embedded webview к `accounts.google.com`. Юзер логинится в Google прямо
 * в нашем окне, cookies сохраняются в общий `persist:google-sheets` partition.
 * Этот же partition использует `<webview>` в TablesScreen — после login юзер
 * увидит таблицу залогиненным без дополнительных шагов.
 *
 * IPC handlers:
 *   • `pyn:google:open-login`   — открывает modal-window с Google login.
 *     Возвращает `Promise<boolean>` (true = успешно вошли).
 *   • `pyn:google:check-status` — проверяет cookies в partition. Возвращает
 *     `{ loggedIn: boolean, email: string|null }`.
 *   • `pyn:google:logout`       — чистит cookies в partition.
 */

/** Shared with Tables + Волна webviews (Google SSO cookies). */
export const GOOGLE_PARTITION = 'persist:google-sheets';

/** Host+path only — Google OAuth URL embeds SC callback in redirect_uri query. */
export function isSoundCloudAuthCallback(raw: string): boolean {
  try {
    const u = new URL(String(raw || ''));
    if (!/(^|\.)soundcloud\.com$/i.test(u.hostname)) return false;
    const p = u.pathname || '';
    return /web-auth-callback|auth-callback|\/connect\//i.test(p);
  } catch {
    return false;
  }
}
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/spreadsheets';

// §revert v1.2.4/v1.2.3 — UA spoof CHROME_UA удалён. В v1.2.0 (где у юзера
// embedded Sheets + login работали) UA не подменялся вообще — Electron
// отдавал дефолтный UA с `Chrome/130.x` и `Electron/33.x` хвостом, и
// Google этого пропускал. Попытки «починить» через подмену UA Chrome 120
// и `disable-features: UserAgentClientHint` (f2ad76e) дали обратный эффект:
// Google теперь видит «UA Chrome 120 без client hints» и блокирует.
// Возвращаем к дефолту — Electron сам себя представляет, Sec-CH-UA шлёт.

interface GoogleStatus {
  loggedIn: boolean;
  email: string | null;
}

async function readStatus(): Promise<GoogleStatus> {
  try {
    const ses = session.fromPartition(GOOGLE_PARTITION);
    // SID / __Secure-1PSID — основные Google session cookies. Наличие хотя
    // бы одного — достаточно для «вошёл». Email Google в cookies не отдаёт
    // в plain — попробуем дёрнуть `myaccount` чтобы извлечь.
    const cookies = await ses.cookies.get({ domain: '.google.com' });
    const hasSession = cookies.some(
      (c) => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID',
    );
    if (!hasSession) return { loggedIn: false, email: null };
    return { loggedIn: true, email: null };
  } catch {
    return { loggedIn: false, email: null };
  }
}

/**
 * §v1.2.11 — Переносим cookies из ephemeral login-partition в
 * persist:google-sheets. После успешного login (Google поставил SID,
 * __Secure-1PSID и пр. в ephemeral) нам нужно их перенести в
 * persistent partition, которую использует <webview> в TablesScreen.
 */
async function copyLoginCookiesToPersist(fromPartition: string): Promise<number> {
  try {
    const fromSes = session.fromPartition(fromPartition);
    const toSes = session.fromPartition(GOOGLE_PARTITION);
    const cookies = await fromSes.cookies.get({});
    let copied = 0;
    for (const c of cookies) {
      // Только Google-домены (на login flow Google ставит cookies на
      // accounts.google.com, .google.com, .youtube.com — на youtube
      // делается checkConnection).
      const domain = c.domain || '';
      if (!domain.includes('google.') && !domain.includes('youtube.')) continue;
      const url = `https://${domain.replace(/^\./, '')}${c.path || '/'}`;
      // §v1.2.12 — `__Host-` cookies REQUIRE absence of `domain` attribute
      // (это часть Host- contract, Chromium enforces). Если передаём domain
      // → set() падает с EXCLUDE_INVALID_PREFIX. Для Host-/Secure- префиксов
      // также нужен Secure=true + Path=/.
      const isHostPrefix = c.name.startsWith('__Host-');
      const isSecurePrefix = c.name.startsWith('__Secure-');
      type CookieDetails = Parameters<typeof toSes.cookies.set>[0];
      const setArgs: CookieDetails = {
        url,
        name: c.name,
        value: c.value,
        path: isHostPrefix ? '/' : c.path,
        secure: isHostPrefix || isSecurePrefix ? true : c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      };
      if (!isHostPrefix) {
        setArgs.domain = c.domain;
      }
      try {
        await toSes.cookies.set(setArgs);
        copied++;
      } catch (e) {
        console.log(`[google-login] cookie copy fail ${c.name}:`, e);
      }
    }
    console.log(`[google-login] copied ${copied}/${cookies.length} cookies to persist`);
    return copied;
  } catch (e) {
    console.log('[google-login] copyLoginCookiesToPersist failed:', e);
    return 0;
  }
}

/**
 * §v1.2.12 — Перехват youtube.com checkConnection-запросов на ephemeral
 * login partition. Google внутри login flow открывает hidden pixel/iframe
 * к youtube.com чтобы проверить «реальный ли это браузер». Если
 * youtube reachable → check pass → продолжает login. Если timeout/error →
 * rejected page (`/v3/signin/rejected?checkConnection&checkedDomains=youtube`).
 *
 * Юзер на корп-сети EVRAZ: youtube заблокирован прокси/firewall → check
 * стабильно fail → embedded login невозможен. На Mac (home network) youtube
 * доступен → check passes → login работает.
 *
 * Fix: возвращаем синтетический 204 No Content на запросы к youtube.com.
 * Google checkConnection видит HTTP success → pass → отдаёт password screen.
 * Реально к youtube ничего не идёт, обманываем только проверку.
 */
function installYoutubeCheckBypass(partition: string): void {
  const ses = session.fromPartition(partition);
  ses.webRequest.onBeforeRequest(
    {
      urls: [
        'https://www.youtube.com/*',
        'https://youtube.com/*',
        'https://*.youtube.com/*',
        'http://www.youtube.com/*',
        'http://youtube.com/*',
        'http://*.youtube.com/*',
      ],
    },
    (details, callback) => {
      console.log(`[google-login:yt-bypass] intercepted ${details.url}`);
      // data: URL = синтетический пустой ответ, Google check pass.
      callback({ redirectURL: 'data:text/plain;base64,' });
    },
  );
}

async function openLoginWindow(parent: BrowserWindow | null): Promise<boolean> {
  // §v1.2.11 — login использует EPHEMERAL partition (не persist:).
  // Каждый login attempt — свежая in-memory сессия. Google никогда не
  // видит остаточные tracking-cookies / localStorage от прошлых попыток
  // → не переходит в strict embedded-webview rejected mode. После login
  // мы переносим cookies в persist:google-sheets для webview в Tables.
  //
  // Почему это работает: persist:google-sheets держится живой через
  // <webview> в TablesScreen → clearStorageData на нём fail silently
  // из-за file locks. Ephemeral partition освобождается автоматически
  // когда window закрыт, без locks вообще.
  const ephPartition = `login-eph-${Date.now()}`;
  let cookiesCopied = false;

  // §v1.2.12 — обход checkConnection через youtube. Должно быть установлено
  // ДО loadURL, иначе первый request к youtube успеет уйти.
  installYoutubeCheckBypass(ephPartition);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      // §v1.2.14 — НЕ modal. На Mac modal:true превращает окно в "sheet"
      // (attached к parent, без traffic lights / X-кнопки) — юзер не мог
      // закрыть. Без modal — standalone окно с нативной строкой заголовка
      // и красной кнопкой закрытия.
      parent: parent ?? undefined,
      title: 'Вход в Google',
      backgroundColor: '#1F1E1B',
      autoHideMenuBar: true,
      webPreferences: {
        partition: ephPartition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(LOGIN_URL).catch(() => {});

    // §v1.2.14 — Escape закрывает login-окно. Дополнительный путь
    // помимо нативной кнопки закрытия в title bar.
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        win.close();
      }
    });

    // §diag v1.2.8 — DevTools в login-окне для диагностики. v1.2.10:
    // только в dev mode или при явном PYN_DEBUG=1 env. В production
    // production exe DevTools юзеру не нужен и засоряет UX.
    if (!app.isPackaged || process.env.PYN_DEBUG === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    // §diag v1.2.8 — пишем console-сообщения и failed-loads из login
    // webview в main process console (→ main.log файл через setupMainLog).
    // Юзер пришлёт файл — мы увидим что Google ругает.
    win.webContents.on('console-message', (_e, level, msg, line, src) => {
      const lvl = ['v', 'i', 'w', 'e'][level] ?? '?';
      console.log(`[google-login:console:${lvl}] ${src}:${line} ${msg}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log(`[google-login:fail-load] code=${code} desc=${desc} url=${url}`);
    });
    win.webContents.on('did-navigate', (_e, url) => {
      console.log(`[google-login:navigate] ${url}`);
    });
    win.webContents.on('did-finish-load', async () => {
      try {
        const ctx = await win.webContents.executeJavaScript(
          'JSON.stringify({ua:navigator.userAgent,uaData:navigator.userAgentData?(navigator.userAgentData.brands||null):null,webdriver:navigator.webdriver,chromeRuntime:typeof chrome!=="undefined"&&typeof chrome.runtime!=="undefined",title:document.title,url:location.href})',
        );
        console.log(`[google-login:context] ${ctx}`);
      } catch (e) {
        console.log(`[google-login:context:err] ${e}`);
      }
    });

    // §v1.2.14 — копируем cookies на каждой navigate ASAP когда у Google
    // появилась session cookie. Это решает проблему "окно не закрывается":
    // раньше в close-handler делался evt.preventDefault() + async copy,
    // что блокировало close если копирование зависало.
    //
    // Теперь cookies extract'аются ДО юзерского close, а на сам close
    // ничего не делаем — окно отпускается мгновенно.
    const tryCopyCookies = async (): Promise<void> => {
      if (cookiesCopied) return;
      try {
        const ephSes = session.fromPartition(ephPartition);
        const c = await ephSes.cookies.get({ domain: '.google.com' });
        const hasSession = c.some(
          (k) =>
            k.name === 'SID' ||
            k.name === '__Secure-1PSID' ||
            k.name === '__Secure-3PSID',
        );
        if (hasSession) {
          await copyLoginCookiesToPersist(ephPartition);
          cookiesCopied = true;
        }
      } catch (e) {
        console.log('[google-login] tryCopyCookies error:', e);
      }
    };

    const onNavigation = (_evt: Electron.Event, url: string): void => {
      void tryCopyCookies();
      if (url.startsWith('https://docs.google.com/spreadsheets')) {
        win.close();
      }
    };
    win.webContents.on('will-redirect', onNavigation);
    win.webContents.on('did-navigate', onNavigation);

    // Close — без preventDefault. Cookies уже извлекаются на каждой
    // navigate. Если юзер закрыл до login — копировать нечего.
    win.on('closed', () => {
      void readStatus().then((s) => resolve(s.loggedIn));
    });
  });
}

/**
 * §wave OAuth: BrowserWindow на persist:google-sheets (как таблицы).
 * parentGuest — webview «Волна»: callback SC грузим туда (postMessage opener не работает).
 */
export function openGoogleAuthPopup(
  targetUrl: string,
  onDone: () => void,
  parentGuest?: Electron.WebContents | null,
): void {
  const url = String(targetUrl || '').trim();
  if (!url || url === 'about:blank') {
    console.log('[wave-auth] skip empty/about:blank');
    onDone();
    return;
  }

  console.log(`[wave-auth] open ${url.slice(0, 160)}`);

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Google · SoundCloud',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      // Явно google-sheets — те же SID, что Settings / Таблицы
      partition: GOOGLE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let doneSent = false;
  let handoffStarted = false;
  const sendDone = (): void => {
    if (doneSent) return;
    doneSent = true;
    onDone();
  };
  const finish = (why: string): void => {
    console.log(`[wave-auth] finish (${why})`);
    try {
      if (!win.isDestroyed()) win.close();
      else sendDone();
    } catch {
      sendDone();
    }
  };

  /**
   * Callback SC → parent webview (postMessage opener в webview не работает).
   * Не remount'им guest: WaveScreen на popup-done делает soft loadURL.
   * Ждём did-finish-load parent'а (или timeout), потом close auth-window.
   */
  const handoffSc = (scUrl: string, why: string): void => {
    if (handoffStarted || doneSent) return;
    handoffStarted = true;
    console.log(`[wave-auth] handoff ${why} ${scUrl.slice(0, 140)}`);

    const guest = parentGuest && !parentGuest.isDestroyed() ? parentGuest : null;
    if (!guest) {
      finish(`handoff-${why}-no-parent`);
      return;
    }

    let settled = false;
    const settle = (tag: string): void => {
      if (settled) return;
      settled = true;
      try {
        guest.removeListener('did-finish-load', onParentOk);
        guest.removeListener('did-fail-load', onParentFail);
      } catch {
        /* */
      }
      console.log(`[wave-auth] parent settle ${tag}`);
      finish(`handoff-${why}`);
    };
    const onParentOk = (): void => settle('ok');
    const onParentFail = (_e: Electron.Event, code: number): void => {
      // -3 aborted — часто supersede redirect, не фатально
      if (code === -3) return;
      settle(`fail:${code}`);
    };

    try {
      guest.once('did-finish-load', onParentOk);
      guest.once('did-fail-load', onParentFail);
      void guest.loadURL(scUrl).catch((e) => {
        console.log('[wave-auth] parent loadURL failed', e);
        settle('loadURL-reject');
      });
    } catch (e) {
      console.log('[wave-auth] parent loadURL throw', e);
      finish(`handoff-${why}-throw`);
      return;
    }
    // safety: не висеть вечно если guest уже мёртв / silent
    setTimeout(() => settle('timeout'), 4000);
  };

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') finish('escape');
  });
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    console.log(`[wave-auth:fail-load] code=${code} ${desc} ${String(failedUrl).slice(0, 140)}`);
    // Не finish на fail auth-page если уже handoff (redirect abort → ERR_FAILED)
    if (handoffStarted) return;
  });
  win.webContents.on('will-redirect', (e, to) => {
    console.log(`[wave-auth:redirect] ${String(to).slice(0, 160)}`);
    if (isSoundCloudAuthCallback(to)) {
      try {
        e.preventDefault();
      } catch {
        /* */
      }
      handoffSc(to, 'redirect');
    }
  });
  win.webContents.on('will-navigate', (e, to) => {
    console.log(`[wave-auth:navigate] ${String(to).slice(0, 160)}`);
    if (isSoundCloudAuthCallback(to)) {
      try {
        e.preventDefault();
      } catch {
        /* */
      }
      handoffSc(to, 'navigate');
    }
  });
  win.webContents.on('did-finish-load', () => {
    const cur = win.webContents.getURL();
    console.log(`[wave-auth:loaded] ${cur.slice(0, 180)}`);
    if (isSoundCloudAuthCallback(cur)) {
      handoffSc(cur, 'loaded');
    }
  });

  win.on('closed', () => {
    sendDone();
  });

  void win.loadURL(url).catch((e) => {
    // Redirect+preventDefault / close после handoff → ERR_FAILED на исходном OAuth URL — ок
    if (handoffStarted || doneSent) {
      console.log('[wave-auth] loadURL aborted after handoff (ok)');
      return;
    }
    console.log('[wave-auth] loadURL failed', e);
    finish('load-failed');
  });
}

async function clearPartitionFully(): Promise<void> {
  const ses = session.fromPartition(GOOGLE_PARTITION);
  console.log('[google] clearing all partition storage');
  try {
    await ses.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'websql',
        'serviceworkers',
        'cachestorage',
      ],
    });
    await ses.clearCache();
    await ses.clearHostResolverCache().catch(() => undefined);
    await ses.clearAuthCache().catch(() => undefined);
    console.log('[google] cleared OK');
  } catch (e) {
    console.log('[google] clear failed:', e);
  }
}

async function logout(): Promise<void> {
  // §v1.2.13 — просто clearStorageData без relaunch.
  //
  // В v1.2.10 был добавлен app.relaunch() + app.exit() чтобы освободить
  // partition file locks. Это было нужно потому что login использовал
  // тот же persist:google-sheets partition что и webview в TablesScreen
  // — partition держался живой через активный webview, clearStorageData
  // не мог полностью очистить.
  //
  // С v1.2.11 (ephemeral login partition) — login flow больше не
  // зависит от состояния persist:google-sheets. clearStorageData на
  // персисте отрабатывает (cookies удаляются, webview видит "no session"
  // и предлагает login form). Перезапуск приложения не нужен — он
  // выглядит как краш приложения для юзера.
  await clearPartitionFully();
}

/**
 * §v1.2.10 — На startup: если в partition нет активной session
 * (нет SID/__Secure-1PSID cookies), но что-то в storage есть —
 * очистить. Это handle юзеров кто обновился с v1.2.7/v1.2.8 где partition
 * contaminated.
 *
 * Безопасно: если юзер залогинен (есть SID) — не трогаем. Если не залогинен —
 * терять нечего, очищаем чтобы partition был pristine для следующего login.
 */
async function purgeIfNoSession(): Promise<void> {
  try {
    const ses = session.fromPartition(GOOGLE_PARTITION);
    const cookies = await ses.cookies.get({ domain: '.google.com' });
    const hasSession = cookies.some(
      (c) => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID',
    );
    if (hasSession) {
      console.log('[google-startup] session cookies present, keep partition as is');
      return;
    }
    console.log('[google-startup] no session cookies — purging partition for pristine login');
    await clearPartitionFully();
  } catch (e) {
    console.log('[google-startup] purge check failed:', e);
  }
}

/**
 * §wave — вход SoundCloud в отдельном BrowserWindow на persist:google-sheets.
 * Без auto-close: юзер закрывает окно сам после входа.
 */
export function openSoundCloudLoginWindow(_parent: BrowserWindow | null): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const win = new BrowserWindow({
      width: 1080,
      height: 780,
      title: 'SoundCloud · войди и закрой окно',
      backgroundColor: '#121212',
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        partition: GOOGLE_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    win.webContents.setWindowOpenHandler((details) => {
      const url = String(details.url || '');
      console.log(`[sc-login:window-open] ${url.slice(0, 140)}`);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            partition: GOOGLE_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    });

    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') win.close();
    });
    win.webContents.on('did-navigate', (_e, url) => {
      console.log(`[sc-login:navigate] ${String(url).slice(0, 160)}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (code === -3 || !isMainFrame) return;
      console.log(`[sc-login:fail] ${code} ${desc} ${String(failedUrl).slice(0, 100)}`);
    });

    win.webContents.on('did-create-window', (child) => {
      console.log('[sc-login:did-create-window]');
      child.webContents.on('did-navigate', (_e, url) => {
        console.log(`[sc-login:child-nav] ${String(url).slice(0, 160)}`);
      });
      child.webContents.on('will-redirect', (_e, url) => {
        console.log(`[sc-login:child-redirect] ${String(url).slice(0, 160)}`);
      });
    });

    win.on('closed', () => {
      console.log('[sc-login] window closed by user');
      finish(true);
    });

    void win.loadURL('https://soundcloud.com/').catch((e) => {
      console.log('[sc-login] loadURL fail', e);
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* */
      }
      finish(false);
    });
  });
}

export function setupGoogleBridge(): void {
  // §v1.2.10 — на старте app проверяем что partition pristine если нет
  // активной session. Закрывает gap для юзеров обновляющихся с v1.2.7-v1.2.9
  // где partition мог быть contaminated с прошлых запусков. Не await —
  // partition free в background, не блокируем app startup.
  void purgeIfNoSession();

  ipcMain.handle('pyn:google:open-login', async () => {
    const parent = BrowserWindow.getFocusedWindow();
    return openLoginWindow(parent);
  });
  ipcMain.handle('pyn:google:check-status', async () => readStatus());
  ipcMain.handle('pyn:google:logout', async () => {
    await logout();
    return readStatus();
  });

  /** §wave — окно входа SoundCloud (BrowserWindow, partition google-sheets). */
  ipcMain.handle('pyn:wave:open-login', async () => {
    const parent = BrowserWindow.getFocusedWindow();
    console.log('[sc-login] open window');
    return openSoundCloudLoginWindow(parent);
  });

  /** §wave — OAuth URL из inject window.open → отдельное окно на google partition. */
  ipcMain.handle('pyn:wave:open-auth', async (event, rawUrl: string) => {
    const url = String(rawUrl || '').trim();
    if (!url || url === 'about:blank') return { ok: false, error: 'empty_url' };
    console.log(`[wave-auth:ipc] open ${url.slice(0, 160)}`);
    return await new Promise<{ ok: boolean }>((resolve) => {
      openGoogleAuthPopup(url, () => {
        try {
          const win = BrowserWindow.fromWebContents(event.sender);
          win?.webContents.send('pyn:google-popup-done');
        } catch {
          /* */
        }
        // также всем окнам (на всякий)
        for (const w of BrowserWindow.getAllWindows()) {
          try {
            w.webContents.send('pyn:google-popup-done');
          } catch {
            /* */
          }
        }
        resolve({ ok: true });
      });
    });
  });
}
