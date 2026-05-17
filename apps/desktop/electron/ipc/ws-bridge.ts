import { BrowserWindow, ipcMain } from 'electron';
import type { WsServerEvent } from '@pyn/core';
import { onWsEvent, startWs, stopWs } from '../ws/ws-client';

/**
 * IPC мост для WS клиента:
 *
 *   pyn:ws:start (login, token) — start (или re-init с новыми creds)
 *   pyn:ws:stop                 — close + don't reconnect
 *
 * События с сервера летят renderer'у через `webContents.send('pyn:ws:event', ...)`.
 * Слушаем через onWsEvent один раз и форвардим во все открытые окна.
 *
 * 🔴 setupWsBridge() вызывается один раз при app.whenReady() — не повторно.
 */
export function setupWsBridge(): void {
  ipcMain.handle('pyn:ws:start', async (_evt, login: string, token: string): Promise<void> => {
    if (typeof login !== 'string' || typeof token !== 'string' || !login || !token) {
      throw new Error('invalid_ws_creds');
    }
    startWs(login, token);
  });

  ipcMain.handle('pyn:ws:stop', async (): Promise<void> => {
    stopWs();
  });

  onWsEvent((event: WsServerEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('pyn:ws:event', event);
    }
  });
}
