import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Copy, X } from 'lucide-react';
import {
  BROADCAST_GROUPS,
  BROADCAST_PURPOSE_OPTIONAL_GROUPS,
  isValidPersonFio,
  normalizePersonFio,
  normalizePersonMail,
  normalizePersonMobileStorage,
  normalizePersonWorkStorage,
  serializeBroadcastApprovalWarehouses,
  type Person,
  type PersonCreateInput,
  type PersonPatch,
} from '@pyn/core';
import { cn } from '@/lib/cn';
import { createPerson, savePerson } from '@/lib/persons-repo';
import {
  usePersonEditStore,
  type PersonEditFormState,
} from '@/lib/person-edit-store';
import { EditorLockedOverlay } from '@/components/schedule/EditorLockedOverlay';
import { useEditLock } from '@/lib/schedule/use-edit-lock';
import { ApprovalWarehousesPanel } from './ApprovalWarehousesPanel';

const TRANSPORT_FLOW_ROLE_GROUPS = new Set(['Экспедиторы', 'Водители-экспедиторы']);

/** Контекст окна: правка обычного контакта / орфана / создание нового. */
export type PersonEditTarget =
  | { mode: 'edit'; person: Person }
  | { mode: 'orphan'; person: Person }
  | { mode: 'create' };

interface PersonEditDialogProps {
  /** Существующие статусы из БД — для выпадашки (не свободный ввод). */
  statuses: string[];
}

function broadcastPatchFromForm(form: PersonEditFormState): Pick<
  PersonPatch,
  'broadcast_enabled' | 'broadcast_group' | 'broadcast_purpose' | 'broadcast_approval_warehouses'
