/**
 * persons-view — чистые хелперы вкладки «Контакты»: поиск/сортировка по персонам
 * и список статусов для выпадашки. Режим запроса переиспользует parseMolQuery
 * (склад/телефон/почта/ФИО), но матчинг идёт по Person (со складами-массивом).
 */

import { warehouseCodeKey, type ParsedMolQuery, type Person } from '@pyn/core';
import { molStatusKind } from './mol-format';

/** Подходит ли контакт под разобранный запрос (по всей базе, как у МОЛ). */
export function matchesPersonQuery(p: Person, parsed: ParsedMolQuery): boolean {
  if (parsed.mode === 'empty') return false;
  const t0 = parsed.tokens[0] ?? '';
  switch (parsed.mode) {
    case 'warehouse': {
      if (parsed.tokens.length === 0) return false;
      // Латиница/кириллица 4-й буквы: 824T ≡ 824Т (выгрузка SAP бывает и так, и так).
      const codeKeys = new Set(
        p.warehouses.map((w) => warehouseCodeKey(w.code)).filter(Boolean),
      );
      return parsed.tokens.some((t) => codeKeys.has(warehouseCodeKey(t)));
    }
    case 'phone': {
      const q = t0;
      if (!q) return false;
      const mobile = p.mobile.replace(/\D/g, '');
      const work = p.work.replace(/\D/g, '');
      const tab = p.tab.replace(/\D/g, '');
      return mobile.includes(q) || work.includes(q) || (tab.length > 0 && tab.includes(q));
    }
    case 'email':
      return p.mail.toLowerCase().includes(t0.toLowerCase());
    case 'name': {
      const q = t0.toLowerCase();
      return (
        p.fio.toLowerCase().includes(q)
        || p.position.toLowerCase().includes(q)
        || p.tab.toLowerCase().includes(q)
        || p.comment.toLowerCase().includes(q)
      );
    }
    default:
      return false;
  }
}

/** Сортировка контактов: «работает» → прочие → без статуса, внутри — по ФИО. */
export function sortPersons(persons: Person[]): Person[] {
  const order: Record<'ok' | 'error' | 'neutral', number> = { ok: 0, error: 1, neutral: 2 };
  return [...persons].sort((a, b) => {
    const ka = order[molStatusKind(a.status)];
    const kb = order[molStatusKind(b.status)];
    if (ka !== kb) return ka - kb;
    return a.fio.localeCompare(b.fio, 'ru', { sensitivity: 'base' });
  });
}

/** Уникальные непустые статусы из базы — для выпадашки (не свободный ввод). */
export function distinctStatuses(persons: Person[]): string[] {
  const set = new Set<string>();
  for (const p of persons) {
    const s = p.status.trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}
