import { app, ipcMain, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Auto-update bridge — скачивает новый билд по URL и запускает установку.
 *
 * IPC `pyn:update:download-install` принимает `(url, version)`:
 *   1. Создаёт папку `%LOCALAPPDATA%\Pyn\updates\` (Win) или
 *      `~/Library/Application Support/@pyn/desktop/updates/` (Mac).
 *      Это **Kaspersky-tolerant** путь (legit data dir, не %TEMP%).
 *   2. Streaming-download exe через Electron `net.request` (использует
 *      Chromium стек — единственный путь, где наш SPKI-pin verify hook
 *      применится; обычный `https` module его минует).
 *   3. Сообщает прогресс через event `pyn:update:progress`.
 *   4. На Windows: spawn `cmd.exe` с командой kill-old + run-new + restart.
 *   5. App quit'ит — новый process берёт верх.
 *
 * На Mac обычно обновляются через DMG manually; IPC-handler на Mac просто
 * откроет URL в браузере (юзер скачает DMG сам).
 */

const PROGRESS_THROTTLE_MS = 200;

function getUpdatesDir(): string {
  const base = app.getPath('userData');
  const dir = path.join(base, 'updates');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fileNameFromUrl(url: string, version: string): string {
  const ext = process.platform === 'win32' ? 'exe' : process.platform === 'darwin' ? 'dmg' : 'AppImage';
  const safe = version.replace(/[^0-9A-Za-z.-]/g, '_');
  // Прочие неизвестные расширения берём из URL pathname, fallback на ext.
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').pop() || `pyn-${safe}.${ext}`;
    return base.includes('.') ? base : `pyn-${safe}.${ext}`;
  } catch {
    return `pyn-${safe}.${ext}`;
  }
}

export function setupUpdateBridge(): void {
  ipcMain.handle(
    'pyn:update:download-install',
    async (event, url: string, version: string): Promise<{ ok: boolean; error?: string }> => {
      if (typeof url !== 'string' || !url) {
        return { ok: false, error: 'no-url' };
      }
      // На Mac open в браузере, юзер скачает DMG руками.
      if (process.platform !== 'win32') {
        await shell.openExternal(url);
        return { ok: true };
      }

      try {
        const dest = path.join(getUpdatesDir(), fileNameFromUrl(url, version));
        const reportProgress = throttle((bytes: number, total: number) => {
          event.sender.send('pyn:update:progress', { bytes, total });
        }, PROGRESS_THROTTLE_MS);

        await new Promise<void>((resolve, reject) => {
          const request = net.request({ url, method: 'GET', redirect: 'follow' });
          request.on('response', (response) => {
            const status = response.statusCode;
            if (status < 200 || status >= 300) {
              reject(new Error(`HTTP ${status}`));
              return;
            }
            const total = Number(response.headers['content-length'] ?? 0) || 0;
            let bytes = 0;
            const sink = createWriteStream(dest);
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              sink.write(chunk);
              reportProgress(bytes, total);
            });
            response.on('end', () => {
              sink.end();
              sink.on('finish', resolve);
              sink.on('error', reject);
            });
            response.on('error', reject);
          });
          request.on('error', reject);
          request.end();
        });

        // Запускаем установщик и закрываем себя.
        //   • taskkill убивает webview2 (он держит lock на exe).
        //   • timeout 2 сек — дать процессам корректно завершиться.
        //   • запуск exe — для portable target Electron'а это spawn новой
        //     инстансы; для NSIS — silent install (/S) + auto-launch.
        const isPortable = /portable/i.test(dest);
        const installCmd = isPortable
          ? `start "" "${dest}"`
          : `"${dest}" /S`;
        const cmd =
          `taskkill /F /IM msedgewebview2.exe & ` +
          `timeout /t 2 /nobreak > NUL & ` +
          `${installCmd}`;
        spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore' }).unref();

        setTimeout(() => app.quit(), 1500);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );
}

function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: never[]) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  }) as T;
}
