import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
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

/** Расшифровка known VBS exit codes (см. wf_plan VBS source). */
function exitCodeHint(code: number | null): string {
  switch (code) {
    case 10: return 'clipboard read failed — открой Internet Explorer объект недоступен';
    case 11: return 'clipboard пустой — скопируй obd-данные из SAP перед запуском';
    case 12: return 'не удалось записать obd.txt на Desktop';
    case 13: return 'obd.txt не создался';
    case 14: return 'obd.txt пустой';
    case 20: return 'SAP GUI не запущен — открой SAP и залогинься';
    case 21: return 'SAP session недоступна';
    default: return '';
  }
}

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

      // Debug-log путь — VBS пишет checkpoint'ы туда, 1:1 c Kotlin
      // MacroOrchestrator. Помогает диагностировать SAP-сбои.
      const debugLogPath = path.join(homedir(), 'Desktop', 'otl-debug.log');

      try {
        // Запись VBS без BOM. Node `writeFileSync` с 'utf8' не добавляет BOM.
        writeFileSync(vbsPath, vbsSource, { encoding: 'utf8' });

        let stdoutBuf = '';
        let stderrBuf = '';
        let exitCode: number | null = null;

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            try { child.kill(); } catch (_) {}
            reject(new Error('cscript_timeout'));
          }, CSCRIPT_TIMEOUT_MS);

          // Args 1:1 c Kotlin: `//Nologo` (двойной слэш), БЕЗ `/B`.
          // `/B` подавляет stderr — теряем диагностику если VBS упал.
          const child = spawn('cscript', ['//Nologo', vbsPath], {
            env: {
              ...process.env,
              OTL_MACRO_OUTPUT: tsvPath,
              OTL_MACRO_DEBUG_LOG: debugLogPath,
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout?.on('data', (d: Buffer) => {
            stdoutBuf += d.toString('utf-8');
            if (stdoutBuf.length > 4000) stdoutBuf = stdoutBuf.slice(-4000);
          });
          child.stderr?.on('data', (d: Buffer) => {
            stderrBuf += d.toString('utf-8');
            if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
          });
          child.on('exit', (code) => {
            clearTimeout(timer);
            exitCode = code;
            if (code === 0) resolve();
            else reject(new Error(`cscript_exit_${code}`));
          });
          child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        }).catch((e) => {
          // Перевыбрасываем как обычную ошибку — message подхватится ниже.
          throw e instanceof Error ? e : new Error(String(e));
        });

        // §VBS-EXIT-CODES (см. wf_plan VBS):
        //   10 = clipboard read threw, 11 = clipboard empty,
        //   12 = WriteUTF8 threw, 13 = obd.txt не создался,
        //   14 = obd.txt пустой, 20 = SAP не запущен, 21 = no SAP session
        const stderrTail = (stderrBuf || stdoutBuf).slice(-400).replace(/\s+/g, ' ').trim();

        if (!existsSync(tsvPath)) {
          cleanup();
          const hint = exitCodeHint(exitCode);
          return {
            ok: false,
            error: `no_output_file (exit=${exitCode}${hint ? `, ${hint}` : ''})${stderrTail ? `, stderr: ${stderrTail.slice(0, 200)}` : ''}`,
          };
        }

        // TSV из VBS — UTF-16 LE с BOM. Sub WriteUnicode в VBS источниках
        // делает `CreateTextFile(path, True, True)` — третий True = Unicode
        // mode = UTF-16 LE + BOM (0xFF 0xFE). Читаем 1:1 c Kotlin
        // MacroOrchestrator.kt:265 — `readText(Charsets.UTF_16LE).removePrefix("﻿")`.
        // ⚠️ Был bug: читали как 'utf-8' → submit улетал с NUL-байтами,
        // Sheets API писал мусор или отвечал 400 → юзер видел «не сработало»
        // несмотря на EXIT_OK от VBS.
        let tsv = readFileSync(tsvPath).toString('utf16le');
        if (tsv.charCodeAt(0) === 0xFEFF) tsv = tsv.slice(1);
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
