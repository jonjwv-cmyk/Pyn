import { ipcMain } from 'electron';

export interface TrayActions {
  showMainWindow: () => void;
  openSettings: () => void;
  quit: () => void;
  hideMenu: () => void;
}

/**
 * Tray menu actions IPC. Custom React menu (rounded UI) шлёт через
 * `window.pyn.tray.*` сюда; main process выполняет действие над окном /
 * жизненным циклом приложения.
 */
export function setupTrayBridge(actions: TrayActions): void {
  ipcMain.handle('pyn:tray:show', () => {
    actions.hideMenu();
    actions.showMainWindow();
  });
  ipcMain.handle('pyn:tray:settings', () => {
    actions.hideMenu();
    actions.openSettings();
  });
  ipcMain.handle('pyn:tray:quit', () => {
    actions.hideMenu();
    actions.quit();
  });
  ipcMain.handle('pyn:tray:close-menu', () => {
    actions.hideMenu();
  });
}
