import { app, ipcMain, shell } from 'electron';
import { copyFile, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Storage SMB-проводник. Pyn — UI обёртка над сетевой папкой
 * `\\fs1\Exchange\00000899 - Экспедиция\`. Все операции (list/open/delete/
 * upload/mkdir) под этим root'ом, никаких escape вне whitelist'а.
 *
 * Win-only: UNC paths резолвятся через Windows networking, используют
 * current domain identity. На Mac возвращаем `platform_not_supported`.
 */

const ROOT_UNC = '\\\\fs1\\Exchange\\00000899 - Экспедиция';

function isInsideRoot(p: string): boolean {
  if (!p) return false;
  // Нормализуем backslashes и проверяем prefix
  const normalized = p.replace(/\//g, '\\');
  return normalized.toLowerCase().startsWith(ROOT_UNC.toLowerCase());
}

export interface FsEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  fullPath: string;
}

/**
 * §pyn-1.2.43→1.2.50 — уникальный путь в destDir для basename, в стиле
 * Windows Explorer:
 *   `file.xlsm` → `file - копия.xlsm` → `file - копия 1.xlsm` → `... 2.xlsm`
 *
 * Используется для copy/move при коллизии. Если оригинал уже имеет суффикс
 * `- копия` / `- копия N` — берётся base без него и нумерация продолжается.
 */
async function uniqueDestPath(destDir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;

  // Если файл с originalName не существует — отдаём его.
  let candidate = path.join(destDir, baseName);
  try {
    await stat(candidate);
  } catch {
    return candidate;
  }

  // Базовый stem без существующего «- копия [N]» suffix'а.
  const baseStem = stem.replace(/ - копия( \d+)?$/, '');

  // Первая попытка — `<base> - копия<ext>`.
  candidate = path.join(destDir, `${baseStem} - копия${ext}`);
  try {
    await stat(candidate);
  } catch {
    return candidate;
  }

  // `- копия` тоже занят — нумеруем `- копия 1`, `- копия 2`, ...
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(destDir, `${baseStem} - копия ${i}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  return candidate;
}

async function listDir(dirPath: string): Promise<FsEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: FsEntry[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      const st = await stat(fullPath);
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: st.size,
        mtime: st.mtimeMs,
        fullPath,
      });
    } catch {
      /* недоступные файлы пропускаем (broken symlink, permission denied, etc) */
    }
  }
  // Папки первыми, потом по имени (numeric для «1.5.26», «2.5.26», «7.5.26»)
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru', { numeric: true });
  });
  return result;
}

