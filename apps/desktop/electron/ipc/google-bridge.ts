import { BrowserWindow, ipcMain, session } from 'electron';

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

/**
 * Google блокирует embedded webview-логины с UA содержащим `Electron`
 * (показывает «Поддержка JavaScript отключена»). Подменяем UA на чистый
 * Chrome 120 для всего `persist:google-sheets` partition — это покрывает
 * и login-окно, и `<webview>` в TablesScreen.
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

async function openLoginWindow(parent: BrowserWindow | null): Promise<boolean> {
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
        partition: GOOGLE_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Дублируем UA-override явно на webContents — partition-level
    // `setUserAgent` иногда применяется после первого navigation. Это
    // двойная страховка.
    win.webContents.setUserAgent(CHROME_UA);
    win.loadURL(LOGIN_URL, { userAgent: CHROME_UA }).catch(() => {});

    // Авто-закрытие когда Google редиректнул на docs.google.com (успешный login).
    const onNavigation = (_evt: Electron.Event, url: string) => {
      if (url.startsWith('https://docs.google.com/spreadsheets')) {
        win.close();
      }
    };
    win.webContents.on('will-redirect', onNavigation);
    win.webContents.on('did-navigate', onNavigation);

    win.on('closed', () => {
      // Проверим cookies после закрытия — могут быть установлены даже если
      // юзер сам закрыл окно после логина.
      void readStatus().then((s) => resolve(s.loggedIn));
    });
  });
}

async function logout(): Promise<void> {
  const ses = session.fromPartition(GOOGLE_PARTITION);
  // Чистим cookies всех Google-доменов чтобы webview потерял session.
  const all = await ses.cookies.get({});
  await Promise.all(
    all
      .filter((c) => c.domain && c.domain.includes('google.'))
      .map((c) => {
        const url = `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`;
        return ses.cookies.remove(url, c.name).catch(() => undefined);
      }),
  );
}

export function setupGoogleBridge(): void {
  // Подменяем UA на старте — до первого открытия login-окна или webview'a.
  // Google отдаёт login-форму только UA-whitelisted клиентам.
  session.fromPartition(GOOGLE_PARTITION).setUserAgent(CHROME_UA);

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
