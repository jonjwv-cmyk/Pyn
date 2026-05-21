import { app, ipcMain, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Auto-update bridge — 3 шага: проверить кэш → скачать → установить.
 *
 *   pyn:update:check-cached(version) → { exists, localPath }
 *   pyn:update:download(url, version, expectedSha?) → { ok, localPath, sha, error }
 *   pyn:update:install(localPath) → spawn installer + quit
 *
 * Файл хранится в `userData/updates/pyn-<version>-portable.exe` (или подобное
 * из URL). Если юзер отказался установить — файл остаётся, следующий клик
 * по «Доступно обновление» пропускает download.
 *
 * SHA-256 verification: после download считаем SHA локального файла,
 * сравниваем с `expectedSha` (server-side `binary_sha`). Mismatch =
 * подмена бинаря по пути → удаляем, error.
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
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').pop() || `pyn-${safe}.${ext}`;
    return base.includes('.') ? base : `pyn-${safe}.${ext}`;
  } catch {
    return `pyn-${safe}.${ext}`;
  }
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

        return { ok: true, localPath: dest, sha: actualSha };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try { unlinkSync(dest); } catch { /* ignore */ }
        return { ok: false, error: message };
      }
    },
  );

  /**
   * Запустить установщик из ранее скачанного файла.
   * Portable: spawn новый процесс exe — берёт верх, наш quit'aется.
   * NSIS: silent install (/S) → auto-launch.
   */
  ipcMain.handle(
    'pyn:update:install',
    async (_evt, localPath: string): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') {
        return { ok: false, error: 'platform_not_supported' };
      }
      try {
        // Проверяем что файл существует
        await readFile(localPath);
      } catch {
        return { ok: false, error: 'local_file_missing' };
      }

      const exeName = path.basename(app.getPath('exe'));
      const isPortable = /portable/i.test(localPath);
      const installCmd = isPortable
        ? `start "" "${localPath}"`
        : `"${localPath}" /S`;

      // Cmd-chain (паттерн из OTLHelper2 production):
      //   1. taskkill msedgewebview2 — освобождает file-locks Chromium subprocess'ов
      //   2. taskkill running Pyn.exe — освобождает lock на самом portable exe
      //      (без этого новый exe не может перезаписать text section своего process'a)
      //   3. timeout 2s — даём процессам корректно отпустить handles
      //   4. start новый installer/portable
      //   5. timeout 6s — даём ему успеть распаковаться/запуститься до того
      //      как cmd.exe закроется (важно для portable extraction)
      const cmd = `taskkill /F /IM msedgewebview2.exe & `
        + `taskkill /F /IM "${exeName}" & `
        + `timeout /t 2 /nobreak > NUL & `
        + `${installCmd} & `
        + `timeout /t 6 /nobreak > NUL`;
      spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore' }).unref();

      // Чуть больше задержки чтобы cmd-chain точно стартовал до нашего exit.
      setTimeout(() => app.quit(), 1500);
      return { ok: true };
    },
  );

  /**
   * Legacy combined endpoint (download + install). Оставлен для обратной
   * совместимости — UpdatePromptDialog v1 его использует. Новый flow
   * использует split-методы через sidebar pill.
   */
  ipcMain.handle(
    'pyn:update:download-install',
    async (event, url: string, version: string): Promise<{ ok: boolean; error?: string }> => {
      const dl = await new Promise<{ ok: boolean; localPath?: string; error?: string }>((resolve) => {
        // Re-dispatch через ipc invoke не работает; вызываем inline
        // упрощённую версию downloads без SHA (legacy).
        (async () => {
          if (process.platform !== 'win32') {
            await shell.openExternal(url);
            resolve({ ok: true });
            return;
          }
          const dest = path.join(getUpdatesDir(), fileNameFromUrl(url, version));
          try {
            const reportProgress = throttle((bytes: number, total: number) => {
              event.sender.send('pyn:update:progress', { bytes, total });
            }, PROGRESS_THROTTLE_MS);
            await new Promise<void>((res2, rej2) => {
              const request = net.request({ url, method: 'GET', redirect: 'follow' });
              request.on('response', (response) => {
                const status = response.statusCode;
                if (status < 200 || status >= 300) { rej2(new Error(`HTTP ${status}`)); return; }
                const total = Number(response.headers['content-length'] ?? 0) || 0;
                let bytes = 0;
                const sink = createWriteStream(dest);
                response.on('data', (chunk: Buffer) => {
                  bytes += chunk.length;
                  sink.write(chunk);
                  reportProgress(bytes, total);
                });
                response.on('end', () => { sink.end(); sink.on('finish', res2); sink.on('error', rej2); });
                response.on('error', rej2);
              });
              request.on('error', rej2);
              request.end();
            });
            resolve({ ok: true, localPath: dest });
          } catch (err) {
            resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
      if (!dl.ok || !dl.localPath) return { ok: false, error: dl.error };
      const isPortable = /portable/i.test(dl.localPath);
      const installCmd = isPortable
        ? `start "" "${dl.localPath}"`
        : `"${dl.localPath}" /S`;
      const cmd = `taskkill /F /IM msedgewebview2.exe & timeout /t 2 /nobreak > NUL & ${installCmd}`;
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
