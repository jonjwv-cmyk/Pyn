/**
 * Smooth switch активной вкладки в Google Sheets через synthetic-click
 * на родной tab-элемент. Это правильный способ — Google переключает
 * grid через свой internal router, никакого reload страницы.
 *
 * Hash navigation (`window.location.hash = '#gid=N'`) у Google Sheets
 * НЕ триггерит swap — их router читает gid только на initial load.
 *
 * Tab-bar мы скрываем `position:absolute; top:-10000px` (см. sheets-mask.ts),
 * поэтому DOM-элементы tab'ов живы и принимают clicks.
 *
 * Реализация переживает разные поколения DOM-разметки Google:
 *   • `data-id` attr на `.docs-sheet-tab` (стабильно).
 *   • Fallback на `[aria-label*="<gid>"]` + scan по `gid` в attributes.
 */
export function buildSwitchTabScript(gid: number): string {
  return `
    (function pynSwitchTab() {
      try {
        var GID = ${gid};
        // 1) Прямой селектор по data-id (большинство версий Sheets).
        var tab = document.querySelector('.docs-sheet-tab[data-id="' + GID + '"]');
        if (!tab) tab = document.querySelector('[data-id="' + GID + '"][role="tab"]');
        if (!tab) tab = document.querySelector('[data-sheet-id="' + GID + '"]');
        // 2) Fallback — пробежать по всем tab-кнопкам и найти ту что
        //    имеет gid в href/onclick. Это самый медленный путь но safety net.
        if (!tab) {
          var all = document.querySelectorAll('[role="tab"], .docs-sheet-tab, [class*="sheet-tab"]');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var attrs = el.getAttributeNames ? el.getAttributeNames() : [];
            for (var j = 0; j < attrs.length; j++) {
              if ((el.getAttribute(attrs[j]) || '').indexOf(String(GID)) !== -1) {
                tab = el;
                break;
              }
            }
            if (tab) break;
          }
        }
        if (!tab) return { ok: false, reason: 'tab_not_found' };
        // 3) Sequence of events чтобы Google гарантированно подхватил.
        //    Иногда .click() недостаточно (Sheets слушает mousedown+mouseup).
        var rect = tab.getBoundingClientRect();
        var opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left, clientY: rect.top };
        tab.dispatchEvent(new MouseEvent('mousedown', opts));
        tab.dispatchEvent(new MouseEvent('mouseup', opts));
        tab.dispatchEvent(new MouseEvent('click', opts));
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 200) };
      }
    })();
  `;
}
