/**
 * Правила ФИО для «полноценного» контакта (снять с панели «Новый МОЛ/контакт»).
 * Минимум 2 слова, в каждом >2 букв (буквы латиница/кириллица).
 * Примеры: «Долматов Иван» — ок; «Долматов» / «Долматовиванпетрович» — нет.
 */
export function isValidPersonFio(raw: string): boolean {
  const parts = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((w) => {
    const letters = w.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '');
    return letters.length > 2;
  });
}

/** Справочник-контакт без табельного (П1.13): «ФИО * наименование», минимум 3 символа. */
export function isValidDirectoryName(raw: string): boolean {
  return String(raw || '').trim().length >= 3;
}

/** Табельный: не короче 7 цифр (пример 1107243). */
export function isValidPersonTab(raw: string): boolean {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 7;
}

/** Есть ли табельный (цифры) — staff-контакт vs справочник. */
export function personTabDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}
