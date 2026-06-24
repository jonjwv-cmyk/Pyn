// ============================================================
// api-mode.ts — DEV-ONLY переключатель сетевого маршрута (юзер 2026-06-22).
// ============================================================
// VPS отпал (неоплата). Чтобы продолжать РАЗРАБОТКУ на Mac, добавлен переключатель:
//   • 'vps'   — штатный прод-путь: api.otlhelper.com → DNS-override на VPS-IP → CF Worker (+ SPKI pin).
//   • 'cloud' — НАПРЯМУЮ на Cloudflare Worker (otl-api.jond-horizon.workers.dev), минуя VPS,
//               обычная валидация cert (CF), без SPKI-пина.
//
// 🔴 ТОЛЬКО ДЛЯ DEV: переключение разрешено лишь в НЕ упакованной сборке (`!app.isPackaged`).
// Прод-EXE ВСЕГДА работает через VPS ('vps') — режим 'cloud' там игнорируется. Это не прод-фича.
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ApiMode = 'vps' | 'cloud';

/** Прямой Cloudflare Worker (минуя VPS) — для dev, когда VPS недоступен. */
export const CLOUD_API_URL = 'https://otl-api.jond-horizon.workers.dev/api';
export const CLOUD_WS_URL = 'wss://otl-api.jond-horizon.workers.dev/ws';

let mode: ApiMode = 'vps';

/** Переключение доступно только в dev-сборке (не упаковано). В проде всегда VPS. */
export function devModeAllowed(): boolean {
  return !app.isPackaged;
}

function modeFile(): string {
  return join(app.getPath('userData'), 'dev-api-mode.json');
}

/** Прочитать сохранённый режим при старте (после app.whenReady). В проде — форс 'vps'. */
export function initApiMode(): void {
  if (!devModeAllowed()) {
    mode = 'vps';
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(modeFile(), 'utf8')) as { mode?: string };
    mode = raw.mode === 'cloud' ? 'cloud' : 'vps';
  } catch {
    mode = 'vps'; // нет файла → дефолт
  }
  // eslint-disable-next-line no-console
  console.log(`[pyn:api-mode] ${mode}${mode === 'cloud' ? ' (DEV: прямой Cloudflare, минуя VPS)' : ''}`);
}

export function getApiMode(): ApiMode {
  return devModeAllowed() ? mode : 'vps';
}

/** Сменить режим (dev only) + сохранить. Возвращает фактический режим. */
export function setApiMode(next: ApiMode): ApiMode {
  if (!devModeAllowed()) return 'vps';
  mode = next === 'cloud' ? 'cloud' : 'vps';
  try {
    writeFileSync(modeFile(), JSON.stringify({ mode }));
  } catch {
    /* запись не критична — режим уже в памяти */
  }
  // eslint-disable-next-line no-console
  console.log(`[pyn:api-mode] → ${mode}`);
  return mode;
}
