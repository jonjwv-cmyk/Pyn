import { ipcMain } from 'electron';
import { configureBridge } from '../network/bridge';

/**
 * IPC мост для Google-bridge. Renderer после get_client_config передаёт
 * `config.bridge = { url, ticket }` сюда; main применяет PAC к партишену
 * Google-таблиц (только если обнаружен корп-прокси). См. `network/bridge`.
 */
export function setupBridgeBridge(): void {
  ipcMain.handle('pyn:bridge:configure', async (_evt, url: unknown, ticket: unknown): Promise<boolean> => {
    if (typeof url !== 'string' || typeof ticket !== 'string') return false;
    return configureBridge(url, ticket);
  });
}
