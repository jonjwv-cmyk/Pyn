import { ipcMain } from 'electron';
import { scheduleRelaunchAfterWipe, wipeAllUserData } from '../storage/app-lock-wipe';

/**
 * IPC мост для kill switch / app lock:
 *
 *   pyn:app-lock:wipe → void — стирает весь userData + relaunch'ит app
 *
 * Renderer не имеет прямого доступа к fs — wipe изолирован в main process,
 * чтобы renderer не мог fire-and-forget удалить userData без явного
 * server-triggered события.
 *
 * Note: device_id хранится в `userData/cache/device_id.bin` (через
 * generic encrypted cache, см. apps/desktop/src/lib/device.ts). При wipe
 * cache/-папка удаляется вместе со всем остальным userData, новый device_id
 * сгенерируется естественно при next запуске через initDeviceId().
 */
export function setupAppLockBridge(): void {
  ipcMain.handle('pyn:app-lock:wipe', async (): Promise<void> => {
    await wipeAllUserData();
    scheduleRelaunchAfterWipe();
  });
}
