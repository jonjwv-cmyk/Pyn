/**
 * Извлечение списка соавторов (collaborators) из embedded Google Sheets
 * webview. Google рендерит presence-avatars в titlebar (мы её CSS-маской
 * прячем визуально, но DOM остаётся). Селекторы Google переименовываются
 * редко, но fallback на несколько вариантов.
 *
 * Возвращаемый JS-снаффер собирает массив `{name, anonymous}` для каждого
 * присутствующего юзера. Имя берётся из `data-tooltip` / aria-label / alt
 * — Google пишет туда либо email, либо «Анонимный …». Это даёт нам сразу
 * читаемое имя без дополнительных запросов.
 */

export const SHEETS_PRESENCE_SCRIPT = `
(function pynExtractPresence() {
  try {
    // Несколько селекторов — у Google разные поколения DOM-разметки.
    var nodes = document.querySelectorAll(
      '[data-presence-uid], .docs-presence-avatar, .docs-titlebar-padding [data-tooltip]'
    );
    var seen = new Set();
    var out = [];
    nodes.forEach(function(n) {
      var label =
        n.getAttribute('data-tooltip') ||
        n.getAttribute('aria-label') ||
        n.getAttribute('alt') ||
        '';
      label = (label || '').trim();
      if (!label) return;
      if (seen.has(label)) return;
      seen.add(label);
      var lc = label.toLowerCase();
      var anonymous =
        lc.indexOf('аноним') !== -1 ||
        lc.indexOf('anonymous') !== -1 ||
        lc.indexOf('гост') !== -1 ||
        lc.indexOf('guest') !== -1;
      out.push({ name: label, anonymous: anonymous });
    });
    return out;
  } catch (e) {
    return [];
  }
})();
`;

export interface PresenceMember {
  name: string;
  anonymous: boolean;
}
