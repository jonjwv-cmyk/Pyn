/**
 * Нормализация полей контакта для хранения в persons.
 * UI-форматирование телефонов — отдельно (formatMobilePhone / formatWorkPhone).
 */

/** ФИО: каждое слово с заглавной, остальное строчные. Инициалы: «Е.» / «Н.». */
export function normalizePersonFio(raw: string): string {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      // Инициал: Е / Е. / E.
      const init = /^([a-zA-Zа-яА-ЯёЁ])\.?$/u.exec(word);
      if (init) {
        return `${init[1]!.toLocaleUpperCase('ru-RU')}.`;
      }
      const lower = word.toLocaleLowerCase('ru-RU');
      if (!lower) return word;
      return lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
    })
    .join(' ');
}

/**
 * Почта: local@domain — domain lower;
 * сегменты local через «.»: первая буква upper, остальное lower.
 * Svetlana.Kharlamova@evraz.com
 */
export function normalizePersonMail(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const at = s.lastIndexOf('@');
  if (at <= 0) return s.toLowerCase();
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  const localNorm = local
    .split('.')
    .map((part) => {
      if (!part) return part;
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('.');
  return `${localNorm}@${domain}`;
}

/**
 * Сотовый для хранения/набора: +7XXXXXXXXXX (11 цифр после +).
 * UI показывает 8 901 438 8831 через formatMobilePhone.
 */
export function normalizePersonMobileStorage(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }
  if (digits.length === 11 && digits[0] === '7') return `+${digits}`;
  // Нестандартная длина — не ломаем: как ввели (trim).
  return trimmed;
}

/**
 * Рабочий для хранения: только внутренний номер цифрами (71415).
 * City/country 73435… срезается. UI: formatWorkPhone → «7 14 15».
 * Набор с city-кодом — на клиенте (Android +83435…), не в БД.
 */
export function normalizePersonWorkStorage(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (digits.length >= 10 && (digits[0] === '7' || digits[0] === '8')) {
    digits = digits.slice(5);
  }
  return digits || trimmed;
}
