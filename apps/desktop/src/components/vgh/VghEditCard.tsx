import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { flowVghEdit } from '@pyn/core';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { useVghStore } from '@/lib/vgh-store';
import { ensureVghLoaded, applyVghChanged } from '@/lib/vgh-repo';
import { computeVolume, fmtSmart } from './vgh-staging.fixtures';

/** Подсказки из строки промежуточного листа (когда карточку открыли оттуда). */
export interface VghCardSeed {
  mat?: string;
  uom?: string;
  fr?: string;
  weightHint?: number | null;
}

interface VghEditCardProps {
  noNum: string | null;
  seed?: VghCardSeed | null;
  onClose: () => void;
}

interface FormState {
  mat: string;
  uom: string;
  tech_name: string;
  weight_kg: string;
  len_mm: string;
  wid_mm: string;
  hgt_mm: string;
  min_qty: string;
}

const EMPTY: FormState = { mat: '', uom: '', tech_name: '', weight_kg: '', len_mm: '', wid_mm: '', hgt_mm: '', min_qty: '' };

/** Текст → число|null (запятая-десятич ок). Пусто → null. */
function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function numToStr(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : String(n);
}

/**
 * Карточка правки номенклатуры базы ВГХ (как карточка склада / контакт МОЛ):
 * все поля редактируемые КРОМЕ «кто менял» и «дата/время» (они авто). Блокировка
 * строки на время правки (resource `vgh:{no_num}:edit`, общий schedule_lock).
 * Сохранение → сервер (`flow_vgh_edit`, upsert) + реалтайм всем (`vgh_changed`).
 */
export function VghEditCard({ noNum, seed, onClose }: VghEditCardProps): JSX.Element {
  const open = noNum !== null;
  const base = useVghStore((s) => (noNum ? s.get(noNum) : undefined));
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) void ensureVghLoaded(); }, [open]);

  useEffect(() => {
    if (!open) return;
    if (base) {
      setForm({
        mat: base.mat ?? '',
        uom: base.uom ?? '',
        tech_name: base.tech_name ?? '',
        weight_kg: numToStr(base.weight_kg),
        len_mm: numToStr(base.len_mm),
        wid_mm: numToStr(base.wid_mm),
        hgt_mm: numToStr(base.hgt_mm),
        min_qty: numToStr(base.min_qty),
      });
    } else {
      // Нет в базе (открыли из списка дозаполнения) — префилл из подсказки.
      setForm({ ...EMPTY, mat: seed?.mat ?? '', uom: seed?.uom ?? '' });
    }
    setSaving(false);
  }, [open, base, seed]);

  const set = <K extends keyof FormState>(key: K, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const volume = useMemo(
    () => computeVolume(parseNum(form.len_mm), parseNum(form.wid_mm), parseNum(form.hgt_mm)),
    [form.len_mm, form.wid_mm, form.hgt_mm],
  );

  const save = async (): Promise<void> => {
    if (!noNum || saving) return;
    setSaving(true);
    try {
      const fields = {
        mat: form.mat.trim(),
        uom: form.uom.trim(),
        tech_name: form.tech_name.trim(),
        weight_kg: parseNum(form.weight_kg),
        len_mm: parseNum(form.len_mm),
        wid_mm: parseNum(form.wid_mm),
        hgt_mm: parseNum(form.hgt_mm),
        min_qty: parseNum(form.min_qty),
      };
      const res = await flowVghEdit(api, { no_num: noNum, row_version: base?.row_version ?? 0, fields });
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
            Номенклатура ВГХ
            <span className="text-[11px] font-normal tabular-nums text-text-muted">№ {noNum}</span>
            {!base && <span className="text-[10.5px] font-normal text-accent-clay">новая в базе</span>}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Правка вес-габаритных характеристик номенклатуры</Dialog.Description>

          <LockedEditorContent resourceId={noNum ? `vgh:${noNum}:edit` : null} active={open}>
            <div className="mt-3 flex flex-col gap-2.5">
              <Field label="Наименование (MAT)" value={form.mat} onChange={(v) => set('mat', v)} autoFocus />
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Единица (ЕИ)" value={form.uom} onChange={(v) => set('uom', v)} />
                <Field label="Вес, кг (на 1 ЕИ)" value={form.weight_kg} onChange={(v) => set('weight_kg', v)} mono placeholder={seed?.weightHint != null ? `≈ ${fmtSmart(seed.weightHint, 3)}` : undefined} />
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
                    {volume != null ? fmtSmart(volume, 6) : '—'}
                  </div>
                </div>
                <Field label="MIN QTY" value={form.min_qty} onChange={(v) => set('min_qty', v)} mono />
              </div>
              <Field label="Тех-имя (ГОСТ)" value={form.tech_name} onChange={(v) => set('tech_name', v)} />

              {/* Кто/когда — только для показа (правке не подлежат). */}
              {base && (base.updated_by || base.updated_at) && (
                <div className="mt-0.5 text-[10.5px] text-text-muted/70">
                  Изменил: {base.updated_by || '—'}{base.updated_at ? ` · ${base.updated_at}` : ''}
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
                disabled={saving}
                className={cn(
                  'h-7 rounded px-3 text-[11.5px] font-medium outline-none transition-colors',
                  !saving ? 'bg-accent-clay text-white hover:bg-accent-clay-dim' : 'cursor-not-allowed bg-bg-hover text-text-muted',
                )}
              >
                Сохранить
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

function FieldLabel({ label, hint }: { label: string; hint?: string }): JSX.Element {
  return (
    <span className="mb-1 flex items-center gap-1.5 text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
      {label}
      {hint && <span className="font-normal normal-case tracking-normal text-text-muted/60">· {hint}</span>}
    </span>
  );
}

function Field({
  label, value, onChange, placeholder, mono = false, autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <div>
      <FieldLabel label={label} />
      <input
        type="text"
        value={value}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[12.5px] text-text-primary outline-none',
          'placeholder:text-text-muted/60 focus:border-accent-clay/45',
          mono && 'font-mono tabular-nums',
        )}
      />
    </div>
  );
}