> {
  return {
    broadcast_enabled: form.broadcastEnabled ? 1 : 0,
    broadcast_group: form.broadcastGroup.trim(),
    broadcast_purpose: form.broadcastPurpose.trim(),
    broadcast_approval_warehouses: serializeBroadcastApprovalWarehouses(form.broadcastApprovalWarehouses),
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
 * Окно правки/создания контакта. Сессия в person-edit-store — переживает
 * переход на Цеха/График и обратно. Блокировка: resource_id `person:{id}:edit`.
 */
export function PersonEditDialog({ statuses }: PersonEditDialogProps): JSX.Element {
  const { t } = useTranslation();
  const target = usePersonEditStore((s) => s.target);
  const form = usePersonEditStore((s) => s.form);
  const saving = usePersonEditStore((s) => s.saving);
  const warehousesSearchQuery = usePersonEditStore((s) => s.warehousesSearchQuery);
  const close = usePersonEditStore((s) => s.close);
  const setForm = usePersonEditStore((s) => s.setForm);
  const setSaving = usePersonEditStore((s) => s.setSaving);
  const setWarehousesSearchQuery = usePersonEditStore((s) => s.setWarehousesSearchQuery);
  const [saveError, setSaveError] = useState('');
  const [tabCopied, setTabCopied] = useState(false);

  const open = target !== null;
  const mode = target?.mode ?? 'create';
  const personId = target && target.mode !== 'create' ? target.person.id : null;
  const transportRoleSelected = TRANSPORT_FLOW_ROLE_GROUPS.has(form.broadcastGroup);
  const transportRoleAllowed =
    target !== null &&
    target.mode !== 'create' &&
    target.person.isMol;

  // Выравнивание поиска складов по строке «Статус» (fallback — строка ФИО).
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const statusRowRef = useRef<HTMLDivElement>(null);
  const alignRowRef = useRef<HTMLDivElement>(null);
  const [searchTop, setSearchTop] = useState(64);

  // Collab-lock на ВСЮ карточку: если контакт уже редактирует другой — оверлей
  // накрывает обе панели (форму + склады), сохранить ничего нельзя.
  const lockResourceId = personId !== null ? `person:${personId}:edit` : null;
  const { ownedByOther } = useEditLock(lockResourceId ?? '', open && personId !== null);

  const set = <K extends keyof PersonEditFormState>(key: K, value: PersonEditFormState[K]) =>
    setForm({ [key]: value });

  useEffect(() => {
    if (open) {
      setSaveError('');
      setTabCopied(false);
    }
  }, [open, personId]);

  // ФИО: ≥2 слова, в каждом >2 букв (иначе остаётся в панели «Новый МОЛ/контакт»).
  const fioOk = isValidPersonFio(form.fio);
  const broadcastOk = (() => {
    if (!form.broadcastEnabled) return true;
    if (!form.broadcastGroup.trim()) return false;
    if (transportRoleSelected && !transportRoleAllowed) return false;
    // Согласующие: нужен хотя бы один склад (цель — необязательна).
    if (form.broadcastGroup === 'Согласующие') {
      return form.broadcastApprovalWarehouses.length > 0;
    }
    // Экспедиторы / Водители-экспедиторы: достаточно выбранной группы (цель необязательна).
    if (BROADCAST_PURPOSE_OPTIONAL_GROUPS.has(form.broadcastGroup)) return true;
    // ИТР УПП / Заявители: обязательна цель рассылки.
    return form.broadcastPurpose.trim().length > 0;
  })();
  const canSave = !saving && fioOk && broadcastOk;

  // edit/orphan: ФИО + должность правятся; табельный — только create (иначе read-only + copy).
  const showField = {
    tab: mode === 'create',
    tabReadonly: mode === 'edit' || mode === 'orphan',
    fio: true,
    position: true,
    status: mode === 'create' || mode === 'edit' || mode === 'orphan',
    mobile: true,
    work: true,
    mail: true,
    comment: true,
  };

  const copyTab = async () => {
    const tab = form.tab.trim();
    if (!tab) return;
    try {
      await navigator.clipboard.writeText(tab);
      setTabCopied(true);
      window.setTimeout(() => setTabCopied(false), 1500);
    } catch {
      /* clipboard may be denied */
    }
  };

  // Группа «Согласующие» → панель складов открывается сразу.
  const isApprover = form.broadcastEnabled && form.broadcastGroup === 'Согласующие';
  const expanded = isApprover;

  useLayoutEffect(() => {
    if (!open || !expanded || !leftPanelRef.current) return;
    const panelTop = leftPanelRef.current.getBoundingClientRect().top;
    const row = statusRowRef.current ?? alignRowRef.current;
    if (row) setSearchTop(row.getBoundingClientRect().top - panelTop);
  }, [open, expanded, mode]);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    try {
      // Локальная нормализация = серверная (на сервере ещё раз, «база сама»).
      const fio = normalizePersonFio(form.fio);
      const mobile = normalizePersonMobileStorage(form.mobile) || toCanonMobile(form.mobile);
      const work = normalizePersonWorkStorage(form.work);
      const mail = normalizePersonMail(form.mail);
      if (mode === 'create') {
        const input: PersonCreateInput = {
          tab: form.tab.trim(), fio, position: form.position.trim(),
          status: form.status.trim(), mobile, work, mail,
          comment: form.comment.trim(),
          ...broadcastPatchFromForm(form),
        };
        await createPerson(input);
      } else if (personId !== null) {
        const broadcast = broadcastPatchFromForm(form);
        // edit и orphan: ФИО + должность + контакты (табельный не меняем).
        const patch: PersonPatch = {
          fio,
          position: form.position.trim(),
          status: form.status.trim(),
          mobile,
          work,
          mail,
          comment: form.comment.trim(),
          dismissed: form.dismissed ? 1 : 0,
          ...broadcast,
        };
        await savePerson(personId, patch);
      }
      close();
    } catch (err) {
      // savePerson/createPerson уже откатили локально через refresh.
      const text = err instanceof Error ? err.message : String(err);
      setSaveError(text.slice(0, 180) || 'Не удалось сохранить контакт');
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create'
    ? t('mol.edit.title_create')
    : mode === 'orphan'
      ? t('mol.edit.title_orphan')
      : t('mol.edit.title_edit');

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      {open && (
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[88vh] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated shadow-2xl outline-none',
            'flex max-w-[calc(100vw-2rem)] overflow-hidden p-0',
            'transition-[width] duration-300 ease-out',
            expanded ? 'w-[1000px]' : 'w-[420px]',
          )}
        >
          <div className="flex min-h-0 w-full flex-row">
          <div ref={leftPanelRef} className="relative flex w-[420px] shrink-0 flex-col overflow-y-auto p-3.5">
          <Dialog.Title className="text-[13px] font-semibold text-text-strong">
            {title}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>

          <>
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
              {showField.tabReadonly && form.tab.trim() && (
                <div>
                  <FieldLabel label={t('mol.edit.field_tab')} />
                  {/* Одна высота: поле и кнопка — items-stretch + одинаковые py/text */}
                  <div className="flex items-stretch gap-1.5">
                    <div className="flex min-h-[34px] min-w-0 flex-1 items-center rounded border border-border-default bg-bg-surface/60 px-2 font-mono text-[12.5px] tabular-nums text-text-primary">
                      {form.tab}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyTab()}
                      title={tabCopied ? t('mol.edit.tab_copied') : t('mol.edit.tab_copy')}
                      className={cn(
                        'flex min-h-[34px] shrink-0 items-center gap-1 self-stretch rounded border border-border-default px-2.5',
                        'text-[11.5px] text-text-muted outline-none transition-colors',
                        'hover:border-accent-clay/40 hover:bg-bg-hover hover:text-accent-clay',
                      )}
                    >
                      <Copy className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      {tabCopied ? t('mol.edit.tab_copied') : t('mol.edit.tab_copy')}
                    </button>
                  </div>
                </div>
              )}
              {showField.fio && (
                <div ref={!showField.status ? alignRowRef : undefined}>
                  <Field
                    label={t('mol.edit.field_fio')}
                    value={form.fio}
                    onChange={(v) => set('fio', v)}
                    required
                    autoFocus={mode === 'create' || mode === 'orphan' || !isValidPersonFio(form.fio)}
                  />
                </div>
              )}
              {showField.position && (
                <Field label={t('mol.edit.field_position')} value={form.position} onChange={(v) => set('position', v)} />
              )}
              {showField.status && (
                <div>
                  <FieldLabel label={t('mol.edit.field_status')} />
                  {/* ref на самом селекте — поиск складов встаёт ровно напротив него. */}
                  <div ref={statusRowRef}>
                    <StatusDropdown
                      value={form.status}
                      options={statuses}
                      noneLabel={t('mol.edit.status_none')}
                      onChange={(v) => set('status', v)}
                    />
                  </div>
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

              {/* «Уволился» — только у существующих контактов. Пометка главнее
                  выгрузки: как МОЛ не выбирается, в Android-базу не идёт. */}
              {mode !== 'create' && (
                <div className="mt-1 flex items-start justify-between gap-3 pt-1">
                  <div className="min-w-0">
                    <span className={cn(
                      'text-[12.5px] font-medium',
                      form.dismissed ? 'text-danger' : 'text-text-primary',
                    )}
                    >
                      {t('mol.edit.field_dismissed')}
                    </span>
                    {form.dismissed && target !== null && target.mode !== 'create' && target.person.isMol && (
                      <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
                        {t('mol.edit.dismissed_in_dump')}
                      </div>
                    )}
                  </div>
                  <ClayToggle on={form.dismissed} onChange={(v) => set('dismissed', v)} />
                </div>
              )}

              <BroadcastSection
                form={form}
                set={set}
                t={t}
                transportRoleAllowed={transportRoleAllowed}
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-1.5">
              {saveError && (
                <span className="mr-auto max-w-[230px] truncate text-[11px] text-danger" title={saveError}>
                  {saveError}
                </span>
              )}
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
          </>

          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-2.5 top-2.5 z-50 text-text-muted outline-none transition-colors hover:text-text-strong"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
          </div>

          <div
            className={cn(
              'relative shrink-0 overflow-hidden transition-[width] duration-300 ease-out',
              expanded ? 'w-[580px]' : 'w-0',
            )}
          >
            {isApprover && (
              <ApprovalWarehousesPanel
                selected={form.broadcastApprovalWarehouses}
                query={warehousesSearchQuery}
                onQueryChange={setWarehousesSearchQuery}
                onChange={(codes) => set('broadcastApprovalWarehouses', codes)}
                searchTop={searchTop}
              />
            )}
          </div>
          </div>

          {/* Collab-lock оверлей — поверх ВСЕЙ карточки (форма + склады). Крестик
              закрытия (z-50) остаётся кликабельным поверх оверлея (z-30). */}
          {ownedByOther && <EditorLockedOverlay owner={ownedByOther} />}
        </Dialog.Content>
      </Dialog.Portal>
      )}
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
  label, value, onChange, placeholder, mono = false, required = false, invalid = false, autoFocus = false, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  hint?: string;
}): JSX.Element {
  const showInvalid = invalid || (required && !value.trim());
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
          showInvalid ? 'border-danger/40' : 'border-border-default',
          mono && 'font-mono tabular-nums',
        )}
      />
    </div>
  );
}

