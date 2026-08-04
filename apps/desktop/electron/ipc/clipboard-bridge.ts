import { clipboard, ipcMain } from 'electron';

/**
 * IPC мост к нативному буферу обмена.
 *
 * Зачем не `navigator.clipboard` в рендерере: async Clipboard API требует
 * secure-context + `clipboard-sanitized-write` + сфокусированный документ. На
 * Windows это регулярно не выполняется (окно без нативного меню, фокус ушёл в
 * `<webview>`), и `writeText()` тихо падает с NotAllowedError — копирование
 * ячеек Транспорта не работало вообще, даже внутри приложения. Нативный
 * `clipboard` в main-процессе этих ограничений не имеет.
 */
export function setupClipboardBridge(): void {
  ipcMain.handle('pyn:clipboard:write', (_evt, text: unknown): boolean => {
    if (typeof text !== 'string') return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('pyn:clipboard:read', (): string => clipboard.readText());
}
