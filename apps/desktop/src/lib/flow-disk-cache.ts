/**
 * flow-disk-cache — дисковый кэш листов Потока (строки Формирования / Плана /
 * Транспорта): мгновенный старт после ПЕРЕЗАПУСКА приложения (сессионные
 * module-кэши гридов живут только до закрытия), сервер догоняет фоном тем же
 * fetch'ем. Тот же шифрованный pyn:cache IPC, что у базы персон (persons-repo).
 *
 * Сохранение — debounce с getter'ом: правки/WS сыпятся часто, пишем на диск не
 * чаще раза в пару секунд и всегда СВЕЖИЙ снимок (getter читает ref, не замыкание).
 */

export async function loadFlowDiskCache<T>(name: string): Promise<T | null> {
  try {
    const raw = await window.pyn?.cache?.load(name);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function saveFlowDiskCacheDebounced(name: string, get: () => unknown, delayMs = 2000): void {
  const t = saveTimers.get(name);
  if (t) clearTimeout(t);
  saveTimers.set(
    name,
    setTimeout(() => {
      saveTimers.delete(name);
      try {
        const payload = get();
        if (payload == null) return;
        void window.pyn?.cache?.save(name, JSON.stringify(payload)).catch(() => undefined);
      } catch {
        /* сериализация/IPC не удались — кэш просто не обновится, данные не трогаем */
      }
    }, delayMs),
  );
}