/** Блок рассылки: переключатель → группа → цель. Для «Согласующие» склады
 *  выбираются в правой панели (открывается автоматически). */
function BroadcastSection({
  form,
  set,
  t,
  transportRoleAllowed,
}: {
  form: PersonEditFormState;
  set: <K extends keyof PersonEditFormState>(key: K, value: PersonEditFormState[K]) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  transportRoleAllowed: boolean;
}): JSX.Element {
  // Цель обязательна для ИТР УПП / Заявители; для Согласующих — нет (там «цель» — это
  // набор складов в правой панели); для Экспедиторов/Водителей-экспедиторов — тоже нет.
  const purposeRequired = !BROADCAST_PURPOSE_OPTIONAL_GROUPS.has(form.broadcastGroup);
  const purposeInvalid = form.broadcastEnabled && purposeRequired && !form.broadcastPurpose.trim();

  return (
    <div className="mt-1 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-text-primary">{t('mol.edit.field_broadcast')}</span>
        <ClayToggle on={form.broadcastEnabled} onChange={(v) => set('broadcastEnabled', v)} />
      </div>

      {form.broadcastEnabled && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          <div>
            <FieldLabel label={t('mol.edit.field_broadcast_group')} />
            <BroadcastGroupDropdown
              value={form.broadcastGroup}
              invalid={!form.broadcastGroup.trim()}
              placeholder={t('mol.edit.broadcast_group_none')}
              onChange={(v) => set('broadcastGroup', v)}
            />
            {TRANSPORT_FLOW_ROLE_GROUPS.has(form.broadcastGroup) && !transportRoleAllowed && (
              <div className="mt-1 text-[11px] leading-snug text-danger">
                Роль экспедитора доступна только контакту МОЛ.
              </div>
            )}
          </div>

          <Field
            label={t('mol.edit.field_broadcast_purpose')}
            hint={purposeRequired ? undefined : t('mol.edit.broadcast_purpose_optional')}
            value={form.broadcastPurpose}
            onChange={(v) => set('broadcastPurpose', v)}
            placeholder={t('mol.edit.ph_broadcast_purpose')}
            required={purposeRequired}
            invalid={purposeInvalid}
          />
        </div>
      )}
    </div>
  );
}

function ClayToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none',
        on ? 'bg-accent-clay' : 'bg-bg-hover',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function BroadcastGroupDropdown({
  value, placeholder, invalid, onChange,
}: {
  value: string;
  placeholder: string;
  invalid: boolean;
  onChange: (v: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded border bg-bg-surface px-2 text-left text-[12.5px] outline-none transition-colors',
            'hover:border-accent-clay/40 data-[state=open]:border-accent-clay/45',
            value ? 'text-text-primary' : 'text-text-muted',
            invalid ? 'border-danger/40' : 'border-border-default',
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] flex w-[var(--radix-popover-trigger-width)] flex-col rounded-lg border border-border-default bg-bg-elevated p-1 shadow-2xl"
        >
          {BROADCAST_GROUPS.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors',
                  active
                    ? 'bg-accent-clay/15 text-accent-clay'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <span className="truncate">{opt}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
