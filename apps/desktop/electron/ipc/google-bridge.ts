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

const GOOGLE_PARTITION = 'persist:google-sheets';
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
      try {
        await toSes.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
          sameSite: c.sameSite,
        });
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

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      modal: parent !== null,
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

    // Авто-закрытие когда Google редиректнул на docs.google.com (успешный login).
    // Перед close — копируем cookies из ephemeral в persist (иначе они умрут
    // вместе с in-memory partition).
    const onNavigation = async (_evt: Electron.Event, url: string) => {
      if (url.startsWith('https://docs.google.com/spreadsheets')) {
        if (!cookiesCopied) {
          await copyLoginCookiesToPersist(ephPartition);
          cookiesCopied = true;
        }
        win.close();
      }
    };
    win.webContents.on('will-redirect', onNavigation);
    win.webContents.on('did-navigate', onNavigation);

    // Если юзер вручную закрыл окно — тоже попробуем скопировать cookies
    // (мог залогиниться, не дойти до docs.google.com и закрыть).
    win.on('close', async (evt) => {
      if (cookiesCopied) return;
      evt.preventDefault();
      await copyLoginCookiesToPersist(ephPartition);
      cookiesCopied = true;
      win.destroy();
    });

    win.on('closed', () => {
      void readStatus().then((s) => resolve(s.loggedIn));
    });
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
  // §v1.2.10 — clearStorageData + app.relaunch.
  //
  // v1.2.9 ввёл полную очистку всех storages при logout (раньше чистили
  // только cookies). Но clearStorageData в Electron часто **fail silently**
  // если partition держится живой через активный webview (TablesScreen
  // имеет `<webview partition="persist:google-sheets">` смонтированный
  // в renderer'е). Service Workers, IndexedDB могут не очиститься из-за
  // file locks.
  //
  // Симптом v1.2.9: юзер скачал новый exe → запустил → login fail
  // (partition contaminated с прошлых запусков) → logout → login снова
  // fail (clearStorageData не отработал полностью).
  //
  // Решение: clear + relaunch app. Перезапуск гарантированно освобождает
  // все file locks. Новый процесс открывает уже пустую partition.
  await clearPartitionFully();
  console.log('[google-logout] relaunching app for clean state');
  app.relaunch();
  app.exit(0);
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
}
