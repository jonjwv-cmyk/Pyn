/**
 * Извлекает 1-2 буквенные initials из полного имени.
 * "Анна Соколова" → "АС", "Jon" → "JO", пустая строка → "?".
 */
export function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const single = parts[0] ?? '';
    return single.slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}
