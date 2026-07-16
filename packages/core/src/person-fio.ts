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
