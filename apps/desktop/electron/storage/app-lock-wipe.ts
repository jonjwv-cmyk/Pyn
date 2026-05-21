import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Полное стирание userData при wipe-сигнале от сервера.
 *
 * Что стирается:
 *   • cache/      — encrypted Zustand-stores (news, chats, mol-base, users, ui-state, outbox, stats)
 *   • session.bin — encrypted bearer token
 *   • device.bin  — device_id (UUID), сервер уже пометил его 'wiped'
 *   • ВСЁ остальное в userData — на случай если в будущем добавятся файлы.
 *
 * После стирания вызывается app.relaunch() + app.quit(): процесс закрывается,
 * запускается заново как fresh install. Если developer не cancel'нул state на
 * сервере, login вернёт 410 ('device_wiped' — но device_id уже новый!) или
 * 423 ('app_blocked' если global state ещё активен). Юзер видит overlay
 * «Приложение деактивировано» до момента когда developer снимет state.
 *
 * Безопасность:
 *   • Не пытаемся удалить сам Electron exe/app — wipe только данных юзера.
 *     Для "полной переустановки" по требованию задачи достаточно стереть
 *     userData: даже свежий установщик попадёт в empty-state и при login
 *     получит ban от сервера если state != normal.
 *   • Errors игнорируем по best-effort: главное чтобы как можно больше
 *     файлов было стёрто. Затормозить relaunch на одном corrupted файле
 *     было бы хуже чем оставить его.
 */
export async function wipeAllUserData(): Promise<void> {
  const userDataDir = app.getPath('userData');
  console.log('[pyn:app-lock] wipe started:', userDataDir);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(userDataDir);
  } catch (err) {
    console.warn('[pyn:app-lock] readdir failed (continuing):', err);
  }

  // Защищённые имена которые Electron создаёт сам и которые ему нужны
  // для нормального shutdown'а (locks, тmp). Стирать их в активном процессе
  // = SIGBUS / crash на Win. Безопасно — они либо пустые, либо пересоздаются.
  const PROTECTED = new Set([
    'lockfile',
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
  ]);

  for (const name of entries) {
    if (PROTECTED.has(name)) continue;
    const full = path.join(userDataDir, name);
    try {
      await fs.rm(full, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[pyn:app-lock] rm ${name} failed:`, err);
    }
  }

  console.log('[pyn:app-lock] wipe complete, scheduling relaunch');
}

/**
 * Relaunch + quit после wipe. Отдельно от wipeAllUserData чтобы можно было
 * отложить через setTimeout (renderer должен успеть получить IPC-ответ).
 */
export function scheduleRelaunchAfterWipe(): void {
  // Маленькая задержка — дать renderer'у отрендерить «Стирание данных…»
  // overlay перед тем как процесс закроется.
  setTimeout(() => {
    try {
      app.relaunch();
    } catch (err) {
      console.warn('[pyn:app-lock] relaunch failed:', err);
    }
    app.exit(0);
  }, 800);
}
