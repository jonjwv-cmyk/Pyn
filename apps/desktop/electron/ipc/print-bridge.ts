import { app, BrowserWindow, ipcMain } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ════════════════════════════════════════════════════════════════════════
 *  ⚠️  CANONICAL — НЕ ЛОМАТЬ БЕЗ НЕОБХОДИМОСТИ — Утверждено 2026-05-26  ⚠️
 *
 *  Print bridge: PDF-генерация для раздела «Проба» (и других в будущем).
 *  Решение прошло через 2+ часа итераций. ДЕТАЛИ ниже + memory note
 *  `project_pdf_print_canonical.md`.
 *
 *  ━━ Два режима, оба через printToPDF — PDF гарантированно одинаковый ━━
 *
 *  • `pyn:print:dialog` — генерит PDF во временную папку, открывает в
 *    системном PDF-viewer'е (Preview / Adobe). Юзер жмёт Cmd+P в viewer'е
 *    и выбирает принтер/копии. Файл удаляется через 2 минуты (TTL).
 *  • `pyn:print:save-pdf` — сразу printToPDF + showSaveDialog. Файл
 *    остаётся у юзера в выбранной папке.
 *
 *  ━━ Корневая проблема: тёмная рамка вокруг PDF ━━
 *
 *  Tailwind через `@apply bg-bg-surface` в `@layer base` ставил dark bg
 *  (#1F1E1B) на `html, body, #root`. По CSS spec (Backgrounds Module L3),
 *  root element background propagates to **canvas** в paged media. Canvas
 *  PDF включает зону `@page margin` — она заполнялась #1F1E1B → тёмная
 *  «рамка» вокруг белого листа.
 *
 *  Перепробованные ОБХОДЫ (НЕ работают по отдельности):
 *    ✗ @media print { html { background: white !important } }
 *      — Chromium printToPDF использует другой paint pipeline, author-CSS
 *        !important не всегда переписывает canvas paint.
 *    ✗ Inline style document.documentElement.style.background = 'white'
 *      — то же самое, не пересчитывается canvas propagation.
 *    ✗ Удаление @apply из index.css — другие wrapper'ы (App.tsx) с
 *      bg-bg-surface всё равно пропускают тёмный paint через canvas.
 *    ✗ insertCSS({ cssOrigin: 'user' }) — на screen применяется (popover
 *      становится transparent), но printToPDF canvas всё равно dark.
 *
 *  ━━ КАНОНИЧЕСКОЕ РЕШЕНИЕ — `withTransparentRoot()` ниже ━━
 *
 *  Triple-layer attack, ВСЕ ТРИ слоя нужны вместе:
 *
 *    1️⃣  `win.setBackgroundColor('#ffffff')` — Chromium BrowserWindow
 *        fallback paint = белый. Виден сквозь transparent DOM.
 *
 *    2️⃣  `webContents.insertCSS(..., { cssOrigin: 'user' })` — user-origin
 *        !important beats author-origin !important (CSS Cascade L5).
 *
 *    3️⃣  **DOM mutation** (SURGICAL) через executeJavaScript: strip
 *        bg-bg-X / bg-surface / etc классы ТОЛЬКО с трёх элементов:
 *        `<html>`, `<body>`, App outer wrapper (`#root > div`). Это
 *        единственные источники bleeding в @page margin area (их
 *        h-full w-full раздувает bg в зону Chromium-margin'ов).
 *        Дети App wrapper'а (sidebar, popovers) сохраняют свои bg-bg-* →
 *        НЕТ визуального flash на экране во время генерации PDF.
 *
 *  После printToPDF — restore классов из data-attribute + setBackgroundColor.
 *  Всё в `try/finally` + safety timer в renderer (8s auto-restore если main
 *  process крашнет) + double restore (immediate + 200ms задержка для React).
 *
 *  ━━ ВАЖНО: не трогать regex в DOM mutation ━━
 *  Regex `\bbg-(?:bg-|surface|elevated|deep|hover|pressed|selected)[^\s]*`
 *  специально не матчит `bg-accent-clay-*`, `bg-danger`, `bg-presence-*`,
 *  `bg-white/[0.04]` — они нужны для day-pills, code chips, hover states.
 *
 *  Если тёмная рамка вернётся — проверь:
 *    1. `withTransparentRoot` обёртывает оба printToPDF вызова
 *    2. Bundle перебилдился (`apps/desktop/dist-electron/main.js`)
 *    3. Electron restartнулся
 *    4. Может появилась новая Tailwind утилита с dark bg вне regex'а
 * ════════════════════════════════════════════════════════════════════════ */

function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;
  const all = BrowserWindow.getAllWindows();
  return all[0] ?? null;
}

/** Параметры printToPDF — единый источник правды.
 *  Поля 0.3937" = 10mm = ровно 1 см со всех сторон. */
const PDF_OPTIONS = {
  pageSize: 'A4' as const,
  landscape: false,
  printBackground: true,
  displayHeaderFooter: false,
  margins: {
    marginType: 'custom' as const,
    top: 0.3937,
    bottom: 0.3937,
    left: 0.3937,
    right: 0.3937,
  },
};

/**
 * ⚠️  CANONICAL — НЕ УПРОЩАТЬ И НЕ УДАЛЯТЬ СЛОИ. См. header файла + memory
 *     note `project_pdf_print_canonical.md`.
 *
 * Triple-layer attack — гарантированно белый canvas в PDF:
 *   1. setBackgroundColor — Chromium window fallback paint = #ffffff
 *   2. insertCSS({ cssOrigin: 'user' }) — user-origin !important > author
 *   3. DOM class stripping — physically снимает bg-bg-* классы со всех элементов
 *
 * Каждый из 3-х слоёв необходим — проверено эмпирически. По отдельности
 * любой из них НЕ убирает тёмную рамку (см. memory note для деталей).
 */
async function withTransparentRoot<T>(
  win: BrowserWindow,
  fn: () => Promise<T>,
): Promise<T> {
  const prevBg = win.getBackgroundColor();
  win.setBackgroundColor('#ffffff');
  // §скрыть «мелькание» — на время генерации (print-эмуляция меняет ВИДИМУЮ
  // страницу в светлый print-режим) накрываем окно непрозрачной дочерней
  // заглушкой. В PDF она НЕ попадает: printToPDF снимает только webContents
  // основного окна, а это отдельное окно.
  let cover: BrowserWindow | null = null;
  try {
    const b = win.getBounds();
    cover = new BrowserWindow({
      parent: win, frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: false, show: false,
      x: b.x, y: b.y, width: b.width, height: b.height,
      backgroundColor: '#1F1E1B',
    });
    cover.setIgnoreMouseEvents(true);
    void cover.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="margin:0;height:100vh;display:flex;align-items:center;' +
            'justify-content:center;background:#1F1E1B;color:#A6A39B;' +
            'font:13px -apple-system,Segoe UI Variable,Segoe UI,sans-serif">Сохранение PDF…</body>',
        ),
    );
    cover.showInactive();
  } catch {
    cover = null;
  }
  // ⚠️ Electron printToPDF по умолчанию рендерит media=screen, поэтому блок
  // `@media print` (бумажная light-палитра: белый фон + ТЁМНЫЙ текст #1A1815)
  // в PDF НЕ применялся — текст графика уходил в PDF светло-серым (dark-theme
  // экранные цвета) на белом фоне = нечитаемо. WebContents.emulateMediaType в
  // Electron 33 нет → эмулируем print media через CDP-дебаггер
  // (Emulation.setEmulatedMedia). Сбрасываем в finally.
  const dbg = win.webContents.debugger;
  let dbgAttached = false;
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      dbgAttached = true;
    }
    await dbg.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
  } catch {
    /* devtools открыт / не поддерживается — PDF будет в screen-media (как было) */
  }
  // SURGICAL strip — только корневой App wrapper (`body > #root > div` c
  // `bg-bg-surface`). Это единственный источник bleeding в @page margin
  // area (его h-full w-full раздувает bg в зону маржинов Chromium). Не
  // трогаем sidebar / popovers / другие элементы → screen не дёргается,
  // нет визуального flash во время генерации PDF.
  await win.webContents.executeJavaScript(`
    (() => {
      const re = /\\bbg-(?:bg-|surface|elevated|deep|hover|pressed|selected)[^\\s]*/g;
      // Cleanup на случай stale state
      document.querySelectorAll('[data-pyn-pdf-orig]').forEach((el) => {
        const o = el.getAttribute('data-pyn-pdf-orig');
        if (o !== null) el.setAttribute('class', o);
        el.removeAttribute('data-pyn-pdf-orig');
      });
      if (window.__pyn_pdf_safety) {
        clearTimeout(window.__pyn_pdf_safety);
        delete window.__pyn_pdf_safety;
      }
      // Только targeted elements
      const targets = [
        document.documentElement,
        document.body,
      ];
      const appWrapper = document.querySelector('#root > div');
      if (appWrapper) targets.push(appWrapper);
      let count = 0;
      targets.forEach((el) => {
        if (!el) return;
        const cls = el.getAttribute('class') || '';
        if (re.test(cls)) {
          el.setAttribute('data-pyn-pdf-orig', cls);
          el.setAttribute('class', cls.replace(re, '').replace(/\\s+/g, ' ').trim());
          count++;
        }
      });
      // Inline style на App wrapper'е — visibility children сами рендерятся.
      // Стрипаем bg на root уровне; дети (sidebar / main) не визуально не
      // меняются т.к. сами рисуют свой bg-bg-* fill.
      void document.documentElement.offsetHeight;
      window.__pyn_pdf_safety = setTimeout(() => {
        document.querySelectorAll('[data-pyn-pdf-orig]').forEach((el) => {
          const o = el.getAttribute('data-pyn-pdf-orig');
          if (o !== null) el.setAttribute('class', o);
          el.removeAttribute('data-pyn-pdf-orig');
        });
        delete window.__pyn_pdf_safety;
      }, 8000);
      return count;
    })();
  `);
  await new Promise((r) => setTimeout(r, 100));
  try {
    return await fn();
  } finally {
    // 1й restore — сразу после printToPDF
    try {
      await win.webContents.executeJavaScript(`
        (() => {
          if (window.__pyn_pdf_safety) {
            clearTimeout(window.__pyn_pdf_safety);
            delete window.__pyn_pdf_safety;
          }
          document.querySelectorAll('[data-pyn-pdf-orig]').forEach((el) => {
            const orig = el.getAttribute('data-pyn-pdf-orig');
            if (orig !== null) el.setAttribute('class', orig);
            el.removeAttribute('data-pyn-pdf-orig');
          });
          return true;
        })();
      `);
    } catch {
      /* ignore */
    }
    // 2й restore через 200ms — на случай если React re-render между 1м
    // restore и сейчас вернул stripped версию.
    setTimeout(() => {
      win.webContents
        .executeJavaScript(`
          (() => {
            document.querySelectorAll('[data-pyn-pdf-orig]').forEach((el) => {
              const orig = el.getAttribute('data-pyn-pdf-orig');
              if (orig !== null) el.setAttribute('class', orig);
              el.removeAttribute('data-pyn-pdf-orig');
            });
            return true;
          })();
        `)
        .catch(() => undefined);
    }, 200);
    try {
      win.setBackgroundColor(prevBg);
    } catch {
      /* ignore */
    }
    // Сброс print-эмуляции → экран снова в обычном (screen) виде + detach.
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { media: '' });
    } catch {
      /* ignore */
    }
    try {
      if (dbgAttached) dbg.detach();
    } catch {
      /* ignore */
    }
    // Заглушку убираем ПОСЛЕДНЕЙ, с небольшой задержкой (>200ms 2-го restore) —
    // чтобы экран успел вернуться в обычный вид ПОД ней, без обратного мелькания.
    setTimeout(() => {
      try {
        if (cover && !cover.isDestroyed()) cover.close();
      } catch {
        /* ignore */
      }
    }, 280);
  }
}

