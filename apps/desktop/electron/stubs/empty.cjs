// Stub для optional native deps пакета `ws` (bufferutil, utf-8-validate).
//
// `ws` оборачивает require'ы в try/catch и при ошибке использует чистый JS
// fallback (`lib/buffer-util.js` + `lib/validation.js`). Если же require
// возвращает пустой `{}`, ws думает что lib загружена и при первом use'е
// падает с `TypeError: bufferUtil2.mask is not a function` (или
// `Validation.isValidUTF8`). Поэтому здесь **сразу throw'аем** — ws сразу
// решит что нативки нет и встанет на pure JS path.
throw new Error('native module not bundled — ws will use pure JS fallback');
