import { BrowserWindow, ipcMain } from 'electron';
import type { WsServerEvent } from '@pyn/core';
import { onWsEvent, sendEvent, startWs, stopWs } from '../ws/ws-client';
import { getProxyState } from './api-bridge';

/**
 * IPC мост для WS клиента:
 *
 *   pyn:ws:start (login, token) — start (или re-init с новыми creds)
 *   pyn:ws:stop                 — close + don't reconnect
 *   pyn:ws:send  (payload)      — encrypt + send outgoing frame (presence/typing/…)
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
    // Proxy state определён в api-bridge на старте app. Передаём в WS-клиент:
    // в proxy-mode он подключается через HTTP CONNECT к sslip.io URL,
    // в direct mode — на api.otlhelper.com с SPKI pin.
    const proxy = getProxyState();
    startWs(login, token, proxy);
  });

  ipcMain.handle('pyn:ws:stop', async (): Promise<void> => {
    stopWs();
  });

  ipcMain.handle('pyn:ws:send', async (_evt, payload: unknown): Promise<void> => {
    if (payload === null || typeof payload !== 'object') {
      throw new Error('invalid_ws_payload');
    }
    sendEvent(payload as object);
  });

  onWsEvent((event: WsServerEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('pyn:ws:event', event);
    }
  });
}