/** TTL для временных print-PDF (мс) — после удаляем файл. 2 минуты юзеру
 *  с запасом хватит чтобы выбрать принтер и отправить на печать. */
const PRINT_TMP_TTL_MS = 120_000;

/** Уникальный путь в папке (без перезаписи): «name.pdf», «name (1).pdf», … */
function uniquePdfPath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.pdf`);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i}).pdf`);
    i += 1;
  }
  return candidate;
}

/** Schedule удаления tmp-файла через TTL. */
function schedulePrintCleanup(filePath: string): void {
  setTimeout(async () => {
    try {
      await rm(filePath, { force: true });
    } catch {
      /* файл может быть уже удалён системой — ignore */
    }
  }, PRINT_TMP_TTL_MS).unref();
}

/** Очистка стоп-файлов на старте — мало ли остались с прошлого запуска. */
async function cleanupStaleTmpPdfs(): Promise<void> {
  try {
    const { readdir } = await import('node:fs/promises');
    const dir = os.tmpdir();
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith('pyn-print-') && f.endsWith('.pdf')) {
        await rm(path.join(dir, f), { force: true });
      }
    }
  } catch {
    /* tmpdir недоступен — bail */
  }
}

export function setupPrintBridge(): void {
  // Стартовая очистка stale-файлов от предыдущих сессий.
  void cleanupStaleTmpPdfs();

  /**
   * Print dialog — генерит PDF тем же путём что Save PDF, открывает в
   * системном PDF-viewer (Preview на Mac, Adobe / Edge / etc на Win).
   * Юзер жмёт Cmd+P в viewer и печатает. Файл удаляется через 2 минуты.
   *
   * Так PDF и при сохранении, и при печати идёт через одну codepath —
   * выглядит идентично, никаких разных рамок / шрифтов / margin'ов.
   */
  ipcMain.handle(
    'pyn:print:dialog',
    async (
      _evt,
      defaultName?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      const win = targetWindow();
      if (!win || win.isDestroyed()) {
        return { ok: false, error: 'no_window' };
      }
      try {
        const safeName = (defaultName || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
        const tmpPath = path.join(
          os.tmpdir(),
          `pyn-print-${Date.now()}-${safeName}.pdf`,
        );
        const pdfBuf = await withTransparentRoot(win, () =>
          win.webContents.printToPDF(PDF_OPTIONS),
        );
        await writeFile(tmpPath, pdfBuf);
        // Загружаем PDF в hidden BrowserWindow (Chromium PDFium viewer),
        // далее `webContents.print({ silent: false })` открывает системный
        // print dialog СРАЗУ — никакого Preview / Cmd+P не требуется.
        // Hidden окно закрывается после печати (или отмены).
        const printWin = new BrowserWindow({
          show: false,
          width: 1,
          height: 1,
          webPreferences: {
            offscreen: false,
            sandbox: false,
            plugins: true, // PDFium для рендера PDF
          },
        });
        try {
          await printWin.loadFile(tmpPath);
          // Дать PDFium время отрендерить PDF (иначе print с пустым контентом)
          await new Promise((r) => setTimeout(r, 600));
          await new Promise<void>((resolve) => {
            printWin.webContents.print(
              { silent: false, printBackground: true, color: true },
              () => resolve(), // success / cancel — оба ok, нам важно только что dialog показали
            );
          });
        } finally {
          try {
            printWin.close();
          } catch {
            /* ignore */
          }
        }
        schedulePrintCleanup(tmpPath);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Очистка stale-tmp при выходе приложения тоже.
  app.on('before-quit', () => {
    void cleanupStaleTmpPdfs();
  });

  /**
   * Скачать график как PDF — СРАЗУ в системную папку «Загрузки» (без диалога,
   * стандартное поведение «скачать»). Имя уникализируем, чтобы не перезаписать
   * существующий файл. withTransparentRoot снимает тёмный фон на время генерации.
   *
   * @param defaultName — имя файла без .pdf. Renderer передаёт «График … Май 2026».
   */
  ipcMain.handle(
    'pyn:print:save-pdf',
    async (
      _evt,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }> => {
      const win = targetWindow();
      if (!win || win.isDestroyed()) {
        return { ok: false, error: 'no_window' };
      }
      const safeName = (defaultName || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      try {
        const filePath = uniquePdfPath(app.getPath('downloads'), safeName);
        const pdfBuf = await withTransparentRoot(win, () =>
          win.webContents.printToPDF(PDF_OPTIONS),
        );
        await writeFile(filePath, pdfBuf);
        return { ok: true, path: filePath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
