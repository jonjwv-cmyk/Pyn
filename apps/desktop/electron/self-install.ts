import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const INSTALL_DIR_NAME = 'app';
const INSTALLED_EXE_NAME = 'Pyn.exe';
const DESKTOP_SHORTCUT_NAME = 'Pyn.lnk';

/**
 * Путь куда Pyn копирует себя на первом запуске (Win-only).
 *   %APPDATA%\@pyn\desktop\app\Pyn.exe
 */
export function getInstalledExePath(): string {
  return path.join(app.getPath('userData'), INSTALL_DIR_NAME, INSTALLED_EXE_NAME);
}

/**
 * Запущены ли мы уже из installed location. Если да — selfInstall no-op.
 */
export function isRunningFromInstalled(): boolean {
  if (process.platform !== 'win32') return true;
  const installed = getInstalledExePath();
  return (
    path.normalize(process.execPath).toLowerCase()
    === path.normalize(installed).toLowerCase()
  );
}

/**
 * §pyn-1.2.15 — self-install для portable Win .exe.
 *
 * Flow:
 *   1. Юзер качает Pyn.exe в Downloads (или shared folder сети)
 *   2. Запускает Pyn.exe — Pyn копирует себя в %APPDATA%\@pyn\desktop\app\Pyn.exe
 *   3. Создаёт ярлык на десктопе указывающий на installed copy
 *   4. Юзер может удалить Downloads\Pyn.exe — ярлык продолжает работать
 *
 * Auto-update (см. update-bridge.ts) тоже заменяет именно installed copy,
 * не downloaded — ярлык всегда указывает на правильный path.
 *
 * Windows-only. Mac DMG / Linux AppImage — другой distribution pattern.
 */
export function selfInstallIfNeeded(): void {
  if (process.platform !== 'win32') return;

  try {
    const currentExe = process.execPath;
    const installedExe = getInstalledExePath();
    const installDir = path.dirname(installedExe);

    // Уже запущены из installed location — никаких изменений.
    if (isRunningFromInstalled()) {
      console.log('[self-install] running from installed location, no-op');
      return;
    }

    // Создаём install dir если нет.
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
      console.log(`[self-install] created install dir: ${installDir}`);
    }

    // Копируем exe в installed location.
    if (!fs.existsSync(installedExe)) {
      console.log(`[self-install] copying ${currentExe} → ${installedExe}`);
      fs.copyFileSync(currentExe, installedExe);
      console.log('[self-install] copy done');
    } else {
      console.log('[self-install] installed copy already exists, skipping copy');
    }

    // Создаём desktop shortcut.
    const desktopPath = app.getPath('desktop');
    const shortcutPath = path.join(desktopPath, DESKTOP_SHORTCUT_NAME);
    if (!fs.existsSync(shortcutPath)) {
      const ok = shell.writeShortcutLink(shortcutPath, 'create', {
        target: installedExe,
        description: 'Pyn',
        icon: installedExe,
        iconIndex: 0,
      });
      console.log(`[self-install] desktop shortcut: ${ok ? 'created' : 'failed'}`);
    } else {
      console.log('[self-install] desktop shortcut already exists');
    }
  } catch (err) {
    console.error('[self-install] failed:', err);
  }
}