export function setupFsBridge(): void {
  ipcMain.handle('pyn:fs:platform', () => ({
    platform: process.platform,
    supported: process.platform === 'win32',
    root: ROOT_UNC,
  }));

  ipcMain.handle(
    'pyn:fs:list',
    async (
      _evt,
      dirPath: string,
    ): Promise<{ ok: boolean; entries?: FsEntry[]; error?: string }> => {
      if (process.platform !== 'win32') {
        return { ok: false, error: 'platform_not_supported' };
      }
      const target = dirPath || ROOT_UNC;
      if (!isInsideRoot(target)) {
        return { ok: false, error: 'outside_root' };
      }
      try {
        const entries = await listDir(target);
        return { ok: true, entries };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'pyn:fs:open',
    async (_evt, filePath: string): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(filePath)) return { ok: false, error: 'outside_root' };
      try {
        const error = await shell.openPath(filePath);
        if (error) return { ok: false, error };
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'pyn:fs:reveal',
    async (_evt, filePath: string): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(filePath)) return { ok: false, error: 'outside_root' };
      try {
        shell.showItemInFolder(filePath);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  /**
   * §pyn-1.2.43 — delete: копия в OS Recycle Bin (`shell.trashItem` для
   * локальных путей; для SMB — копируем в локальную корзину рабочего стола
   * `%USERPROFILE%\Desktop\Pyn-trash\` и удаляем из SMB).
   *
   * Background: SMB-shares bypass Windows Recycle Bin при rm. Поэтому
   * сценарий «удалить файл из сетевой папки» = сначала сохранить копию
   * в локальной folder на рабочем столе (юзеру видимая), потом rm из SMB.
   * Юзер: «удаление перемещает к корзину на рабочем столе и удаляет из
   * сетевой папки».
   */
  ipcMain.handle(
    'pyn:fs:delete',
    async (
      _evt,
      targetPath: string,
    ): Promise<{ ok: boolean; trashPath?: string; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(targetPath)) return { ok: false, error: 'outside_root' };
      const normalizedTarget = path.normalize(targetPath).toLowerCase();
      const normalizedRoot = path.normalize(ROOT_UNC).toLowerCase();
      if (normalizedTarget === normalizedRoot) {
        return { ok: false, error: 'cannot_delete_root' };
      }
      try {
        // Desktop\Pyn-trash\ — видимая папка для юзера, как «корзина».
        const desktop = app.getPath('desktop');
        const trashDir = path.join(desktop, 'Pyn-trash');
        await mkdir(trashDir, { recursive: true });

        // §pyn-1.2.45 — без timestamp prefix'а. Имя в trash = original. При
        // коллизии добавляем suffix ` (N)`. Раньше timestamp давал уродливое
        // имя `2026-05-24T00-17-46-403Z__Новая папка` на рабочем столе.
        const baseName = path.basename(targetPath);
        const trashPath = await uniqueDestPath(trashDir, baseName);

        // 1. Копия в локальную trash на рабочем столе.
        const st = await stat(targetPath);
        if (st.isDirectory()) {
          await cp(targetPath, trashPath, { recursive: true, force: false });
        } else {
          await copyFile(targetPath, trashPath);
        }

        // 2. Удаление из SMB. Если copy fail — rm не вызывается → файл сохранён.
        await rm(targetPath, { recursive: true, force: false });

        return { ok: true, trashPath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  /**
   * §pyn-1.2.43 — copy: source (within root) → destDir (within root).
   * destDir обязан быть директорией. Имя файла берётся из source basename.
   * Если файл с тем же именем существует — добавляем suffix « (1)», « (2)».
   */
  ipcMain.handle(
    'pyn:fs:copy',
    async (
      _evt,
      srcPath: string,
      destDir: string,
    ): Promise<{ ok: boolean; newPath?: string; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(srcPath) || !isInsideRoot(destDir)) {
        return { ok: false, error: 'outside_root' };
      }
      try {
        const baseName = path.basename(srcPath);
        const newPath = await uniqueDestPath(destDir, baseName);
        const st = await stat(srcPath);
        if (st.isDirectory()) {
          await cp(srcPath, newPath, { recursive: true, force: false });
        } else {
          await copyFile(srcPath, newPath);
        }
        return { ok: true, newPath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  /**
   * §pyn-1.2.43 — move/cut: source → destDir/<basename(source)>. Если внутри
   * SMB — `rename` work'ает (atomic). Если cross-mount — fallback на cp+rm.
   */
  ipcMain.handle(
    'pyn:fs:move',
    async (
      _evt,
      srcPath: string,
      destDir: string,
    ): Promise<{ ok: boolean; newPath?: string; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(srcPath) || !isInsideRoot(destDir)) {
        return { ok: false, error: 'outside_root' };
      }
      try {
        const baseName = path.basename(srcPath);
        const newPath = await uniqueDestPath(destDir, baseName);
        try {
          await rename(srcPath, newPath);
        } catch (renameErr) {
          // Cross-device move — fallback cp + rm.
          const st = await stat(srcPath);
          if (st.isDirectory()) {
            await cp(srcPath, newPath, { recursive: true, force: false });
          } else {
            await copyFile(srcPath, newPath);
          }
          await rm(srcPath, { recursive: true, force: false });
          // Log rename err for diagnostic.
          console.warn('[pyn:fs:move] rename failed, fallback cp+rm:', renameErr);
        }
        return { ok: true, newPath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'pyn:fs:upload',
    async (
      _evt,
      srcPath: string,
      destDir: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(destDir)) return { ok: false, error: 'outside_root' };
      try {
        const fileName = path.basename(srcPath);
        const destPath = path.join(destDir, fileName);
        await copyFile(srcPath, destPath);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  /**
   * §pyn-1.2.21 — rename file/folder. UI разрешает только для раздела
   * «Подготовка» (не для шаблонов/согласований/рассылки — там read-only).
   * Backend проверяет лишь whitelist root + sanity name; UI gating —
   * не security boundary, но удобный helper.
   */
  ipcMain.handle(
    'pyn:fs:rename',
    async (
      _evt,
      oldPath: string,
      newName: string,
    ): Promise<{ ok: boolean; newPath?: string; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(oldPath)) return { ok: false, error: 'outside_root' };
      if (!newName || /[\\/:*?"<>|]/.test(newName) || newName === '.' || newName === '..') {
        return { ok: false, error: 'invalid_name' };
      }
      try {
        const parent = path.dirname(oldPath);
        const newPath = path.join(parent, newName);
        if (newPath.toLowerCase() === oldPath.toLowerCase()) {
          return { ok: true, newPath: oldPath };
        }
        await rename(oldPath, newPath);
        return { ok: true, newPath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'pyn:fs:mkdir',
    async (
      _evt,
      parentDir: string,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (process.platform !== 'win32') return { ok: false, error: 'platform_not_supported' };
      if (!isInsideRoot(parentDir)) return { ok: false, error: 'outside_root' };
      // sanity на имя — без слешей и спец-символов чтобы не выйти за пределы parent
      if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
        return { ok: false, error: 'invalid_name' };
      }
      try {
        const newDir = path.join(parentDir, name);
        await mkdir(newDir);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
