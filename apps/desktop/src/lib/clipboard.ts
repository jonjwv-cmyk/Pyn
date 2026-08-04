/**
 * Буфер обмена приложения: сначала нативный Electron-буфер (main process),
 * затем `navigator.clipboard` как fallback.
 *
 * Зачем такой порядок: async Clipboard API требует secure-context, разрешения
 * `clipboard-sanitized-write`/`clipboard-read` и сфокусированного документа. На
 * Windows эти условия ломаются (окно без нативного меню, фокус мог уйти в
 * `<webview>`) — `writeText()` падает с NotAllowedError, и копирование ячеек
 * Транспорта не работало вообще, даже внутри приложения. У нативного буфера
 * этих ограничений нет; fallback оставлен для браузерного dev-режима.
 *
 * Ошибку не глотаем: вызывающий код показывает пользователю, что не вышло.
 */

export async function copyText(text: string): Promise<void> {
  const native = window.pyn?.clipboard;
  if (native) {
    try {
      if (await native.write(text)) return;
    } catch {
      /* падаем в navigator-ветку ниже */
    }
  }
  await navigator.clipboard.writeText(text);
}

export async function readClipboardText(): Promise<string> {
  const native = window.pyn?.clipboard;
  if (native) {
    try {
      return await native.read();
    } catch {
      /* падаем в navigator-ветку ниже */
    }
  }
  return navigator.clipboard.readText();
}
