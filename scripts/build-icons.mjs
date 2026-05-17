#!/usr/bin/env node
/**
 * Генерация иконок приложения.
 *
 * Источник (приоритет):
 *   1. apps/desktop/build/icon-source.png  (1024×1024+, рекомендуется PNG юзера)
 *   2. apps/desktop/build/icon.svg          (fallback — placeholder в репо)
 *
 * Output:
 *   • apps/desktop/build/icon.png   (PNG 1024×1024 — Linux + GitHub social)
 *   • apps/desktop/build/icon.ico   (Windows multi-resolution)
 *   • apps/desktop/build/icon.icns  (Mac)
 *
 * Зависит от ImageMagick 7+ (`magick`) в PATH. На Mac: `brew install
 * imagemagick`. В CI (windows-latest / ubuntu-latest) — устанавливается
 * автоматически. Если `magick` не найден — выводит подсказку и
 * завершается без ошибки (CI workflow ставит сам).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = resolve(here, '..', 'apps', 'desktop', 'build');
const pngSrc = resolve(buildDir, 'icon-source.png');
const svgSrc = resolve(buildDir, 'icon.svg');

const src = existsSync(pngSrc) ? pngSrc : existsSync(svgSrc) ? svgSrc : null;
if (!src) {
  console.error(
    `[build-icons] no source found. Положи 1024×1024 PNG как ${pngSrc} ` +
      `или оставь fallback ${svgSrc}.`,
  );
  process.exit(1);
}
console.log(`[build-icons] source: ${src}`);
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

const magick = which('magick') || which('convert');
if (!magick) {
  console.warn(
    '[build-icons] ImageMagick (`magick`) not found. ' +
      'Mac: `brew install imagemagick`. Win: `choco install imagemagick.app -y`. ' +
      'CI workflow ставит автоматически — это сообщение только для local dev.',
  );
  process.exit(0);
}

const isSvg = src.toLowerCase().endsWith('.svg');
const sharedArgs = isSvg
  ? ['-density', '512', src, '-background', 'none']
  : [src];

const targets = [
  // PNG 1024 — source-of-truth для прочих
  { out: 'icon.png', extra: ['-resize', '1024x1024'] },
  // Windows ICO — multi-resolution, electron-builder требует min 256
  { out: 'icon.ico', extra: ['-define', 'icon:auto-resize=16,32,48,64,128,256'] },
  // Mac ICNS
  { out: 'icon.icns', extra: ['-resize', '1024x1024'] },
];

for (const t of targets) {
  const out = resolve(buildDir, t.out);
  const r = spawnSync(magick, [...sharedArgs, ...t.extra, out], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[build-icons] FAIL ${t.out}: exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
  console.log(`[build-icons] wrote ${t.out}`);
}
