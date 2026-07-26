/**
 * Копирует uiohook-napi (с prebuilds/*.node) в dist-electron/vendor/.
 *
 * Зачем:
 * - pnpm держит пакет в корневом .pnpm store (symlink) — electron-builder
 *   не может тянуть workspace/hoisted native deps извне apps/desktop;
 * - .node нельзя грузить из app.asar → asarUnpack vendor/**;
 * - vite external: не бандлим native module в main.js.
 */
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const dest = join(desktopRoot, 'dist-electron', 'vendor', 'uiohook-napi');

let pkgRoot;
try {
  pkgRoot = dirname(require.resolve('uiohook-napi/package.json'));
} catch (e) {
  console.error('[stage-uiohook] uiohook-napi not installed:', e.message);
  process.exit(1);
}

if (!existsSync(join(pkgRoot, 'prebuilds'))) {
  console.error('[stage-uiohook] no prebuilds/ in', pkgRoot);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(pkgRoot, dest, {
  recursive: true,
  filter: (src) => {
    // не тащим исходники/тесты — только runtime + prebuilds + binding
    const base = src.slice(pkgRoot.length).replace(/\\/g, '/');
    if (base.includes('/src/') && !base.includes('/src/lib')) return false;
    if (base.includes('/node_modules/')) return false;
    return true;
  },
});

const platforms = existsSync(join(dest, 'prebuilds'))
  ? readdirSync(join(dest, 'prebuilds')).join(', ')
  : '(none)';
console.log(`[stage-uiohook] ${pkgRoot} → ${dest}`);
console.log(`[stage-uiohook] prebuilds: ${platforms}`);
