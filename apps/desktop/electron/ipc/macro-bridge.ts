import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Запуск VBS-скрипта SAP-макроса. Windows-only (cscript).
 *
 * Pipeline:
 *   1. Получаем `vbsSource` из `get_macro_bundle` (server отдаёт текст VBS,
 *      БЕЗ UTF-8 BOM — cscript на Win 10/11 22621 не понимает BOM).
 *   2. Пишем в `%LOCALAPPDATA%\@pyn\desktop\macros\<uuid>.vbs`. Это
 *      Kaspersky-tolerant путь (legit data dir, не %TEMP%).
 *   3. Spawn `cscript /B /Nologo <vbs>` с env `OTL_MACRO_OUTPUT=<tsv-path>`.
 *      VBS внутри читает этот env и пишет TSV туда.
 *   4. Ждём exit. Читаем TSV. Удаляем оба файла (SAP-данные на диске не
 *      храним — приватность + Kaspersky scanning).
 *   5. Возвращаем TSV-строку renderer'у → он отправит submitMacroData.
 *
 * Timeout — 5 мин на cscript. SAP-связь у юзеров на работе тормозит, но
 * 5 мин — потолок (на больше — что-то не так с SAP сессией).
 */

const CSCRIPT_TIMEOUT_MS = 5 * 60 * 1000;

export interface MacroRunResult {
  ok: boolean;
  tsv?: string;
  error?: string;
}

export function setupMacroBridge(): void {
  ipcMain.handle(
    'pyn:macro:run-vbs',
    async (_evt, vbsSource: string): Promise<MacroRunResult> => {
      if (process.platform !== 'win32') {
        return { ok: false, error: 'platform_not_supported' };
      }
      if (typeof vbsSource !== 'string' || !vbsSource) {
        return { ok: false, error: 'empty_vbs' };
      }

      const macrosDir = path.join(app.getPath('userData'), 'macros');
      try {
        mkdirSync(macrosDir, { recursive: true });
      } catch (e) {
        return {
          ok: false,
          error: `mkdir_failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const id = randomUUID();
      const vbsPath = path.join(macrosDir, `${id}.vbs`);
      const tsvPath = path.join(macrosDir, `${id}.tsv`);

      const cleanup = (): void => {
        try { rmSync(vbsPath, { force: true }); } catch (_) {}
        try { rmSync(tsvPath, { force: true }); } catch (_) {}
      };

      try {
        // Запись VBS без BOM. Node `writeFileSync` с 'utf8' не добавляет BOM.
        writeFileSync(vbsPath, vbsSource, { encoding: 'utf8' });

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            try { child.kill(); } catch (_) {}
            reject(new Error('cscript_timeout'));
          }, CSCRIPT_TIMEOUT_MS);

          const child = spawn('cscript', ['/B', '/Nologo', vbsPath], {
            env: { ...process.env, OTL_MACRO_OUTPUT: tsvPath },
            windowsHide: true,
            stdio: 'ignore',
          });
          child.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`cscript_exit_${code}`));
          });
          child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        });

        if (!existsSync(tsvPath)) {
          cleanup();
          return { ok: false, error: 'no_output_file' };
        }

        // TSV из VBS — UTF-8 (наш VBS использует Scripting.FileSystemObject
        // в Unicode-режиме). Если макрос написал в ANSI — TSV прочитается
        // с искажениями, но это будет видно по результатам.
        const tsv = readFileSync(tsvPath, 'utf-8');
        cleanup();
        if (!tsv.trim()) {
          return { ok: false, error: 'empty_output' };
        }
        return { ok: true, tsv };
      } catch (e) {
        cleanup();
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
}
