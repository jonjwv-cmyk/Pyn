import { app, ipcMain, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Auto-update bridge — 3 шага: проверить кэш → скачать → установить.
 *
 *   pyn:update:check-cached(version) → { exists, localPath }
 *   pyn:update:download(url, version, expectedSha?) → { ok, localPath, sha, error }
 *   pyn:update:install(localPath) → spawn new exe + quit
 *
 * §pyn-1.2.54 — файл скачивается СРАЗУ на Desktop с именем
 * `Pyn <version>.exe` (с пробелом, версия в имени). Install запускает новый
 * exe с CLI-арг `--remove-prev=<old path>` и закрывает старый процесс;
 * новый exe при startup удаляет старый файл по этому пути (см. main.ts).
 *
 * SHA-256 verification: после download считаем SHA локального файла,
 * сравниваем с `expectedSha` (server-side `binary_sha`). Mismatch =
 * подмена бинаря по пути → удаляем, error.
 */

const PROGRESS_THROTTLE_MS = 200;

/**
 * §pyn-1.2.54 — download path = Desktop. Никакого `userData/updates/`.
 * Юзер видит файл сразу на рабочем столе после скачивания.
 */
function getUpdatesDir(): string {
  const dir = app.getPath('desktop');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* desktop существует, ignore */
  }
  return dir;
}

/**
 * §pyn-1.2.54 — имя файла `Pyn <version>.exe` (Mac: `.dmg`). С пробелом,
 * чтобы Windows показывал «Pyn 1.2.54.exe» — узнаваемо для юзера.
 */
function fileNameFromUrl(_url: string, version: string): string {
  const ext = process.platform === 'win32' ? 'exe' : process.platform === 'darwin' ? 'dmg' : 'AppImage';
  const safe = version.replace(/[^0-9A-Za-z.-]/g, '_');
  return `Pyn ${safe}.${ext}`;
}

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function setupUpdateBridge(): void {
  /**
   * Проверить кэш — возвращает localPath если файл уже скачан.
   * Размер 0 = corrupt, удаляем чтобы при следующем download был свежий.
   */
  ipcMain.handle(
    'pyn:update:check-cached',
    async (_evt, url: string, version: string): Promise<{ exists: boolean; localPath: string }> => {
      const dest = path.join(getUpdatesDir(), fileNameFromUrl(url, version));
      try {
        const st = statSync(dest);
        if (st.size > 1024) return { exists: true, localPath: dest };
        // Битый/пустой файл — стираем.
        try { unlinkSync(dest); } catch { /* ignore */ }
        return { exists: false, localPath: dest };
      } catch {
        return { exists: false, localPath: dest };
      }
    },
  );

  /**
   * Скачать файл с прогрессом. После скачивания — SHA-256 verify если
   * `expectedSha` передан. Mismatch → удаляем + ошибка.
   *
   * На Mac (где target = DMG, manual install) делаем openExternal — пусть
   * юзер сам скачает через браузер.
   */
  ipcMain.handle(
    'pyn:update:download',
    async (
      event,
      url: string,
      version: string,
      expectedSha?: string,
    ): Promise<{ ok: boolean; localPath?: string; sha?: string; error?: string }> => {
      if (typeof url !== 'string' || !url) return { ok: false, error: 'no-url' };
      if (process.platform !== 'win32') {
        await shell.openExternal(url);
        return { ok: true };
      }

      const dest = path.join(getUpdatesDir(), fileNameFromUrl(url, version));
      const reportProgress = throttle((bytes: number, total: number) => {
        event.sender.send('pyn:update:progress', { bytes, total });
      }, PROGRESS_THROTTLE_MS);

      try {
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

        // SHA verification — защита от подмены бинаря в пути CF→VPS→client.
        const actualSha = await sha256OfFile(dest);
        if (expectedSha && expectedSha.length > 0
            && actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
          try { unlinkSync(dest); } catch { /* ignore */ }
          return {
            ok: false,
            error: `sha_mismatch: expected ${expectedSha.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…`,
          };
        }

        // §pyn-1.2.54 — Mark-of-the-Web в Zone.Identifier ADS на скачанный
        // файл. Без MOTW Касперский считает exe «локально созданным» и может
        // corrupt portable extract (ffmpeg.dll error). С MOTW — рассматривается
        // как «скачанное из интернета», SmartScreen один раз, дальше OK.
        try {
          writeFileSync(
            `${dest}:Zone.Identifier`,
            '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://45-12-239-5.sslip.io/\r\n',
          );
        } catch (e) {
          // Не критично — на FAT/network drive ADS не поддерживается.
          console.warn('[update] MOTW write failed:', e);
        }

        return { ok: true, localPath: dest, sha: actualSha };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try { unlinkSync(dest); } catch { /* ignore */ }
        return { ok: false, error: message };
      }
    },
  );

  /**
   * §pyn-1.2.54 — install запускает СКАЧАННЫЙ exe (он уже на Desktop'е
   * с именем `Pyn <version>.exe`) с CLI-арг `--remove-prev=<current exe>`.
   * Новый процесс при startup в main.ts удаляет старый файл по этому пути.
   *
   * Cmd-chain:
   *   1. taskkill webview2 — освобождает file-locks Chromium subprocess'ов.
   *   2. timeout 3s — даём ОС/AV release locks на текущий exe.
   *   3. spawn новый exe с --remove-prev=<path>.
   *   4. таймаут 1.5s → app.quit() (старый процесс закрывается).
   *
   * Касперский больше не corrupt'ит portable extract: новый exe сам
   * extract'ится в свой `%LOCALAPPDATA%\Pyn-portable-<новый>`. Старый
   * extract будет очищен через cleanupStalePortableDirs при ближайшем
   * запуске (self-install.ts).
   */
  ipcMain.handle(
    'pyn:update:install',
    async (_evt, localPath: string): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') {
        return { ok: false, error: 'platform_not_supported' };
      }
      try {
        await readFile(localPath);
      } catch {
        return { ok: false, error: 'local_file_missing' };
      }

      const currentExe = app.getPath('exe');
      // §pyn-1.2.54 — Mark-of-the-Web на скачанном exe пишется в download
      // handler'е (см. ниже после sink.end()). Здесь — просто запускаем.
      //
      // taskkill webview2 чтобы освободить locks от Chromium subprocess'ов
      // на webview2-loader.dll; задержка перед запуском нового exe — AV
      // успевает «выдохнуть».
      const cmd = `taskkill /F /IM msedgewebview2.exe & `
        + `timeout /t 3 /nobreak > NUL & `
        + `start "" "${localPath}" --remove-prev="${currentExe}"`;
      spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore' }).unref();

      setTimeout(() => app.quit(), 1500);
      return { ok: true };
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
