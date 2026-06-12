import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { flowVghEdit } from '@pyn/core';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { useVghStore } from '@/lib/vgh-store';
import { ensureVghLoaded, applyVghChanged } from '@/lib/vgh-repo';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { loadWarehousesFromCache } from '@/lib/warehouses-repo';
import { autoWeightByUom, computeVolume, fmtSmart, fmtVolume, isPieceUom } from './vgh-staging.fixtures';
import { formatDateRu } from '@/components/flow/flow-sandbox.fixtures';

/** Подсказки из строки промежуточного листа (когда карточку открыли оттуда). */
export interface VghCardSeed {
  mat?: string;
  uom?: string;
  fr?: string;
  weightHint?: number | null;
}

interface VghEditCardProps {
  noNum: string | null;
  /** Режим добавления нового материала: поля пустые, номенклатура/наименование/ЕИ —
   *  редактируемые и обязательные; кнопка «Сохранить» (у правки существующего — «Применить»). */
  addMode?: boolean;
  seed?: VghCardSeed | null;
  /** Жёлтая плашка вверху — показывается ТОЛЬКО при конфликте расчётного статуса
   *  (снять/сменить мет_ок/мало). По обычному двойному клику по номенклатуре — без неё. */
  note?: string;
  onClose: () => void;
}

interface FormState {
  no_num: string;
  mat: string;
  uom: string;
  tech_name: string;
  weight_kg: string;
  len_mm: string;
  wid_mm: string;
  hgt_mm: string;
  min_qty: string;
}

const EMPTY: FormState = { no_num: '', mat: '', uom: '', tech_name: '', weight_kg: '', len_mm: '', wid_mm: '', hgt_mm: '', min_qty: '' };

