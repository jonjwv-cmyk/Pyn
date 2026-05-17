import { ipcMain } from 'electron';
import { clearAllCache, clearCache, loadCache, saveCache } from '../storage/cache-store';

/**
 * IPC bridge для Zustand persist storage в renderer'е.
 *
 *   pyn:cache:load(name) → string | null
 *   pyn:cache:save(name, value)
 *   pyn:cache:clear(name)
 *   pyn:cache:clearAll  (на logout)
 */
export function setupCacheBridge(): void {
  ipcMain.handle('pyn:cache:load', async (_evt, name: string): Promise<string | null> => {
    if (typeof name !== 'string' || name.length === 0) return null;
    return loadCache(name);
  });

  ipcMain.handle('pyn:cache:save', async (_evt, name: string, value: string): Promise<void> => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('invalid_cache_name');
    }
    if (typeof value !== 'string') {
      throw new Error('invalid_cache_value');
    }
    await saveCache(name, value);
  });

  ipcMain.handle('pyn:cache:clear', async (_evt, name: string): Promise<void> => {
    if (typeof name !== 'string' || name.length === 0) return;
    await clearCache(name);
  });

  ipcMain.handle('pyn:cache:clearAll', async (): Promise<void> => {
    await clearAllCache();
  });
}
