import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, X } from 'lucide-react';
import type { Person, PersonCreateInput, PersonPatch } from '@pyn/core';
import { cn } from '@/lib/cn';
import { createPerson, savePerson } from '@/lib/persons-repo';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';

/** Контекст окна: правка обычного контакта / орфана / создание нового. */
export type PersonEditTarget =
  | { mode: 'edit'; person: Person }
  | { mode: 'orphan'; person: Person }
  | { mode: 'create' };

interface PersonEditDialogProps {
  target: PersonEditTarget | null;
  /** Существующие статусы из БД — для выпадашки (не свободный ввод). */
  statuses: string[];
  onClose: () => void;
}

interface FormState {
  tab: string;
  fio: string;
  position: string;
  status: string;
  mobile: string;
  work: string;
  mail: string;
  comment: string;
}

const EMPTY_FORM: FormState = {
  tab: '', fio: '', position: '', status: '', mobile: '', work: '', mail: '', comment: '',
};

function formFromPerson(p: Person): FormState {
  return {
    tab: p.tab, fio: p.fio, position: p.position, status: p.status,
    mobile: p.mobile, work: p.work, mail: p.mail, comment: p.comment,
  };
}

/** Сырое → канон '+7XXXXXXXXXX' (как при импорте); иначе как есть. */
function toCanonMobile(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return `+7${d.slice(1)}`;
  if (d.length === 10) return `+7${d}`;
  return raw.trim();
}

/**
 * Окно правки/создания контакта. Блокировка как у карточки склада
 * (resource_id `person:{id}:edit`): один правит — другие ждут до «Подтвердить».
 * Поля по контексту: обычный → статус/моб/раб/почта/коммент; орфан → ФИО+тел+почта;
 * новый → все. Статус — выпадашка из существующих значений БД.
 */
