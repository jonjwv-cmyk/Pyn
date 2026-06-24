import { ipcMain } from 'electron';
import { configureBridge } from '../network/bridge';
import { refreshMapTileProxy } from '../network/map-tiles';

/**
 * IPC мост для Google-bridge. Renderer после get_client_config передаёт
 * `config.bridge = { url, ticket }` сюда; main применяет PAC к партишену
 * Google-таблиц (только если обнаружен корп-прокси). См. `network/bridge`.
 */
export function setupBridgeBridge(): void {
  ipcMain.handle('pyn:bridge:configure', async (_evt, url: unknown, ticket: unknown): Promise<boolean> => {
    if (typeof url !== 'string' || typeof ticket !== 'string') return false;
    const enabled = await configureBridge(url, ticket);
    // Карта тоже тянет спутник Google через релей — перенастраиваем её тайл-сессию.
    refreshMapTileProxy();
    return enabled;
  });
}
