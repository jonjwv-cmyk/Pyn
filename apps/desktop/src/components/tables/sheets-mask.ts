/**
 * Маска интерфейса Google Sheets для embedded webview.
 *
 * Стратегия:
 *   1. **Menubar** сворачиваем эмуляцией клика по нативной кнопке Google
 *      «Свернуть строку меню» (^). Google родным способом схлопывает шляпу
 *      и пересчитывает grid — без пустоты сверху. Поиск кнопки — каскад:
 *      (a) CSS-классы `.docs-toolbar-collapse-button`, `[class*="collapse"]`
 *      внутри titlebar/menubar-area; (b) substring-match по
 *      `aria-label` / `data-tooltip` / `title`.
 *      **ВАЖНО**: кнопку collapse прячем `data-pyn-hide` ТОЛЬКО ПОСЛЕ
 *      успешного клика. Иначе юзер не сможет свернуть вручную, если наш
 *      auto-click не нашёл цель.
 *   2. **Tab switch** для смены листа в той же таблице — через глобальную
 *      функцию `window.__pynSwitchSheet(gid)`. Внутри — клик по нативной
 *      tab-кнопке Google (`.docs-sheet-tab` / по id `sheet-button-<gid>`).
 *      Это даёт client-side switch как в браузере, без full reload.
 *      `location.hash` в Electron `<webview>` триггерит полный reload —
 *      непригоден.
 *   3. **Низ** (стрелки prev/next, ☰, +) — `data-pyn-hide` через
 *      классификацию по терминам в aria-label/tooltip/title + статичные
 *      CSS-классы как первая линия защиты.
 *   4. **Diagnostic** — глобальная `window.__pynSheetsInspect()` возвращает
 *      список кандидатов на «меню»/«лист» в DOM. Pyn-renderer её дёргает
 *      и показывает в toast (без необходимости открывать DevTools).
 *   5. **Строка формул** (поле имени + fx + поле формулы) — прячем НАТИВНО
 *      через «Вид → Показать → Строка формул» (как menubar, НЕ CSS): grid
 *      пересчитывается без пустого зазора, выбор Google запоминает между
 *      перезагрузками. Guardian возвращает скрытие, если Google восстановил
 *      панель после reload/смены листа. Остаётся только панель инструментов.
 */

export const SHEETS_MASK_STYLE_ID = 'pyn-sheets-mask';

const SHEETS_MASK_CSS = `
/* Universal flag для скрытых через JS элементов */
[data-pyn-hide] { display: none !important; }

/* Во время extraction Google-меню скрываем все potential dropdown'ы.
   Селекторы избыточны нарочно — Google использует разные имена в разных
   поколениях UI. */
body.pyn-menu-extracting [role="menu"],
body.pyn-menu-extracting [role="menubar"],
body.pyn-menu-extracting .docs-menu-current,
body.pyn-menu-extracting .docs-menu,
body.pyn-menu-extracting .docs-edit-menu,
body.pyn-menu-extracting .goog-menu,
body.pyn-menu-extracting [class*="docs-menu"],
body.pyn-menu-extracting [class*="popupmenu"],
body.pyn-menu-extracting [class*="menu-popup"],
body.pyn-menu-extracting [class*="menupopup"],
body.pyn-menu-extracting [class*="menu-content"],
body.pyn-menu-extracting [class*="menubar"] {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Нижний tab-bar: статичные классы Google как первая линия защиты */
.docs-sheet-tab-bar,
.docs-sheet-tab-bar-container,
.docs-sheet-bar,
.docs-bottom-tab-bar,
.docs-bottom-tabbar,
.waffle-sheet-tabbar,
.waffle-sheet-tab-bar,
.docs-sheet-tabs-container,
.docs-sheet-tab,
.docs-sheet-tab-container,
.docs-grid-bar-prev-button,
.docs-grid-bar-next-button,
.docs-grid-bar-toggle-button,
#docs-sheet-add-button,
.docs-grid-bar-add-button,
.docs-grid-bar-show-all-tabs-button,
.docs-sheet-show-all-tabs-button,
.waffle-sheet-list-toggle { display: none !important; }

/* Кнопки прокрутки листов влево/вправо и их полоса (.docs-sheet-button-bar).
   На холодной первой загрузке Google показывает их, пока не «уляжется»
   раскладка вкладок, и они залипают до первого переключения листа. Прячем
   сразу (вкладки Google и так скрыты — навигация по листам через пилюли Pyn). */
.docs-sheet-button-bar,
.docs-sheet-left-button,
.docs-sheet-right-button { display: none !important; }

/* Кнопка «Поиск по меню» (лупа слева от Отменить/Повторить). Стабильный id
   омнибокса Google — прячем сразу, без шанса мигнуть. JS-фолбэк по подписи
   («поиск»+«меню») — в shouldHide, на случай если Google переименует id. */
#docs-omnibox-toolbar { display: none !important; }
`;

