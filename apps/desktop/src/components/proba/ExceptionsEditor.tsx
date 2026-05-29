import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { LockableTrigger } from './LockableTrigger';
import { computeNaturalDays } from '@/lib/schedule/compute';
import type { ScheduleOverrideRule } from '@/lib/schedule/types';
import { useWarehousesStore } from '@/lib/warehouses-store';
import type { Warehouse, WarehouseWeekday } from '@pyn/core';

interface ExceptionsEditorProps {
  year: number;
  month: number;
  holidays: number[];
  overrides: ScheduleOverrideRule[];
  onChange: (overrides: ScheduleOverrideRule[]) => void;
  children: ReactNode;
  /**
   * Collaboration lock resource_id (e.g. 'schedule:2026-05:exceptions').
   * Если undefined — popover работает без lock'а (для контекстов где
   * collab не нужен). Если задан — popover open захватывает lock, при
   * concurrent open другим юзером показывается overlay.
   */
  lockResourceId?: string;
  /** true — месяц зафиксирован: редактор не открывается, на hover tooltip. */
  locked?: boolean;
}

/**
 * Нормализуем правила: разворачиваем многосоставные (`codes: [a, b, c]`)
 * в отдельные одно-кодовые. UI оперирует one-code-per-rule, так проще
 * править каждый склад независимо. Display потом мерджит группы по
 * (shop, day, days) — см. groupOverrides.
 */
function normalizeOverrides(rules: readonly ScheduleOverrideRule[]): ScheduleOverrideRule[] {
  const out: ScheduleOverrideRule[] = [];
  for (const r of rules) {
    if (r.codes.length === 0) continue;
    if (r.codes.length === 1) {
      out.push({ id: r.id, codes: [r.codes[0]!], days: [...r.days] });
    } else {
      r.codes.forEach((c, i) => {
        out.push({ id: `${r.id}_${i}`, codes: [c], days: [...r.days] });
      });
    }
  }
  return out;
}

interface DisplayGroup {
  /** Уникальный ключ: shop|day|days. Все codes ниже шарят эту тройку. */
  key: string;
  shopName: string;
  weekday: WarehouseWeekday;
  /** Коды-склады в этой строке графика, отсортированы. */
  codes: string[];
  /** Эффективные дни доставки (override.days, общие для группы). */
  days: number[];
}

/**
 * Сгруппировать правила по «строке графика» — (shop, weekday, days).
 * Если у нескольких складов одного цеха+дня одинаковые override-дни —
 * они идут одной строкой и в графике (split не делается), и здесь
 * мерджатся в один display-entry. Пользователь видит компактную карту.
 */
function groupOverrides(
  rules: ScheduleOverrideRule[],
  byId: Map<string, Warehouse>,
): DisplayGroup[] {
  const map = new Map<string, DisplayGroup>();
  for (const rule of rules) {
    const code = rule.codes[0];
    if (!code) continue;
    const wh = byId.get(code);
    if (!wh?.delivery_day) continue;
    const sortedDays = [...rule.days].sort((a, b) => a - b);
    const daysKey = sortedDays.join(',');
    const key = `${wh.shop_name}|${wh.delivery_day}|${daysKey}`;
    const existing = map.get(key);
    if (existing) {
      existing.codes.push(code);
    } else {
      map.set(key, {
        key,
        shopName: wh.shop_name,
        weekday: wh.delivery_day,
        codes: [code],
        days: sortedDays,
      });
    }
  }
  // Стабильный порядок: сначала по shop_name, потом по weekday.
  const out = [...map.values()];
  for (const g of out) g.codes.sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  out.sort((a, b) => {
    const s = a.shopName.localeCompare(b.shopName, 'ru');
    if (s !== 0) return s;
    return a.weekday.localeCompare(b.weekday, 'ru');
  });
  return out;
}

/** Глубокое сравнение: два massiva одинаковы по содержанию? */
function rulesEqual(a: ScheduleOverrideRule[], b: ScheduleOverrideRule[]): boolean {
  if (a.length !== b.length) return false;
  const ak = a.map((r) => `${r.codes.join('|')}#${[...r.days].sort().join(',')}`).sort();
  const bk = b.map((r) => `${r.codes.join('|')}#${[...r.days].sort().join(',')}`).sort();
  return ak.every((k, i) => k === bk[i]);
}

