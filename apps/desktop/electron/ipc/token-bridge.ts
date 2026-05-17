import { ipcMain } from 'electron';
import type { Session } from '@pyn/core';
import { clearSession, loadSession, saveSession } from '../storage/token-store';

/**
 * IPC мост для persisted session storage.
 *
 *   pyn:token:load  → Session | null
 *   pyn:token:save  → void   (renderer передаёт Session)
 *   pyn:token:clear → void
 *
 * Renderer не имеет прямого доступа к файлу / safeStorage — всё через main.
 * Это гарантирует:
 *   • token не светится в browser-side storage (IndexedDB/localStorage),
 *   • XSS не может вынуть token напрямую (если когда-то откроем внешний контент),
 *   • OS-keystore unlock на старте app только в main process.
 */
export function setupTokenBridge(): void {
  ipcMain.handle('pyn:token:load', async (): Promise<Session | null> => {
    return loadSession();
  });

  ipcMain.handle('pyn:token:save', async (_evt, session: Session): Promise<void> => {
    if (!session || typeof session.token !== 'string' || session.token.length === 0) {
      throw new Error('invalid_session');
    }
    await saveSession(session);
  });

  ipcMain.handle('pyn:token:clear', async (): Promise<void> => {
    await clearSession();
  });
}