/** Текст → число|null. Разряды пробелом и запятая-десятич — ок. Пусто → null. */
function parseNum(s: string): number | null {
  const t = s.replace(/\s+/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Число → текст для поля ввода: запятая-десятич (как везде в Pyn), без хвостовых нулей. */
function numToStr(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : String(n).replace('.', ',');
}

/**
 * Карточка номенклатуры базы ВГХ. Два режима:
 *  • ПРАВКА существующей (формирование/план/отчёт, поиск): наименование/ЕИ/тех-имя — показ,
 *    правятся вес/габариты/норма; кнопка «Применить»; блокировка строки (resource `vgh:{no}:edit`).
 *  • ДОБАВЛЕНИЕ (кнопка «+ Материал» в ВГХ): поля пустые, номенклатура/наименование/ЕИ/вес
 *    обязательны; кнопка «Сохранить».
 * Вес для Т/КГ/Г и MIN QTY для штучных — авто и заблокированы (не дать ошибиться).
 * Сохранение → сервер (`flow_vgh_edit`, upsert) + реалтайм всем (`vgh_changed`).
 */
export function VghEditCard({ noNum, addMode = false, seed, note, onClose }: VghEditCardProps): JSX.Element {
  const open = noNum !== null || addMode;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  // Склады-отправители — список пилюль; добавлять можно ТОЛЬКО из базы «Цеха» (комбобокс).
  // Старый цех, которого уже нет в базе, ХРАНИМ и НЕ даём удалить (история); активные —
  // можно убрать. При добавлении новой номенклатуры — обязателен ≥1 (юзер 2026-06-07).
  const [whList, setWhList] = useState<string[]>([]);
  const [whInput, setWhInput] = useState('');
  const [whOpen, setWhOpen] = useState(false);
  const allWh = useWarehousesStore((s) => s.warehouses);
  // код → { имя, активен(не удалён) } — для подсказок и блокировки удаления старых.
  const whByCode = useMemo(() => {
    const m = new Map<string, { name: string; active: boolean }>();
    for (const w of allWh) m.set(w.id, { name: w.shop_name || '', active: w.is_removed === 0 });
    return m;
  }, [allWh]);
  // Кандидаты на добавление — АКТИВНЫЕ склады базы, ещё не в списке, по фильтру ввода.
  const whOptions = useMemo(() => {
    const q = whInput.trim().toLowerCase();
    const inList = new Set(whList);
    const out: { id: string; name: string }[] = [];
    for (const w of allWh) {
      if (w.is_removed !== 0 || inList.has(w.id)) continue;
      if (q && !w.id.toLowerCase().includes(q) && !(w.shop_name || '').toLowerCase().includes(q)) continue;
      out.push({ id: w.id, name: w.shop_name || '' });
      if (out.length >= 40) break;
    }
    return out;
  }, [allWh, whInput, whList]);
  // Добавить — ТОЛЬКО валидный активный код базы (из выпадашки/точного совпадения).
  const addWhCode = (code: string): void => {
    const v = code.trim().replace(/\s+/g, '');
    if (v && whByCode.get(v)?.active && !whList.includes(v)) setWhList((p) => [...p, v]);
    setWhInput('');
    setWhOpen(false);
  };
  // Убрать — только активные (в базе); старые-отсутствующие в базе заблокированы (храним).
  const removeWh = (w: string): void => {
    if (whByCode.get(w)?.active) setWhList((p) => p.filter((x) => x !== w));
  };

  // Ключ: в правке — из пропа; в добавлении — из набираемого поля номенклатуры.
  const editNoNum = (addMode ? form.no_num : noNum ?? '').trim();
  // Источник данных: правка — по noNum; добавление — следим за набранной номенклатурой
  // (если она УЖЕ в базе → подтягиваем = защита от дублей, добавление превращается в правку).
  const base = useVghStore((s) => (editNoNum ? s.get(editNoNum) : undefined));
  const isDup = addMode && !!base;     // в добавлении набрали существующую → правим её
  const editing = !addMode || isDup;   // редактируем существующий материал

  useEffect(() => {
    if (open) { void ensureVghLoaded(); void loadWarehousesFromCache(); }
  }, [open]);

  // Сброс формы при ОТКРЫТИИ режима добавления (поля пустые; склады — из seed.fr, если открыли
  // из промежуточного листа, иначе пусто — пользователь впишет, обязателен ≥1).
  useEffect(() => {
    if (open && addMode) {
      setForm(EMPTY);
      setWhList(seed?.fr ? [seed.fr.trim()] : []);
      setWhInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, addMode]);

  // Синхронизация формы с базой: правка/дубль → данные из базы (в добавлении номер набирает
  // пользователь — его не перетираем); ушли с существующей на новый номер → очистить подтянутое.
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    if (base) {
      setForm((f) => ({
        no_num: addMode ? f.no_num : (base.no_num ?? ''),
        mat: base.mat ?? '',
        uom: base.uom ?? '',
        tech_name: base.tech_name ?? '',
        weight_kg: numToStr(base.weight_kg),
        len_mm: numToStr(base.len_mm),
        wid_mm: numToStr(base.wid_mm),
        hgt_mm: numToStr(base.hgt_mm),
        min_qty: numToStr(base.min_qty),
      }));
      // Склады-отправители из базы → редактируемый список (правка/дубль).
      setWhList(String(base.warehouses ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
    } else if (addMode) {
      setForm((f) => ({ ...f, mat: '', uom: '', tech_name: '', weight_kg: '', len_mm: '', wid_mm: '', hgt_mm: '', min_qty: '' }));
      // whList в добавлении ведёт пользователь (инициализация в эффекте открытия) — не трогаем.
    } else {
      setForm({ ...EMPTY, no_num: noNum ?? '', mat: seed?.mat ?? '', uom: seed?.uom ?? '' });
      setWhList(seed?.fr ? [seed.fr.trim()] : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base, seed, noNum, addMode]);

  const set = <K extends keyof FormState>(key: K, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const volume = useMemo(
    () => computeVolume(parseNum(form.len_mm), parseNum(form.wid_mm), parseNum(form.hgt_mm)),
    [form.len_mm, form.wid_mm, form.hgt_mm],
  );

  // Авто-значения по ЕИ (нельзя менять): вес для Т/КГ/Г, MIN QTY=1 для штучных.
  const autoW = autoWeightByUom(form.uom);
  const minLocked = isPieceUom(form.uom);
  const effWeight = autoW != null ? autoW : parseNum(form.weight_kg);
  const effMinQty = minLocked ? 1 : parseNum(form.min_qty);

  // Вес на 1 ЕИ ОБЯЗАН быть > 0 (юзер 2026-06-12, п.10): нулевой вес (все нули до и после
  // запятой) запрещён и при добавлении, и при правке. Авто-вес по ЕИ (Т/КГ/Г) всегда > 0.
  const weightValid = effWeight != null && effWeight > 0;
  // Показ ошибки на поле веса — только когда вводится руками и юзер ввёл нулевое/некорректное.
  const weightInvalid = autoW == null && form.weight_kg.trim() !== '' && !weightValid;

  // Добавление НОВОЙ: обязательны номенклатура + наименование + ЕИ + вес>0 + ≥1 склад-отправитель.
  // Правка/дубль — данные уже есть, но вес>0 проверяем всегда (запрет нулевого веса).
  const canSave =
    weightValid &&
    (editing ||
      (editNoNum !== '' && form.mat.trim() !== '' && form.uom.trim() !== '' && whList.length > 0));

  const save = async (): Promise<void> => {
    if (!editNoNum || saving || !canSave) return;
    setSaving(true);
    try {
      const fields = {
        mat: form.mat.trim(),
        uom: form.uom.trim(),
        tech_name: form.tech_name.trim(),
        weight_kg: effWeight,
        len_mm: parseNum(form.len_mm),
        wid_mm: parseNum(form.wid_mm),
        hgt_mm: parseNum(form.hgt_mm),
        min_qty: effMinQty,
        warehouses: whList.join(', '), // склады-отправители — задаём списком (добавили/убрали)
      };
      const res = await flowVghEdit(api, { no_num: editNoNum, row_version: base?.row_version ?? 0, fields });
      if (res.row) applyVghChanged([res.row]);
      onClose();
    } catch {
      /* оставляем окно — пользователь повторит */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border-default bg-bg-elevated p-3.5 shadow-2xl outline-none">
          <Dialog.Title className="flex items-baseline gap-2 text-[13px] font-semibold text-text-strong">
            {editing ? 'Номенклатура' : 'Новый материал'}
            {editing && editNoNum && <span className="text-[11px] font-normal tabular-nums text-text-muted">№ {editNoNum}</span>}
            {editing && !base && <span className="text-[10.5px] font-normal text-accent-clay">новая в базе</span>}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Вес-габаритные характеристики номенклатуры</Dialog.Description>

          {note && (
            <div className="mt-2 rounded-md border border-accent-clay/30 bg-accent-clay/[0.08] px-2.5 py-1.5 text-[11.5px] leading-snug text-text-secondary">
              {note}
            </div>
          )}
          {isDup && (
            <div className="mt-2 rounded-md border border-accent-clay/30 bg-accent-clay/[0.08] px-2.5 py-1.5 text-[11.5px] leading-snug text-text-secondary">
              Материал с этой номенклатурой уже есть в базе. Скорректировать?
            </div>
          )}

          <LockedEditorContent resourceId={editing && editNoNum ? `vgh:${editNoNum}:edit` : null} active={open && editing}>
            <div className="mt-3 flex flex-col gap-2.5">
              {/* Номенклатура: в добавлении — ввод (обязательна), в правке — в заголовке. */}
              {addMode && (
                <Field label="Номенклатура (NO. №)" value={form.no_num} onChange={(v) => set('no_num', v)} mono autoFocus required />
              )}
              {/* Наименование/ЕИ/тех-имя: вводим только при добавлении НОВОЙ; правка/дубль — показ (авто). */}
              {!editing ? (
                <Field label="Наименование" value={form.mat} onChange={(v) => set('mat', v)} required />
              ) : (
                <ReadField label="Наименование" value={form.mat || '—'} />
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {!editing ? (
                  <Field label="ЕИ" value={form.uom} onChange={(v) => set('uom', v)} mono required />
                ) : (
                  <ReadField label="ЕИ" value={form.uom || '—'} mono />
                )}
                {autoW != null ? (
                  <ReadField label="Вес, кг (на 1 ЕИ)" value={fmtSmart(autoW, 3)} mono hint="по ЕИ" />
                ) : (
                  <Field
                    label="Вес, кг (на 1 ЕИ)"
                    value={form.weight_kg}
                    onChange={(v) => set('weight_kg', v)}
                    mono
                    required={!editing}
                    invalid={weightInvalid}
                    hint={weightInvalid ? 'не может быть 0' : undefined}
                    autoFocus={!addMode && !note}
                    placeholder={seed?.weightHint != null ? `≈ ${fmtSmart(seed.weightHint, 3)}` : undefined}
                  />
                )}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Длина, мм" value={form.len_mm} onChange={(v) => set('len_mm', v)} mono />
                <Field label="Ширина, мм" value={form.wid_mm} onChange={(v) => set('wid_mm', v)} mono />
                <Field label="Высота, мм" value={form.hgt_mm} onChange={(v) => set('hgt_mm', v)} mono />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <FieldLabel label="Объём, м³" hint="Д×Ш×В · авто" />
                  <div className="flex h-[34px] items-center rounded border border-border-subtle bg-bg-surface/60 px-2 text-[12.5px] tabular-nums text-text-secondary">
                    {volume != null ? fmtVolume(volume) : '—'}
                  </div>
                </div>
                {/* Транспортная норма = MIN QTY; для штучных = 1 (авто, минимум 1 шт), блок. */}
                {minLocked ? (
                  <ReadField label="Транспортная норма" value="1" mono />
                ) : (
                  <Field label="Транспортная норма" value={form.min_qty} onChange={(v) => set('min_qty', v)} mono autoFocus={!addMode && !!note} />
                )}
              </div>
              <ReadField label="Тех-имя" value={form.tech_name || '—'} />

              {/* Склады-отправители — добавляем ТОЛЬКО из базы «Цеха» (комбобокс). Старый цех,
                  которого уже нет в базе, хранится и НЕ удаляется (приглушён, без ×). */}
              <div>
                <FieldLabel label={!editing ? 'Склады-отправители *' : 'Склады-отправители'} hint="из базы Цеха" />
                <div className="flex flex-wrap items-center gap-1">
                  {whList.map((w) => {
                    const known = whByCode.get(w);
                    const removable = known?.active === true;
                    return (
                      <span
                        key={w}
                        title={known ? (known.active ? known.name : `${known.name} · удалён из базы — храним`) : 'нет в базе — храним'}
                        className={cn(
                          'flex items-center gap-1 rounded-md border py-0.5 pl-1.5 font-mono text-[11px] tabular-nums',
                          removable
                            ? 'border-accent-clay/30 bg-bg-surface/60 pr-1 text-text-secondary'
                            : 'border-border-subtle bg-bg-surface/40 pr-1.5 text-text-muted/70',
                        )}
                      >
                        {w}
                        {removable && (
                          <button
                            type="button"
                            onClick={() => removeWh(w)}
                            className="text-text-muted outline-none transition-colors hover:text-text-strong"
                            aria-label={`Убрать ${w}`}
                          >
                            <X className="h-2.5 w-2.5" strokeWidth={2.25} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  <div className="relative">
                    <input
                      type="text"
                      value={whInput}
                      onChange={(e) => { setWhInput(e.target.value); setWhOpen(true); }}
                      onFocus={() => setWhOpen(true)}
                      onBlur={() => window.setTimeout(() => setWhOpen(false), 120)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); if (whOptions[0]) addWhCode(whOptions[0].id); }
                        else if (e.key === 'Escape') setWhOpen(false);
                      }}
                      placeholder="+ склад"
                      spellCheck={false}
                      className={cn(
                        'w-[88px] rounded border bg-bg-surface px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-text-primary outline-none',
                        'placeholder:text-text-muted/50 focus:border-accent-clay/60',
                        !editing && whList.length === 0 ? 'border-accent-clay/55' : 'border-accent-clay/30',
                      )}
                    />
                    {whOpen && whOptions.length > 0 && (
                      <div className="absolute left-0 top-full z-10 mt-1 max-h-44 w-60 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                        {whOptions.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); addWhCode(o.id); }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-strong"
                          >
                            <span className="shrink-0 font-mono tabular-nums text-[11px] text-text-muted">{o.id}</span>
                            <span className="min-w-0 flex-1 truncate">{o.name || '—'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Кто/когда — только для показа (правке не подлежат); дата как в приложении. */}
              {base && (base.updated_by || base.updated_at) && (
                <div className="mt-0.5 text-[10.5px] text-text-muted/70">
                  Изменил: {base.updated_by || '—'}{base.updated_at ? ` · ${formatDateRu(base.updated_at)}` : ''}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-1.5">
              <Dialog.Close asChild>
                <button type="button" className="h-7 rounded px-2.5 text-[11.5px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong">
                  Отмена
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !canSave}
                className={cn(
                  'h-7 rounded px-3 text-[11.5px] font-medium outline-none transition-colors',
                  !saving && canSave ? 'bg-accent-clay text-white hover:bg-accent-clay-dim' : 'cursor-not-allowed bg-bg-hover text-text-muted',
                )}
              >
                {editing ? 'Применить' : 'Сохранить'}
              </button>
            </div>
          </LockedEditorContent>

          <Dialog.Close asChild>
            <button type="button" className="absolute right-2.5 top-2.5 text-text-muted outline-none transition-colors hover:text-text-strong">
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Поле только для показа (read-only) — наименование/ЕИ/тех-имя/авто-значения. */
function ReadField({ label, value, mono = false, hint }: { label: string; value: string; mono?: boolean; hint?: string }): JSX.Element {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <div
        className={cn(
          'flex min-h-[34px] items-center rounded border border-border-subtle bg-bg-surface/60 px-2 py-1.5 text-[12.5px] text-text-secondary [overflow-wrap:anywhere]',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }): JSX.Element {
  return (
    <span className="mb-1 flex items-center gap-1.5 text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
      {label}
      {hint && <span className="font-normal normal-case tracking-normal text-text-muted/60">· {hint}</span>}
    </span>
  );
}

function Field({
  label, value, onChange, placeholder, mono = false, autoFocus = false, required = false, invalid = false, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  invalid?: boolean;
  hint?: string;
}): JSX.Element {
  const empty = required && value.trim() === '';
  return (
    <div>
      <FieldLabel label={required ? `${label} *` : label} hint={hint} />
      <input
        type="text"
        value={value}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          // Редактируемые поля обводим НАШИМ (clay) цветом — заметнее, что меняемо (юзер 2026-06-07).
          'w-full rounded border bg-bg-surface px-2 py-1.5 text-[12.5px] text-text-primary outline-none',
          'placeholder:text-text-muted/60 focus:border-accent-clay/60',
          invalid ? 'border-danger/60' : empty ? 'border-accent-clay/55' : 'border-accent-clay/30',
          mono && 'font-mono tabular-nums',
        )}
      />
    </div>
  );
}
