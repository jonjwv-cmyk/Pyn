import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP_EXE_NAME = 'Pyn.exe';

/**
 * §pyn-1.2.26 — distribution model упрощён.
 *
 * Раньше: portable .exe запускался → копировался в `%APPDATA%\@pyn\desktop\app\`
 * → создавался ярлык на Desktop → ярлык запускал installed copy. На практике
 * Касперский ломал portable extract installed exe → ffmpeg.dll error → ярлык
 * не работал, юзер открывал downloaded exe вручную.
 *
 * Сейчас: Pyn = просто .exe на рабочем столе. Update flow (update-bridge.ts)
 * скачивает свежий exe сразу в `%USERPROFILE%\Desktop\Pyn.exe`, заменяя
 * старый. Self-install здесь делает только:
 *   1. Cleanup orphaned `%LOCALAPPDATA%\Pyn-portable-*` (corrupt extracts).
 *   2. При первом запуске из не-Desktop места (Downloads) → copy себя на
 *      Desktop\Pyn.exe (если там пусто). Юзер сразу видит Pyn на Desktop
 *      и может удалить originals из Downloads.
 *
 * Никаких installed copy / shortcut creation / shortcut revalidation.
 */
export function selfInstallIfNeeded(): void {
  if (process.platform !== 'win32') return;

  try {
    cleanupStalePortableDirs();
    // §pyn-1.2.54 — ensureDesktopExeOnFirstRun убран. Update flow теперь
    // сам скачивает свежий exe на Desktop с именем `Pyn <version>.exe`
    // (см. update-bridge.ts), и старый удаляет через --remove-prev arg.
    // Первый запуск из Downloads — юзер сам запускает / перемещает.
  } catch (err) {
    console.error('[self-install] failed:', err);
  }
}

/**
 * Удаляем все `%LOCALAPPDATA%\Pyn-portable-*` — extract-папки portable
 * wrapper'а от предыдущих exe. Текущий процесс держит свой extract залоченным,
 * rmSync такие пропускает. Это решает `ffmpeg.dll not found` когда extract
 * corrupt после прерванного Касперским запуска.
 */
function cleanupStalePortableDirs(): void {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return;
    const entries = fs.readdirSync(localAppData, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!e.name.startsWith('Pyn-portable-')) continue;
      const full = path.join(localAppData, e.name);
      try {
        fs.rmSync(full, { recursive: true, force: true });
        console.log(`[self-install] cleaned stale portable dir: ${e.name}`);
      } catch {
        // Locked → это наш активный extract либо antivirus scan. Пропускаем.
      }
    }
  } catch (err) {
    console.warn('[self-install] portable cleanup error:', err);
  }
}

/**
 * Если Pyn запущен НЕ с Desktop и Desktop\Pyn.exe не существует —
 * скопировать сюда. Юзер скачал в Downloads, кликнул → теперь Pyn также
 * на Desktop, может удалить Downloads-копию. Update flow дальше держит
 * Desktop\Pyn.exe актуальным.
 *
 * Если Desktop\Pyn.exe УЖЕ есть (даже устаревший) — не перезаписываем:
 * перезапись это работа update-bridge, и она происходит с taskkill, иначе
 * file-locked.
 */
function ensureDesktopExeOnFirstRun(): void {
  const desktop = app.getPath('desktop');
  const desktopExe = path.join(desktop, DESKTOP_EXE_NAME);
  const currentExe = process.execPath;

  if (
    path.normalize(currentExe).toLowerCase()
    === path.normalize(desktopExe).toLowerCase()
  ) {
    return;
  }

  if (fs.existsSync(desktopExe)) {
    return;
  }

  try {
    fs.copyFileSync(currentExe, desktopExe);
    console.log(`[self-install] copied to desktop: ${desktopExe}`);
  } catch (err) {
    console.error('[self-install] desktop copy failed:', err);
  }
}