/**
 * Popover «Исключения по доставке» — переопределение дней доставки для
 * отдельных складов / групп.
 *
 * UX:
 *  - draft-режим: правки видны только в попапе, в график не идут пока
 *    юзер не нажал «Подтвердить»
 *  - display-мердж: склады из одной строки графика (same shop+day+days)
 *    показываются одной карточкой со списком кодов и общими toggle-днями
 *  - добавление склада → создаёт новый rule с natural-днями weekday'a
 *    склада в текущем месяце (минус праздники). Юзер снимает лишние.
 *  - дни каждый месяц пользователь выбирает заново — при смене месяца
 *    дни автоматически сбрасываются на natural (см. ProbaScreen.inherit).
 */
export function ExceptionsEditor({
  year,
  month,
  holidays,
  overrides,
  onChange,
  children,
  lockResourceId,
  locked = false,
}: ExceptionsEditorProps) {
  const { t } = useTranslation();
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const byId = useWarehousesStore((s) => s.byId);
  const [open, setOpen] = useState(false);

  // Локальный draft: клонируем при открытии, мутируем локально, применяем
  // через onChange только по «Подтвердить».
  const [draft, setDraft] = useState<ScheduleOverrideRule[]>(() =>
    normalizeOverrides(overrides),
  );
  const [draftCode, setDraftCode] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  // Когда попап открывается — синкуем draft с актуальными overrides.
  // Если параллельно overrides поменялись извне (undo/redo, archive load) —
  // тоже синкуем, чтобы не показывать устаревший draft.
  useEffect(() => {
    if (open) {
      setDraft(normalizeOverrides(overrides));
      setDraftCode('');
      setDraftError(null);
    }
  }, [open, overrides]);

  const groups = useMemo(() => groupOverrides(draft, byId), [draft, byId]);
  const dirty = useMemo(
    () => !rulesEqual(draft, normalizeOverrides(overrides)),
    [draft, overrides],
  );

  const toggleDayInGroup = (group: DisplayGroup, day: number) => {
    const codeSet = new Set(group.codes);
    setDraft((prev) =>
      prev.map((r) => {
        if (r.codes.length === 0 || !codeSet.has(r.codes[0]!)) return r;
        const set = new Set(r.days);
        if (set.has(day)) set.delete(day);
        else set.add(day);
        return { ...r, days: [...set].sort((a, b) => a - b) };
      }),
    );
  };

  const removeGroup = (group: DisplayGroup) => {
    const codeSet = new Set(group.codes);
    setDraft((prev) =>
      prev.filter((r) => r.codes.length > 0 && !codeSet.has(r.codes[0]!)),
    );
  };

  const tryAddDraft = () => {
    const codeUpper = draftCode.trim().toUpperCase();
    if (!codeUpper) return;
    const wh = byId.get(codeUpper) ?? warehouses.find((w) => w.id.toUpperCase() === codeUpper);
    if (!wh) {
      setDraftError(t('proba.exceptions_err_not_found', { code: codeUpper }));
      return;
    }
    if (!wh.delivery_day) {
      setDraftError(t('proba.exceptions_err_no_day', { id: wh.id }));
      return;
    }
    if (draft.some((r) => r.codes[0]?.toUpperCase() === wh.id.toUpperCase())) {
      setDraftError(t('proba.exceptions_err_exists', { id: wh.id }));
      return;
    }
    // Новое правило — без выбранных дней. Empty days = «нет фильтра», склад
    // отображается на ВСЕХ natural-днях. Юзер кликает дни если хочет
    // ограничить (например только 12 и 26 вместо всех ЧТ).
    setDraft((prev) => [
      ...prev,
      { id: `ovr_${Date.now()}_${wh.id}`, codes: [wh.id], days: [] },
    ]);
    setDraftCode('');
    setDraftError(null);
  };

  const confirm = () => {
    onChange(draft.filter((r) => r.codes.length > 0));
    setOpen(false);
  };

  return (
    <Popover.Root open={locked ? false : open} onOpenChange={(o) => { if (!locked) setOpen(o); }}>
      <LockableTrigger locked={locked}>{children}</LockableTrigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[380px] rounded-lg border border-white/[0.08] bg-bg-elevated p-2.5 text-text-primary shadow-2xl outline-none"
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          <div className="mb-2 flex items-center justify-between px-0.5">
            <div className="text-[12px] font-medium text-text-strong">
              {t('proba.exceptions_dialog_title')}
            </div>
            {groups.length > 0 && (
              <div className="text-[11px] tabular-nums text-text-muted">
                {groups.reduce((acc, g) => acc + g.codes.length, 0)}
              </div>
            )}
          </div>

          {groups.length > 0 && (
            <div className="mb-2 flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-0.5">
              {groups.map((group) => (
                <GroupRow
                  key={group.key}
                  group={group}
                  year={year}
                  month={month}
                  holidays={holidays}
                  onToggleDay={(d) => toggleDayInGroup(group, d)}
                  onRemove={() => removeGroup(group)}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 border-t border-white/[0.06] pt-2">
            <input
              type="text"
              value={draftCode}
              onChange={(e) => {
                setDraftCode(e.target.value);
                if (draftError) setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tryAddDraft();
                }
              }}
              placeholder={t('proba.exceptions_placeholder')}
              maxLength={6}
              className="h-7 flex-1 rounded border border-white/[0.08] bg-bg-surface px-2 text-[11.5px] tabular-nums text-text-primary placeholder-text-muted/60 outline-none transition-colors focus:border-accent-clay/40"
            />
            <button
              type="button"
              onClick={tryAddDraft}
              disabled={draftCode.trim().length === 0}
              className="flex h-7 items-center gap-1 rounded px-2 text-[11.5px] font-medium text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
            >
              <Plus className="h-3 w-3" strokeWidth={1.75} />
              {t('proba.exceptions_add_btn')}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!dirty}
              className="flex h-7 items-center gap-1 rounded bg-accent-clay px-2 text-[11.5px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-accent-clay"
              title={dirty ? t('proba.exceptions_apply_tip') : t('proba.exceptions_no_changes_tip')}
            >
              <Check className="h-3 w-3" strokeWidth={1.75} />
              {t('proba.exceptions_confirm_btn')}
            </button>
          </div>
          {draftError && (
            <div className="mt-1.5 px-0.5 text-[10.5px] text-danger">{draftError}</div>
          )}
          </LockedEditorContent>

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface GroupRowProps {
  group: DisplayGroup;
  year: number;
  month: number;
  holidays: number[];
  onToggleDay: (day: number) => void;
  onRemove: () => void;
}

function GroupRow({ group, year, month, holidays, onToggleDay, onRemove }: GroupRowProps) {
  const { t } = useTranslation();
  // Все дни weekday'a месяца минус праздники — те же что в общем фильтре графика.
  const natural = useMemo(
    () => computeNaturalDays(year, month, group.weekday, holidays),
    [year, month, group.weekday, holidays],
  );
  const selectedSet = useMemo(() => new Set(group.days), [group.days]);

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
      {/* Codes — flex-wrap чтобы длинные списки не толкали дни на новую строку.
          Каждый код inline, переносится друг под другом если не помещаются. */}
      <div className="flex w-[110px] shrink-0 flex-wrap gap-x-1.5 gap-y-0.5 pt-1 text-[12px] font-medium tabular-nums text-text-strong">
        {group.codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex flex-1 flex-wrap gap-1">
        {natural.length === 0 ? (
          <span className="pt-1 text-[10.5px] text-text-muted/70">{t('proba.exceptions_no_days')}</span>
        ) : (
          natural.map((d) => {
            const selected = selectedSet.has(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onToggleDay(d)}
                className={[
                  'flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] tabular-nums outline-none transition-colors',
                  selected
                    ? 'bg-accent-clay text-white'
                    : 'border border-white/[0.10] text-text-muted hover:border-white/[0.18] hover:text-text-primary',
                ].join(' ')}
              >
                {d}
              </button>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-danger/15 hover:text-danger"
        title={t('proba.exceptions_remove_tip')}
      >
        <X size={11} strokeWidth={1.75} />
      </button>
    </div>
  );
}