export function buildSheetsMaskScript(): string {
  const safeCss = SHEETS_MASK_CSS.replace(/`/g, '\\`');
  return `
    (function pynSheetsMask() {
      try {
        var STYLE_ID = ${JSON.stringify(SHEETS_MASK_STYLE_ID)};
        var styleExists = !!document.getElementById(STYLE_ID);
        if (!styleExists) {
          var s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = \`${safeCss}\`;
          (document.head || document.documentElement).appendChild(s);
        }

        // §pyn-1.2.71 — идемпотентность бутстрапа. did-stop-loading стреляет
        // несколько раз за загрузку (auth-редирект, gid-hash, Boq/realtime), и
        // раньше весь IIFE гонялся каждый раз (DIAG-спам, повторный tryCollapse,
        // лишние setTimeout'ы). Тяжёлую часть — поиск кнопок, сворачивание меню,
        // разметку bottom-bar, guardian, window.__pyn*-функции — делаем ОДИН раз
        // на JS-контекст. Если стиль жив и бутстрап уже завершался → выходим
        // (no-op). Если DOM сброшен (стиль исчез) — он выше уже восстановлен, а
        // бутстрап прогоняем заново (вернёт сворачивание/разметку). Флаг ставится
        // в КОНЦЕ успешного прогона (см. низ try), чтобы сбой посреди не «залочил».
        if (window.__pynMaskBootstrapped && styleExists) return;

        var T = {
          menu: ['меню', 'menu', 'панель', 'controls', 'compact', 'strip', 'формата'],
          collapse: ['скры', 'свер', 'hide', 'collapse', 'compact'],
          expand: ['пока', 'разв', 'show', 'expand'],
          sheet: ['лист', 'sheet'],
          prev: ['предыдущ', 'previous', 'prev'],
          next: ['следующ', 'next'],
          all: ['все листы', 'all sheets', 'список листов', 'list of sheets', 'sheet list'],
          add: ['добав', 'add'],
        };

        function textOf(el) {
          return (
            ((el.getAttribute('aria-label') || '') + ' ' +
             (el.getAttribute('data-tooltip') || '') + ' ' +
             (el.getAttribute('title') || '')).toLowerCase()
          );
        }
        function hasAny(t, terms) {
          for (var i = 0; i < terms.length; i++) {
            if (t.indexOf(terms[i]) !== -1) return true;
          }
          return false;
        }

        /** Помечаем элементы которые нужно спрятать. Collapse/expand-меню
         *  кнопку НЕ трогаем — юзер должен иметь возможность вручную
         *  свернуть/развернуть, если наш auto-click не сработал. */
        function isInGridBar(el) {
          var parent = el;
          while (parent && parent !== document.body) {
            var cls = (parent.className || '').toString();
            if (cls.indexOf('docs-grid-bar') !== -1 ||
                cls.indexOf('docs-sheet-bar') !== -1 ||
                cls.indexOf('docs-bottom-tab') !== -1) return true;
            parent = parent.parentElement;
          }
          return false;
        }
        function shouldHide(el) {
          var t = textOf(el);
          // Кнопка «Поиск в меню» (лупа слева от Отменить/Повторить) — у Pyn
          // своя навигация по таблице, нативный поиск по меню не нужен.
          // Подпись: «Поиск в меню» (RU) / «Search the menus» (EN).
          if (t.indexOf('search the menus') !== -1 ||
              (t.indexOf('поиск') !== -1 && t.indexOf('меню') !== -1)) {
            return true;
          }
          var isSheet = hasAny(t, T.sheet);
          var isMenu = hasAny(t, T.menu);
          // Стрелка «Свернуть/Развернуть меню» — прячем после успешного
          // auto-collapse, иначе она торчит в правом углу таблицы.
          if (collapsed && isMenu && (hasAny(t, T.collapse) || hasAny(t, T.expand))) {
            return true;
          }
          // Стрелки prev/next листов — даже если в подписи нет слова "лист"
          // (новый UI Google'a), достаточно того что элемент внутри grid-bar.
          if ((hasAny(t, T.prev) || hasAny(t, T.next)) && (isSheet || isInGridBar(el))) {
            return true;
          }
          if (hasAny(t, T.all)) return true;
          // §v1.2.14 — Кнопку «Добавить строки» в инструменте Google
          // (input "N more rows" внизу grid'a) НЕ прячем — юзер просил
          // сохранить её. Раньше hide через add+sheet/grid срабатывал
          // ложно если кнопка попадала в grid-bar.
          var isRows = t.indexOf('строк') !== -1 || t.indexOf('row') !== -1;
          if (hasAny(t, T.add) && isRows) return false;
          // Add-sheet (+) кнопка — её прячем
          if (hasAny(t, T.add) && (isSheet || isInGridBar(el))) return true;
          return false;
        }
        function markHideables() {
          var all = document.querySelectorAll('[aria-label],[data-tooltip],[title]');
          for (var i = 0; i < all.length; i++) {
            if (shouldHide(all[i]) && !all[i].hasAttribute('data-pyn-hide')) {
              all[i].setAttribute('data-pyn-hide', '');
            }
          }
        }

        function findCollapseBtn() {
          // 1. По CSS-классам Google (если живы).
          var byClass = document.querySelector(
            '.docs-toolbar-collapse-button,' +
            '.docs-titlebar-collapse,' +
            '.menubar-collapse-button,' +
            '[class*="collapse-button"]'
          );
          if (byClass) return byClass;
          // 2. По substring-match aria-label/tooltip/title.
          var all = document.querySelectorAll('[aria-label],[data-tooltip],[title]');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var t = textOf(el);
            if (hasAny(t, T.menu) && hasAny(t, T.collapse)) return el;
          }
          // 3. Поиск по горячей клавише Ctrl+Shift+F (стандарт для compact mode).
          for (var j = 0; j < all.length; j++) {
            var el2 = all[j];
            var t2 = textOf(el2);
            if (t2.indexOf('ctrl+shift+f') !== -1 || t2.indexOf('shift+ctrl+f') !== -1) {
              // Differentiate: find/replace тоже Ctrl+Shift+F в Sheets. Но
              // compact-кнопка обычно в titlebar-area, а find/replace —
              // отдельный диалог. Проверка по доп. термину:
              if (hasAny(t2, T.menu) || hasAny(t2, T.collapse) || hasAny(t2, T.expand)) {
                return el2;
              }
            }
          }
          return null;
        }

        /**
         * Полная эмуляция клика — Google слушает mousedown/mouseup, .click()
         * на чистом DIV без tabindex не всегда срабатывает.
         */
        function clickDeeply(el) {
          var rect = el.getBoundingClientRect();
          var x = rect.left + rect.width / 2;
          var y = rect.top + rect.height / 2;
          try {
            el.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true, cancelable: true, view: window,
              clientX: x, clientY: y, button: 0,
            }));
            el.dispatchEvent(new MouseEvent('mouseup', {
              bubbles: true, cancelable: true, view: window,
              clientX: x, clientY: y, button: 0,
            }));
            el.dispatchEvent(new MouseEvent('click', {
              bubbles: true, cancelable: true, view: window,
              clientX: x, clientY: y, button: 0,
            }));
          } catch (_) {
            try { el.click(); } catch (__) {}
          }
        }

        function isMenubarVisible() {
          var mb = document.getElementById('docs-menubar') ||
                   document.querySelector('.docs-menubar,[role="menubar"]');
          if (!mb) return false;
          return mb.offsetWidth > 0 && mb.offsetHeight > 0;
        }

        /** Видна ли строка формул Google (поле имени + fx + ввод формулы).
         *  Селекторы избыточны нарочно — Google использует разные поколения
         *  id/классов. Используется ТОЛЬКО для идемпотентности (понять, нужно
         *  ли дёргать нативный тумблер). Само скрытие — через меню, не CSS. */
        function isFormulaBarVisible() {
          var nodes = document.querySelectorAll(
            '#t-formula-bar-input,#t-name-box,#docs-formula-bar,' +
            '.docs-formula-bar,.waffle-name-box'
          );
          for (var i = 0; i < nodes.length; i++) {
            var r = nodes[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return true;
          }
          return false;
        }

        function fireKeyboardShortcut() {
          // Ctrl+Shift+F — стандартный shortcut Google Sheets для compact-mode.
          var target = document.activeElement || document.body;
          ['keydown', 'keypress', 'keyup'].forEach(function (type) {
            try {
              target.dispatchEvent(new KeyboardEvent(type, {
                key: 'F', code: 'KeyF', keyCode: 70, which: 70,
                ctrlKey: true, shiftKey: true,
                bubbles: true, cancelable: true,
              }));
            } catch (_) {}
          });
        }

        var attempts = 0;
        var MAX_ATTEMPTS = 40; // ~10 сек
        var collapsed = false;

        function tryCollapse() {
          attempts++;
          if (collapsed) return;
          if (!isMenubarVisible()) {
            // Уже свёрнут (Google persistит state в cookies).
            collapsed = true;
            markHideables();
            console.log('[pyn:sheets-mask] menubar already collapsed');
            return;
          }
          var btn = findCollapseBtn();
          if (btn) {
            clickDeeply(btn);
            // Проверка через 300ms — если menubar всё ещё виден, пробуем
            // keyboard shortcut.
            setTimeout(function () {
              if (isMenubarVisible()) {
                fireKeyboardShortcut();
                setTimeout(function () {
                  if (!isMenubarVisible()) collapsed = true;
                  markHideables();
                  console.log('[pyn:sheets-mask] menubar collapse final, visible=' +
                    isMenubarVisible());
                }, 300);
              } else {
                collapsed = true;
                markHideables();
                console.log('[pyn:sheets-mask] menubar collapsed via click');
              }
            }, 300);
            return;
          }
          markHideables();
          if (attempts < MAX_ATTEMPTS) setTimeout(tryCollapse, 250);
        }
        tryCollapse();

        /**
         * §v1.2.14 — Guardian: каждую секунду перепроверяем что menubar
         * по-прежнему свёрнут. Google периодически «восстанавливает»
         * menubar при некоторых событиях (history navigation, hash change,
         * iframe reload, table-load-после-фильтра). Без guardian юзер
         * видит menubar и должен переключаться между листами чтобы
         * триггернуть mask injection заново. Guardian делает это
         * автоматически — silent, без console-spam.
         *
         * setInterval живёт всю жизнь webContents'a. Idempotent: если
         * menubar уже свёрнут — ничего не делает.
         */
        if (!window.__pynMaskGuardianStarted) {
          window.__pynMaskGuardianStarted = true;
          var guardianRunning = false;
          setInterval(function () {
            if (guardianRunning) return;
            // Не вмешиваемся пока идёт programmatic navigation (открытие
            // menu для action) — иначе guardian сорвёт _navigatePath.
            if (document.body.classList.contains('pyn-menu-extracting')) return;
            // Также не сворачиваем когда у Google открыто меню/подменю —
            // юзер мог пользоваться нативным menu для чего-то, что мы не
            // поддерживаем своими кнопками (Печать через нашу кнопку
            // отрабатывает без visible menu, но если юзер случайно открыл
            // menu — пусть закроет сам).
            if (visibleMenus().length > 0) return;
            // 1) Menubar свернулся обратно (history nav / hash / reload) —
            //    сворачиваем нативно. Приоритет над строкой формул.
            if (isMenubarVisible()) {
              guardianRunning = true;
              try {
                var btn = findCollapseBtn();
                if (btn) {
                  clickDeeply(btn);
                } else {
                  fireKeyboardShortcut();
                }
                markHideables();
              } catch (_) {
                // ignore
              } finally {
                guardianRunning = false;
              }
              return;
            }
            // 2) Menubar свёрнут — проверяем строку формул. Google
            //    восстанавливает её после reload/смены листа — прячем снова.
            if (isFormulaBarVisible()) {
              guardianRunning = true;
              var done = function () { guardianRunning = false; };
              tryHideFormulaBar().then(done, done);
            }
          }, 1000);
        }

        /**
         * Скрытие соседей tabs-контейнера в bottom-bar (prev/next/☰ кнопки).
         * Google переименовал .docs-grid-bar — поднимаемся через первый
         * .docs-sheet-tab и помечаем sibling'ов которые НЕ содержат текст
         * status-bar'a.
         */
        function markBottomBarSiblings() {
          var firstTab = document.querySelector('.docs-sheet-tab');
          if (!firstTab) return;
          var tabsContainer = firstTab.parentElement;
          if (!tabsContainer) return;
          var bottomBar = tabsContainer.parentElement;
          if (!bottomBar) return;
          var STATUS_TEXT = [
            'Показано', 'Показан', 'Showing', 'Среднее', 'Sum', 'Сумма',
            'Avg', 'Count', 'Min', 'Max', 'строк', 'rows',
          ];
          for (var i = 0; i < bottomBar.children.length; i++) {
            var c = bottomBar.children[i];
            if (c === tabsContainer) continue;
            var text = (c.textContent || '');
            var isStatus = false;
            for (var k = 0; k < STATUS_TEXT.length; k++) {
              if (text.indexOf(STATUS_TEXT[k]) !== -1) { isStatus = true; break; }
            }
            if (isStatus) continue;
            if (!c.hasAttribute('data-pyn-hide')) {
              c.setAttribute('data-pyn-hide', '');
            }
          }
        }
        markBottomBarSiblings();
        setTimeout(markBottomBarSiblings, 500);
        setTimeout(markBottomBarSiblings, 1500);

        /**
         * Глобальная функция switch-листа. Google не хранит gid в DOM tab'ов
         * (id типа :y, :1e — Closure-generated), поэтому надёжнее
         * сопоставлять через имя листа (rawName). Pyn передаёт оба.
         * Возвращает объект с диагностикой.
         */
        window.__pynSwitchSheet = function (gid, name) {
          gid = String(gid);
          var diag = { gid: gid, name: name || null, tried: [], result: 'fail' };

          function clickReport(el, label) {
            if (!el) return false;
            try { clickDeeply(el); diag.result = label; return true; }
            catch (e) { diag.tried.push(label + ':err'); return false; }
          }

          // 1. По имени листа через .docs-sheet-tab-name textContent.
          if (name) {
            var tabs = document.querySelectorAll('.docs-sheet-tab');
            diag.tried.push('name-scan:tabs=' + tabs.length);
            for (var i = 0; i < tabs.length; i++) {
              var nameEl = tabs[i].querySelector('.docs-sheet-tab-name');
              var text = nameEl ? (nameEl.textContent || '').trim() : '';
              if (text === name) {
                if (clickReport(tabs[i], 'click:name')) return diag;
              }
            }
            // Fallback — case-insensitive match.
            var nameLow = name.toLowerCase();
            for (var j = 0; j < tabs.length; j++) {
              var nameEl2 = tabs[j].querySelector('.docs-sheet-tab-name');
              var text2 = nameEl2 ? (nameEl2.textContent || '').trim().toLowerCase() : '';
              if (text2 === nameLow) {
                if (clickReport(tabs[j], 'click:name-ci')) return diag;
              }
            }
          }

          // 2. По id="sheet-button-<gid>" (legacy).
          var byId = document.getElementById('sheet-button-' + gid);
          diag.tried.push('id:' + (byId ? 'found' : 'no'));
          if (clickReport(byId, 'click:id')) return diag;

          // 3. Hash fallback (full reload, но хоть переключит).
          try {
            window.location.hash = '#gid=' + gid;
            diag.result = 'hash';
          } catch (_) {}
          return diag;
        };

        /**
         * Path-based навигация по Google-меню без visible flash. Все popups
         * скрыты body.pyn-menu-extracting CSS, ничего не мерцает.
         *
         * Принимает path: первый элемент — название top-level menu
         * (Правка/Вставка/Данные/Формат/…), последующие — последовательные
         * подпункты. Открывает root → hover'ит каждый промежуточный →
         * возвращает items последнего открытого подменю как массив
         * объектов label/hasSubmenu. Если path = ['Правка'] — возвращает
         * top-level items этого меню. После сбора всё закрывает Escape.
         *
         * Для клика конечного пункта используется аналогичная навигация в
         * __pynClickMenuPath.
         */
        var TOP_LEVEL_LABELS = [
          'файл', 'правка', 'вид', 'вставка', 'формат', 'данные',
          'инструменты', 'расширения', 'справка',
        ];

        function cleanHotkey(s) {
          // Убираем хоткей-хвост ("Отменить Ctrl+Z" → "Отменить") и tab-arrow.
          return s.replace(/\s+(Ctrl|Cmd|⌘|Shift|Alt|Option|⇧|⌥|⌃)[\+\w\s⇧⌥⌃]+$/i, '')
                  .replace(/\s*▸\s*$/, '')
                  .replace(/\s*►\s*$/, '')
                  .trim();
        }

        function hoverDeeply(el) {
          var rect = el.getBoundingClientRect();
          var x = rect.left + rect.width / 2;
          var y = rect.top + rect.height / 2;
          var types = ['mouseover', 'mouseenter', 'mousemove', 'pointerover', 'pointerenter'];
          for (var i = 0; i < types.length; i++) {
            try {
              el.dispatchEvent(new MouseEvent(types[i], {
                bubbles: true, cancelable: true, view: window,
                clientX: x, clientY: y, button: 0,
              }));
            } catch (_) {}
          }
        }

        function visibleMenus() {
          var all = document.querySelectorAll('[role="menu"], .goog-menu');
          var out = [];
          for (var i = 0; i < all.length; i++) {
            var r = all[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) out.push(all[i]);
          }
          return out;
        }

        function findMenubarButton(label) {
          var lo = String(label).toLowerCase();
          var nodes = document.querySelectorAll(
            '[role="menuitem"],.docs-menu-button,.menu-button,.goog-menu-button,' +
            '[role="menubar"] [role="button"],#docs-menubar [role="button"]'
          );
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var aria = (n.getAttribute('aria-label') || '').toLowerCase();
            var text = (n.textContent || '').trim().toLowerCase();
            if (aria === lo || text === lo ||
                aria.indexOf(lo) === 0 || text.indexOf(lo) === 0) return n;
          }
          return null;
        }

        function itemHasSubmenu(el) {
          return el.getAttribute('aria-haspopup') === 'true' ||
                 (el.className || '').toString().indexOf('submenu') !== -1 ||
                 !!el.querySelector('.goog-submenu-arrow') ||
                 !!el.querySelector('[class*="submenu"]');
        }

        function collectItems(menuEl) {
          var items = menuEl.querySelectorAll('[role="menuitem"],.goog-menuitem');
          var out = [];
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var raw = (it.textContent || '').trim();
            if (!raw) continue;
            var clean = cleanHotkey(raw);
            if (!clean) continue;
            if (TOP_LEVEL_LABELS.indexOf(clean.toLowerCase()) !== -1) continue;
            out.push({ label: clean, hasSubmenu: itemHasSubmenu(it), el: it });
          }
          return out;
        }

        function escapeAllMenus() {
          try {
            for (var k = 0; k < 5; k++) {
              document.body.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                bubbles: true, cancelable: true,
              }));
            }
          } catch (_) {}
        }

        // Counter для concurrent extract'ов — если юзер быстро движет мышь,
        // несколько extract могут идти параллельно. Снимаем класс только
        // когда всё закончилось.
        //
        // §v1.2.14 — MutationObserver: пока pyn-menu-extracting активен,
        // ставим inline visibility:hidden на любой новый popup (.goog-menu
        // / [role=menu]). Inline-style побеждает Google'е CSS (та же
        // specificity, но inline last → wins). Без этого Google popup
        // успевал отрисоваться («шляпа») до того как наш .pyn-menu-
        // extracting CSS apply'ился.
        var pynExtractDepth = 0;
        var pynMaskObserver = null;
        function hideMenuNode(node) {
          if (!node || node.nodeType !== 1) return;
          var cls = (node.className || '').toString();
          var role = node.getAttribute && node.getAttribute('role');
          var isMenu = role === 'menu' || cls.indexOf('goog-menu') !== -1 ||
            cls.indexOf('docs-menu') !== -1;
          if (!isMenu) return;
          if (!node.hasAttribute('data-pyn-mask-saved')) {
            node.setAttribute('data-pyn-mask-saved',
              (node.style.visibility || '') + '||' + (node.style.opacity || ''));
          }
          node.style.visibility = 'hidden';
          node.style.opacity = '0';
          node.style.pointerEvents = 'none';
        }
        function restoreMenuNode(node) {
          if (!node || !node.hasAttribute) return;
          if (!node.hasAttribute('data-pyn-mask-saved')) return;
          var saved = (node.getAttribute('data-pyn-mask-saved') || '').split('||');
          node.style.visibility = saved[0] || '';
          node.style.opacity = saved[1] || '';
          node.style.pointerEvents = '';
          node.removeAttribute('data-pyn-mask-saved');
        }
        function startExtracting() {
          pynExtractDepth++;
          if (pynExtractDepth === 1) {
            document.body.classList.add('pyn-menu-extracting');
            // Hide уже существующие menu nodes (если что-то открыто).
            var existing = document.querySelectorAll('.goog-menu, [role="menu"]');
            for (var i = 0; i < existing.length; i++) hideMenuNode(existing[i]);
            // Наблюдаем новые menu nodes — Google создаст popup после нашего
            // click'а — observer hide'нет inline-style ДО paint.
            if (!pynMaskObserver) {
              pynMaskObserver = new MutationObserver(function (mutations) {
                if (!document.body.classList.contains('pyn-menu-extracting')) return;
                var hidden = 0;
                for (var m = 0; m < mutations.length; m++) {
                  var added = mutations[m].addedNodes;
                  for (var n = 0; n < added.length; n++) {
                    hideMenuNode(added[n]);
                    if (added[n].nodeType === 1 && added[n].querySelectorAll) {
                      var sub = added[n].querySelectorAll('.goog-menu, [role="menu"]');
                      for (var s = 0; s < sub.length; s++) {
                        hideMenuNode(sub[s]);
                        hidden++;
                      }
                    }
                  }
                  // Также трекаем attribute mutations — Google может toggle
                  // style/class на existing popup'е и сделать его visible.
                  if (mutations[m].type === 'attributes') {
                    var t = mutations[m].target;
                    if (t.classList && (t.classList.contains('goog-menu') ||
                        t.getAttribute('role') === 'menu')) {
                      hideMenuNode(t);
                    }
                  }
                }
                if (hidden > 0) {
                  console.log('[pyn:sheets-mask] observer hidden ' + hidden + ' menu(s)');
                }
              });
            }
            pynMaskObserver.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class'],
            });
          }
        }
        function endExtracting() {
          pynExtractDepth = Math.max(0, pynExtractDepth - 1);
          setTimeout(function () {
            if (pynExtractDepth <= 0) {
              document.body.classList.remove('pyn-menu-extracting');
              if (pynMaskObserver) pynMaskObserver.disconnect();
              // §v1.2.14 — НЕ восстанавливаем inline-style на popup'ах.
              // Google после escape либо удаляет popup из DOM, либо оставляет
              // в скрытом состоянии. В обоих случаях наш inline-style
              // visibility:hidden — корректен. Восстанавливать = делать
              // popup visible поверх Pyn UI («шляпа»). При следующем open
              // observer hide'нет popup снова (если Google reuses node).
            }
          }, 250);
        }

        // Базовая логика для extract + click — общая навигация по path.
        async function _navigatePath(path) {
          if (!Array.isArray(path) || path.length === 0) return null;
          var needsToggle = !isMenubarVisible();
          startExtracting();
          if (needsToggle) {
            fireKeyboardShortcut();
            await new Promise(function (r) { setTimeout(r, 180); });
          }
          var rootBtn = findMenubarButton(path[0]);
          if (!rootBtn) {
            if (needsToggle) fireKeyboardShortcut();
            endExtracting();
            return null;
          }
          clickDeeply(rootBtn);
          await new Promise(function (r) { setTimeout(r, 160); });

          var currentMenu = visibleMenus().pop() || null;
          if (!currentMenu) {
            escapeAllMenus();
            if (needsToggle) fireKeyboardShortcut();
            endExtracting();
            return null;
          }

          // Hover через промежуточные шаги path[1..n-1].
          for (var i = 1; i < path.length; i++) {
            var step = String(path[i]).toLowerCase();
            var items = collectItems(currentMenu);
            var target = null;
            for (var j = 0; j < items.length; j++) {
              var lab = items[j].label.toLowerCase();
              if (lab === step || lab.indexOf(step) === 0) { target = items[j].el; break; }
            }
            if (!target) {
              escapeAllMenus();
              if (needsToggle) fireKeyboardShortcut();
              endExtracting();
              return null;
            }
            var before = visibleMenus();
            hoverDeeply(target);
            await new Promise(function (r) { setTimeout(r, 160); });
            var after = visibleMenus();
            var newMenu = null;
            for (var k = 0; k < after.length; k++) {
              if (before.indexOf(after[k]) === -1) { newMenu = after[k]; break; }
            }
            if (!newMenu) {
              newMenu = after[after.length - 1] || currentMenu;
            }
            currentMenu = newMenu;
          }

          return {
            currentMenu: currentMenu,
            cleanup: function () {
              escapeAllMenus();
              if (needsToggle) fireKeyboardShortcut();
              endExtracting();
            },
          };
        }

        /**
         * Прячем строку формул Google (поле имени + fx + поле формулы) НАТИВНО
         * через «Вид → Показать → Строка формул». CSS display:none тут не
         * годится: grid Google позиционируется с вычисленным top-офсетом и от
         * CSS-скрытия НЕ пересчитывается → останется пустой зазор (та же
         * причина, по которой menubar сворачиваем нативной кнопкой, а не
         * стилями). Нативный тумблер пересчитывает раскладку и Google запоминает
         * выбор между перезагрузками. Идемпотентно: тумблер — toggle, поэтому
         * дёргаем только когда панель РЕАЛЬНО видна (иначе показали бы обратно).
         * Если подписи меню не совпали несколько раз подряд — сдаёмся, чтобы
         * guardian не мигал menubar'ом каждую секунду.
         */
        var formulaBarFails = 0;
        var formulaBarGaveUp = false;
        async function tryHideFormulaBar() {
          if (formulaBarGaveUp) return;
          if (!isFormulaBarVisible()) return;
          // Структура меню и подпись пункта у Google варьируются: «Вид →
          // Показать → Строка формул» либо «… → Панель формул», иногда без
          // подменю «Показать»; в англ. локали «View → Show → Formula bar».
          // Поэтому навигируем к подменю и ищем пункт по подстроке, не
          // завязываясь на точную подпись. ВАЖНО: соседний пункт «Формулы»
          // (показ формул в ячейках) тоже содержит «формул» — исключаем его.
          var NAV_PATHS = [
            ['Вид', 'Показать'],
            ['Вид'],
            ['View', 'Show'],
            ['View'],
          ];
          function isFormulaBarItem(label) {
            var lab = label.toLowerCase();
            var matches = lab.indexOf('формул') !== -1 ||
              lab.indexOf('formula') !== -1;
            var isFormulasToggle = lab.indexOf('формулы') !== -1 ||
              lab.indexOf('formulas') !== -1;
            return matches && !isFormulasToggle;
          }
          for (var p = 0; p < NAV_PATHS.length; p++) {
            if (!isFormulaBarVisible()) return;
            var nav = await _navigatePath(NAV_PATHS[p]);
            if (!nav) continue;
            var items = collectItems(nav.currentMenu);
            var leaf = null;
            for (var i = 0; i < items.length; i++) {
              if (isFormulaBarItem(items[i].label)) {
                leaf = items[i].el;
                break;
              }
            }
            if (leaf) clickDeeply(leaf);
            nav.cleanup();
            if (leaf) {
              formulaBarFails = 0;
              console.log('[pyn:sheets-mask] formula bar toggled via ' +
                JSON.stringify(NAV_PATHS[p]));
              return;
            }
          }
          formulaBarFails++;
          if (formulaBarFails >= 5) {
            formulaBarGaveUp = true;
            console.warn('[pyn:sheets-mask] formula bar hide gave up ' +
              '(menu labels not matched?)');
          }
        }

        window.__pynExtractMenu = async function (path) {
          if (typeof path === 'string') path = [path]; // legacy: single string
          var nav = await _navigatePath(path);
          if (!nav) return [];
          var items = collectItems(nav.currentMenu);
          var out = [];
          for (var i = 0; i < items.length; i++) {
            out.push({ label: items[i].label, hasSubmenu: items[i].hasSubmenu });
          }
          nav.cleanup();
          console.log('[pyn:sheets-mask] extract', JSON.stringify(path),
            'items=' + out.length);
          return out;
        };

        window.__pynClickMenuPath = async function (path) {
          if (!Array.isArray(path) || path.length < 1) return 'bad-path';
          // Навигируем до предпоследнего, кликаем последний.
          var navPath = path.slice(0, path.length - 1);
          var leafLabel = String(path[path.length - 1]).toLowerCase();
          if (navPath.length === 0) {
            // path = ['Правка'] — клик по top-level — не наш кейс, но поддержим.
            var btn = findMenubarButton(path[0]);
            if (btn) { clickDeeply(btn); return 'click:top'; }
            return 'no-top';
          }
          var nav = await _navigatePath(navPath);
          if (!nav) return 'nav-fail';
          var items = collectItems(nav.currentMenu);
          var leaf = null;
          for (var i = 0; i < items.length; i++) {
            var lab = items[i].label.toLowerCase();
            if (lab === leafLabel || lab.indexOf(leafLabel) === 0) {
              leaf = items[i].el;
              break;
            }
          }
          if (!leaf) {
            nav.cleanup();
            return 'leaf-not-found';
          }
          clickDeeply(leaf);
          // Google'е popup'ы закроются после action — держим extracting-класс
          // ещё ~300ms чтобы не было видимого flash'а.
          endExtracting();
          return 'click:' + path.join('/');
        };

        // Legacy single-step API (на случай если что-то ещё его дергает).
        window.__pynClickMenuItem = function (parentLabel, itemLabel) {
          var parentLow = String(parentLabel).toLowerCase();
          var itemLow = String(itemLabel).toLowerCase();
          var nodes = document.querySelectorAll(
            '[role="menuitem"],.docs-menu-button,.menu-button,.goog-menu-button'
          );
          var parentEl = null;
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var aria = (n.getAttribute('aria-label') || '').toLowerCase();
            var text = (n.textContent || '').trim().toLowerCase();
            if (aria === parentLow || text === parentLow ||
                aria.indexOf(parentLow) === 0 || text.indexOf(parentLow) === 0) {
              parentEl = n;
              break;
            }
          }
          if (!parentEl) return 'no-parent';
          clickDeeply(parentEl);
          return new Promise(function (resolve) {
            setTimeout(function () {
              var items = document.querySelectorAll('[role="menuitem"]');
              var found = null;
              for (var j = 0; j < items.length; j++) {
                var t = (items[j].textContent || '').trim().toLowerCase();
                if (!t) continue;
                if (t === itemLow || t.indexOf(itemLow) === 0) {
                  found = items[j];
                  break;
                }
              }
              if (found) {
                clickDeeply(found);
                resolve('click:' + (found.textContent || '').trim().slice(0, 60));
              } else {
                // Закрыть открытое меню Escape'ом.
                try {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                    bubbles: true, cancelable: true,
                  }));
                } catch (_) {}
                resolve('no-item');
              }
            }, 80);
          });
        };

        /**
         * Открыть конкретный пункт Google menubar (Правка / Вставка / Данные
         * / Формат / Файл / Вид / Инструменты / Расширения / Справка). Меню
         * у нас визуально свёрнуто, но DOM-узлы есть — кликаем на нужный.
         * Возвращает строку-диагностику.
         */
        window.__pynOpenMenu = function (label) {
          label = String(label).toLowerCase();
          // Google пункты menubar — role=menuitem или class menu-button.
          var nodes = document.querySelectorAll(
            '[role="menuitem"],.docs-menu-button,.menu-button,.goog-menu-button'
          );
          for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var aria = (el.getAttribute('aria-label') || '').toLowerCase();
            var text = (el.textContent || '').trim().toLowerCase();
            if (aria === label || text === label) {
              clickDeeply(el);
              return 'click:' + (aria || text);
            }
          }
          // Substring fallback.
          for (var j = 0; j < nodes.length; j++) {
            var el2 = nodes[j];
            var aria2 = (el2.getAttribute('aria-label') || '').toLowerCase();
            var text2 = (el2.textContent || '').trim().toLowerCase();
            if (aria2.indexOf(label) === 0 || text2.indexOf(label) === 0) {
              clickDeeply(el2);
              return 'click:sub:' + (aria2 || text2);
            }
          }
          return 'fail';
        };

        /**
         * §v1.2.14 — Найти toolbar-кнопку «Режимы фильтрации» Google'а.
         * По aria-label/data-tooltip. Кнопка имеет class
         * goog-toolbar-menu-button и при click открывает popup
         * (.goog-menu) со списком filter views.
         */
        function findFilterToolbarButton() {
          var all = document.querySelectorAll('[aria-label],[data-tooltip]');
          var terms = ['режимы фильтр', 'filter view'];
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var aria = (el.getAttribute('aria-label') || '').toLowerCase();
            var tip = (el.getAttribute('data-tooltip') || '').toLowerCase();
            for (var t = 0; t < terms.length; t++) {
              if (aria.indexOf(terms[t]) === 0 || tip.indexOf(terms[t]) === 0) {
                return el;
              }
            }
          }
          return null;
        }

        /**
         * §v1.2.14 — Извлечь список filter views через toolbar.
         * Click toolbar button → popup open → читаем items → close popup.
         * Под pyn-menu-extracting CSS — popup не visible. Возвращает массив
         * имён saved views (без служебных пунктов «Создать», «Закрыть» и т.п.).
         */
        window.__pynExtractFilterViews = async function () {
          var btn = findFilterToolbarButton();
          if (!btn) {
            console.log('[pyn:sheets-mask] no filter toolbar button');
            return [];
          }
          startExtracting();
          var beforeMenus = visibleMenus().length;
          // 1й клик — toggle open popup.
          clickDeeply(btn);
          await new Promise(function (r) { setTimeout(r, 280); });
          var menus = visibleMenus();
          if (menus.length <= beforeMenus) {
            // popup не открылся — toggle close (на случай если open был
            // restored Google'ом без visibility). Возвращаем пустой.
            clickDeeply(btn);
            endExtracting();
            return [];
          }
          var menu = menus[menus.length - 1];
          var items = collectItems(menu);
          var actionPrefixes = [
            'создать', 'создание', 'сохранить', 'удалить', 'закрыть',
            'параметры', 'новый', 'управление',
          ];
          var out = [];
          for (var i = 0; i < items.length; i++) {
            var low = items[i].label.trim().toLowerCase();
            var skip = false;
            for (var p = 0; p < actionPrefixes.length; p++) {
              if (low.indexOf(actionPrefixes[p]) === 0) { skip = true; break; }
            }
            if (!skip && low) out.push(items[i].label);
          }
          // §v1.2.14 — 2й клик toolbar = toggle close. Это симметрично:
          // open-close. Иначе escape мог не закрыть popup, при след. open
          // toggle делал close → юзер видел "не найдено" через раз.
          clickDeeply(btn);
          endExtracting();
          console.log('[pyn:sheets-mask] extracted views via toolbar=' + out.length);
          return out;
        };

        /**
         * §v1.2.14 — Применить filter view через toolbar.
         * Click toolbar button → popup open → click view item → popup closes,
         * Google активирует view. Под pyn-menu-extracting CSS — popup не visible.
         * Возвращает строку-диагностику.
         */
        window.__pynApplyFilterView = async function (label) {
          var btn = findFilterToolbarButton();
          if (!btn) return 'no-toolbar';
          startExtracting();
          var beforeMenus = visibleMenus().length;
          clickDeeply(btn);
          await new Promise(function (r) { setTimeout(r, 280); });
          var menus = visibleMenus();
          if (menus.length <= beforeMenus) {
            escapeAllMenus();
            endExtracting();
            return 'no-popup';
          }
          var menu = menus[menus.length - 1];
          var items = collectItems(menu);
          var labelLow = String(label).toLowerCase();
          var target = null;
          for (var i = 0; i < items.length; i++) {
            var lab = items[i].label.toLowerCase();
            if (lab === labelLow || lab.indexOf(labelLow) === 0) {
              target = items[i].el; break;
            }
          }
          if (!target) {
            escapeAllMenus();
            endExtracting();
            return 'no-item';
          }
          clickDeeply(target);
          endExtracting();
          return 'click:' + label;
        };

        /**
         * Диагностика — Pyn-renderer вызывает чтобы понять что в DOM.
         */
        window.__pynSheetsInspect = function () {
          var all = document.querySelectorAll('[aria-label],[data-tooltip],[title]');
          var menu = [], sheet = [];
          var cBtn = findCollapseBtn();
          var collapseBtn = cBtn ? {
            tag: cBtn.tagName,
            cls: (cBtn.className || '').toString().slice(0, 100),
            al: cBtn.getAttribute('aria-label'),
            dt: cBtn.getAttribute('data-tooltip'),
            ti: cBtn.getAttribute('title'),
            visible: cBtn.offsetWidth > 0 && cBtn.offsetHeight > 0,
          } : null;

          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var t = textOf(el);
            if (hasAny(t, T.menu) && menu.length < 8) {
              menu.push({
                tag: el.tagName,
                al: el.getAttribute('aria-label'),
                dt: el.getAttribute('data-tooltip'),
                ti: el.getAttribute('title'),
              });
            } else if (hasAny(t, T.sheet) && sheet.length < 8) {
              sheet.push({
                tag: el.tagName,
                al: el.getAttribute('aria-label'),
                dt: el.getAttribute('data-tooltip'),
                ti: el.getAttribute('title'),
              });
            }
          }

          // Tab-кнопки (для проблем с переключением листов).
          var tabEls = document.querySelectorAll(
            '.docs-sheet-tab,.docs-sheet-tab-container,[id^="sheet-button-"],' +
            '[id*="sheet-tab-"],[class*="sheet-tab"]'
          );
          var tabs = [];
          for (var k = 0; k < tabEls.length && tabs.length < 12; k++) {
            var te = tabEls[k];
            tabs.push({
              tag: te.tagName,
              id: te.id || null,
              cls: (te.className || '').toString().slice(0, 80),
              al: te.getAttribute('aria-label'),
              dataId: te.getAttribute('data-id'),
              aria: te.getAttribute('aria-controls'),
            });
          }

          // Grid-bar — какие дети есть.
          var gridBar = document.querySelector(
            '.docs-grid-bar, #docs-grid-bar, .docs-sheet-bar'
          );
          var gridBarChildren = [];
          if (gridBar) {
            for (var c = 0; c < gridBar.children.length && c < 10; c++) {
              var ch = gridBar.children[c];
              gridBarChildren.push({
                tag: ch.tagName,
                cls: (ch.className || '').toString().slice(0, 80),
                al: ch.getAttribute('aria-label'),
                hidden: ch.hasAttribute('data-pyn-hide'),
              });
            }
          }

          return {
            url: location.href.slice(0, 120),
            collapsed: collapsed,
            collapseBtn: collapseBtn,
            menu: menu,
            sheet: sheet,
            tabs: tabs,
            gridBar: gridBar ? gridBarChildren : null,
          };
        };

        // §pyn-1.2.71 — бутстрап успешно завершён: помечаем JS-контекст, чтобы
        // повторные did-stop-loading не гоняли всё заново (см. гейт вверху).
        window.__pynMaskBootstrapped = true;
        console.log('[pyn:sheets-mask] bootstrapped');
      } catch (e) {
        console.warn('[pyn:sheets-mask] inject failed:', e);
      }
    })();
  `;
}

/** Code-сниппет для переключения листа из renderer-кода. */
export function buildSwitchSheetScript(gid: number, name: string): string {
  return (
    `(typeof window.__pynSwitchSheet === 'function' ? ` +
    `window.__pynSwitchSheet(${gid}, ${JSON.stringify(name)}) : 'no-fn')`
  );
}

/** Code-сниппет для диагностики DOM из renderer-кода. */
export const SHEETS_INSPECT_SCRIPT =
  `(typeof window.__pynSheetsInspect === 'function' ? window.__pynSheetsInspect() : null)`;

/** Code-сниппет для открытия пункта Google menubar (Правка/Вставка/Данные/…). */
export function buildOpenMenuScript(label: string): string {
  return (
    `(typeof window.__pynOpenMenu === 'function' ? ` +
    `window.__pynOpenMenu(${JSON.stringify(label)}) : 'no-fn')`
  );
}

/** Code-сниппет для клика подпункта Google menu (например «Правка → Отменить»). */
export function buildClickMenuItemScript(parent: string, item: string): string {
  return (
    `(typeof window.__pynClickMenuItem === 'function' ? ` +
    `window.__pynClickMenuItem(${JSON.stringify(parent)}, ${JSON.stringify(item)}) : 'no-fn')`
  );
}

/**
 * Code-сниппет для извлечения пунктов Google-меню по path.
 * `path = ['Правка']` — вернёт top-level items этого меню.
 * `path = ['Правка', 'Специальная вставка']` — вернёт items submenu.
 */
export function buildExtractMenuScript(path: readonly string[]): string {
  return (
    `(typeof window.__pynExtractMenu === 'function' ? ` +
    `window.__pynExtractMenu(${JSON.stringify(path)}) : [])`
  );
}

/** Code-сниппет для клика leaf-пункта Google-меню по path. */
export function buildClickMenuPathScript(path: readonly string[]): string {
  return (
    `(typeof window.__pynClickMenuPath === 'function' ? ` +
    `window.__pynClickMenuPath(${JSON.stringify(path)}) : 'no-fn')`
  );
}