export function PersonEditDialog({ target, statuses, onClose }: PersonEditDialogProps): JSX.Element {
  const { t } = useTranslation();
  const open = target !== null;
  const mode = target?.mode ?? 'create';
  const personId = target && target.mode !== 'create' ? target.person.id : null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm(target.mode === 'create' ? EMPTY_FORM : formFromPerson(target.person));
    setSaving(false);
  }, [target]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ФИО обязателен для нового и орфана (главное поле); у обычного — уже есть.
  const fioRequired = mode === 'create' || mode === 'orphan';
  const canSave = !saving && (!fioRequired || form.fio.trim().length > 0);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      const mobile = toCanonMobile(form.mobile);
      if (mode === 'create') {
        // is_mol НЕ задаём руками — МОЛ-статус приходит только из выгрузки (синка).
        const input: PersonCreateInput = {
          tab: form.tab.trim(), fio: form.fio.trim(), position: form.position.trim(),
          status: form.status.trim(), mobile, work: form.work.trim(), mail: form.mail.trim(),
          comment: form.comment.trim(),
        };
        await createPerson(input);
      } else if (personId !== null) {
        // Орфан: ФИО/тел/почта/коммент; обычный: статус/моб/раб/почта/коммент.
        const patch: PersonPatch = mode === 'orphan'
          ? {
              fio: form.fio.trim(), mobile, work: form.work.trim(),
              mail: form.mail.trim(), comment: form.comment.trim(),
            }
          : {
              status: form.status.trim(), mobile, work: form.work.trim(),
              mail: form.mail.trim(), comment: form.comment.trim(),
            };
        await savePerson(personId, patch);
      }
      onClose();
    } catch {
      // savePerson/createPerson уже откатили локально через refresh; окно оставляем.
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create'
    ? t('mol.edit.title_create')
    : mode === 'orphan'
      ? t('mol.edit.title_orphan')
      : t('mol.edit.title_edit');

  const showField = {
    tab: mode === 'create',
    fio: mode === 'create' || mode === 'orphan',
    position: mode === 'create',
    status: mode === 'create' || mode === 'edit',
    mobile: true,
    work: true,
    mail: true,
    comment: true,
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border-default bg-bg-elevated p-3.5 shadow-2xl outline-none">
          <Dialog.Title className="text-[13px] font-semibold text-text-strong">
            {title}
            {mode !== 'create' && personId !== null && form.tab && (
              <span className="ml-2 text-[11px] font-normal tabular-nums text-text-muted">
                {t('mol.tab_short')} {form.tab}
              </span>
            )}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>

          {/* Блокировка — только для существующего контакта (у нового нет id). */}
          <LockedEditorContent
            resourceId={personId !== null ? `person:${personId}:edit` : null}
            active={open && personId !== null}
          >
            <div className="mt-3 flex flex-col gap-2.5">
              {showField.tab && (
                <Field
                  label={t('mol.edit.field_tab')}
                  hint={t('mol.edit.tab_optional')}
                  value={form.tab}
                  onChange={(v) => set('tab', v)}
                  mono
                />
              )}
              {showField.fio && (
                <Field
                  label={t('mol.edit.field_fio')}
                  value={form.fio}
                  onChange={(v) => set('fio', v)}
                  required
                  autoFocus
                />
              )}
              {showField.position && (
                <Field label={t('mol.edit.field_position')} value={form.position} onChange={(v) => set('position', v)} />
              )}
              {showField.status && (
                <div>
                  <FieldLabel label={t('mol.edit.field_status')} />
                  <StatusDropdown
                    value={form.status}
                    options={statuses}
                    noneLabel={t('mol.edit.status_none')}
                    onChange={(v) => set('status', v)}
                  />
                </div>
              )}
              {showField.mobile && (
                <Field
                  label={t('mol.edit.field_mobile')}
                  value={form.mobile}
                  onChange={(v) => set('mobile', v)}
                  placeholder={t('mol.edit.ph_mobile')}
                  mono
                />
              )}
              {showField.work && (
                <Field label={t('mol.edit.field_work')} value={form.work} onChange={(v) => set('work', v)} mono />
              )}
              {showField.mail && (
                <Field
                  label={t('mol.edit.field_mail')}
                  value={form.mail}
                  onChange={(v) => set('mail', v)}
                  placeholder={t('mol.edit.ph_mail')}
                />
              )}
              {showField.comment && (
                <Field
                  label={t('mol.edit.field_comment')}
                  value={form.comment}
                  onChange={(v) => set('comment', v)}
                  placeholder={t('mol.edit.ph_comment')}
                />
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-1.5">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-7 rounded px-2.5 text-[11.5px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
                >
                  {t('mol.edit.cancel')}
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!canSave}
                className={cn(
                  'h-7 rounded px-3 text-[11.5px] font-medium outline-none transition-colors',
                  canSave ? 'bg-accent-clay text-white hover:bg-accent-clay-dim' : 'cursor-not-allowed bg-bg-hover text-text-muted',
                )}
              >
                {t('mol.edit.save')}
              </button>
            </div>
          </LockedEditorContent>

          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-2.5 top-2.5 text-text-muted outline-none transition-colors hover:text-text-strong"
            >
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
  label, value, onChange, placeholder, mono = false, required = false, autoFocus = false, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <input
        type="text"
        value={value}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded border bg-bg-surface px-2 py-1.5 text-[12.5px] text-text-primary outline-none',
          'placeholder:text-text-muted/60 focus:border-accent-clay/45',
          required && !value.trim() ? 'border-danger/40' : 'border-border-default',
          mono && 'font-mono tabular-nums',
        )}
      />
    </div>
  );
}

/** Выпадашка статуса — из существующих значений БД + пункт «—» (пусто). */
function StatusDropdown({
  value, options, noneLabel, onChange,
}: {
  value: string;
  options: string[];
  noneLabel: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const items = ['', ...options.filter((o) => o.trim().length > 0)];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded border border-border-default bg-bg-surface px-2 text-left text-[12.5px] outline-none transition-colors',
            'hover:border-accent-clay/40 data-[state=open]:border-accent-clay/45',
            value ? 'text-text-primary' : 'text-text-muted',
          )}
        >
          <span className="truncate">{value || noneLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] flex max-h-[240px] w-[var(--radix-popover-trigger-width)] flex-col overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1 shadow-2xl"
        >
          {items.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt || '__none'}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={cn(
                  'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors',
                  active ? 'bg-accent-clay/15 text-accent-clay' : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <span className="truncate">{opt || noneLabel}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
