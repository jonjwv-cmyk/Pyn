#!/usr/bin/env node
/**
 * Генерация иконок приложения из SVG-источника.
 *   Source : apps/desktop/build/icon.svg
 *   Output : apps/desktop/build/icon.ico (Windows multi-res)
 *            apps/desktop/build/icon.icns (Mac)
 *            apps/desktop/build/icon.png  (Linux + GitHub social preview)
 *
 * Зависит от `magick` (ImageMagick 7+) в PATH. На локальном Mac легко
 * `brew install imagemagick`. В CI на windows-latest / ubuntu-latest
 * ImageMagick предустановлен. Если magick отсутствует — выводит инструкцию
 * и завершается без ошибки (CI workflow его сам ставит).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = resolve(here, '..', 'apps', 'desktop', 'build');
const src = resolve(buildDir, 'icon.svg');

if (!existsSync(src)) {
  console.error(`[build-icons] not found: ${src}`);
  process.exit(1);
}
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
      'Install: `brew install imagemagick` (Mac) or `choco install imagemagick` (Win). ' +
      'CI workflow installs it automatically.',
  );
  process.exit(0);
}

const targets = [
  // PNG 1024 — source-of-truth для прочих
  { out: 'icon.png', args: ['-density', '512', src, '-resize', '1024x1024', '-background', 'none'] },
  // Windows ICO — multi-resolution, electron-builder ожидает min 256
  { out: 'icon.ico', args: ['-density', '512', src, '-define', 'icon:auto-resize=16,32,48,64,128,256', '-background', 'none'] },
  // Mac ICNS
  { out: 'icon.icns', args: ['-density', '512', src, '-resize', '1024x1024', '-background', 'none'] },
];

for (const t of targets) {
  const out = resolve(buildDir, t.out);
  const r = spawnSync(magick, [...t.args, out], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[build-icons] FAIL ${t.out}: exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
  console.log(`[build-icons] wrote ${t.out}`);
}
