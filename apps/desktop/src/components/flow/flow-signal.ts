// ============================================================
// flow-signal.ts — ЕДИНАЯ модель сигналов Потока (ТЗ §4 RGB + §9 СЭД/OBD).
// ============================================================
// Один источник правды для: статуса СЭД+открытости OBD (Формирование/Отчёт/История/фильтры)
// и для RGB-сигнала строки Формирования (почему строка подсвечена). Палитры — здесь же,
// не размазаны по гридам.

/** Единый вердикт СЭД с учётом открытости OBD (ТЗ §9). Сводит сырой sed_status сервера
 *  («не передан/на подписании/подписан/отклонен/аннулирован») + sap_open в один статус. */
export type SedComputed =
  | 'not_started' // не запущен (нет передачи в СЭД)
  | 'pending' // на подписании
  | 'rejected' // отклонён/аннулирован
  | 'signed' // подписан И OBD закрыта (проводка есть) — всё хорошо
  | 'signed_open'; // подписан, НО OBD ещё открыта (проводки нет) — отдельная проблема

export function sedComputed(sedStatus: string | null | undefined, sapOpen: boolean): SedComputed {
  const s = String(sedStatus ?? '').trim().toLowerCase();
  if (s === 'отклонен' || s === 'отклонён' || s === 'аннулирован') return 'rejected';
  if (s === 'подписан') return sapOpen ? 'signed_open' : 'signed';
  if (s === 'на подписании') return 'pending';
  return 'not_started'; // '' | 'не передан' | прочее
}

/** Короткая подпись статуса СЭД (колонка СЭД, карточка Истории, фильтры). */
export const SED_LABEL: Record<SedComputed, string> = {
  not_started: 'не запущен',
  pending: 'на подписании',
  rejected: 'отклонён',
  signed: 'подписан',
  signed_open: 'подписан · OBD открыта',
};

/** Цвет статуса СЭД (пилюля/текст). Централизованная палитра. */
export const SED_COLOR: Record<SedComputed, string> = {
  not_started: '#9C9892', // серый — ещё не запускали
  pending: '#B45309', // янтарь — в работе
  rejected: '#E5484D', // красный — проблема
  signed: '#1F7A33', // зелёный — закрыто
  signed_open: '#C026D3', // кислотный пурпур — подписан, проводки нет (контрольный слой)
};

// ── RGB-сигнал строки Формирования (ТЗ §4) ──────────────────────────────────
// Почему строка подсвечена. Заменяет одиночный isCheatRow осмысленным набором причин.
export type FlowSignalKind =
  | 'repeat_done' // повторно попало ПОСЛЕ выполненной поставки (увезли = снова открыто, кол-во совпало) — радуга
  | 'signed_open' // СЭД подписан, но OBD ещё открыта (нет проводки) — контрольный, кислотный
  | 'sed_pending'; // СЭД не подписан / на подписании / отклонён — нужно довести документ

/**
 * Вердикт RGB-сигнала строки по реальному бизнес-состоянию (приоритет сверху вниз).
 * `cheat` — результат isCheatRow (полная повторяшка). `sed` — снимок СЭД активной поставки
 * якоря (status + открытость OBD). null — обычная строка (красят стадия/MOL/STAT отдельно).
 */
export function flowSignalKind(
  cheat: boolean,
  sed: { status: string; open: boolean } | undefined,
): FlowSignalKind | null {
  if (cheat) return 'repeat_done';
  if (!sed) return null;
  const c = sedComputed(sed.status, sed.open);
  if (c === 'signed_open') return 'signed_open';
  if (c === 'pending' || c === 'rejected') return 'sed_pending';
  return null; // signed (закрыто) / not_started — RGB-сигнала нет
}

/** Конфиг анимированного «вжуха» для не-радужных сигналов (rgb + базовая/пиковая альфа). */
export const SIGNAL_SWEEP: Record<Exclude<FlowSignalKind, 'repeat_done'>, { rgb: string; base: number; peak: number }> = {
  signed_open: { rgb: '192,38,211', base: 0.16, peak: 0.5 }, // кислотный пурпур (= SED_COLOR.signed_open)
  sed_pending: { rgb: '201,75,75', base: 0.16, peak: 0.46 }, // приглушённый красный
};
