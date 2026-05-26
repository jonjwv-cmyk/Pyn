import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Pencil,
  Phone,
  Plus,
  X,
} from 'lucide-react';
import {
  getWarehouseState,
  type Warehouse,
  type WarehouseCluster,
  type WarehouseWeekday,
} from '@pyn/core';
import { cn } from '@/lib/cn';
import { formatWorkPhone, splitAndFormatWorkPhones } from '@/lib/mol-format';
import { clusterLabel, weekdayShortLabel } from '@/lib/i18n-labels';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { useWarehousesStore } from '@/lib/warehouses-store';
import type { ContactActionRequest } from './ContactActionDialog';

export interface NotFoundList {
  warehouses: string[];
  emails: string[];
  names: string[];
}

interface WarehouseSidebarProps {
  groups: Map<string, unknown>; // только ключи нужны
  notFound: NotFoundList;
  onContactAction: (req: ContactActionRequest) => void;
}

const CLUSTERS: WarehouseCluster[] = ['НТМК', 'ВЫЕЗД', 'КХП'];
const DAYS: WarehouseWeekday[] = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

export function WarehouseSidebar({ groups, notFound, onContactAction }: WarehouseSidebarProps) {
  const ids = [...groups.keys()];
  const showNotFound =
    notFound.warehouses.length + notFound.emails.length + notFound.names.length > 0;
  const scrollRef = useRef<HTMLElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const checkScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 64);
  };
  const scrollToBottom = (): void => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    checkScroll();
  }, [ids.length, showNotFound]);

  return (
    <div className="relative flex w-[340px] shrink-0">
      <aside
        ref={scrollRef}
        onScroll={checkScroll}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto border-l border-border-subtle',
          'bg-bg-surface p-3',
        )}
      >
        <div className="flex flex-col gap-2.5">
          {showNotFound && <NotFoundCard notFound={notFound} />}
          {ids.map((wid) => (
            <WarehouseCard
              key={wid}
              warehouseId={wid}
              onContactAction={onContactAction}
            />
          ))}
        </div>
      </aside>
      <ScrollToBottomButton
        visible={showScrollDown}
        onClick={scrollToBottom}
        className="!bottom-3"
      />
    </div>
  );
}

function NotFoundCard({ notFound }: { notFound: NotFoundList }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={cn(
      'rounded-lg border border-danger/40 bg-danger/[0.06] px-4 py-3',
      'text-[12.5px] leading-snug',
    )}>
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
        <h3 className="text-[13.5px] font-semibold text-danger">{t('mol.not_found_title')}</h3>
      </div>
      <ul className="mt-2 space-y-1">
        {notFound.warehouses.map((w) => (
          <li key={`w-${w}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">
              {t('mol.warehouse').toLowerCase()}
            </span>
            <span className="tabular-nums">{w}</span>
          </li>
        ))}
        {notFound.emails.map((e) => (
          <li key={`e-${e}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">email</span>
            <span className="break-all" title={e}>{e}</span>
          </li>
        ))}
        {notFound.names.map((n) => (
          <li key={`n-${n}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">{t('mol.fio')}</span>
            <span className="break-words" title={n}>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Warehouse card ─────────────────────────────────────────────────────────

function WarehouseCard({
  warehouseId,
  onContactAction,
}: {
  warehouseId: string;
  onContactAction: (req: ContactActionRequest) => void;
}) {
  const { t } = useTranslation();
  const warehouse = useWarehousesStore((s) => s.byId.get(warehouseId));

  if (!warehouse) {
    // Склад из search-результата отсутствует в нашей БД — показываем minimal-card
    return (
      <div className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 px-4 py-3 text-[12.5px] text-text-muted">
        <h3 className="font-bold tabular-nums text-text-primary">{t('mol.warehouse')} {warehouseId}</h3>
        <p className="mt-1 italic">{t('mol_sidebar.not_in_dict')}</p>
      </div>
    );
  }

  const state = getWarehouseState(warehouse);
  const phones = warehouse.work_phone ? splitAndFormatWorkPhones(warehouse.work_phone) : [];

  // Color tokens по state
  const stateClasses = {
    removed: 'border-danger/35 bg-danger/[0.06]',
    shipping: 'border-[#8C78C8]/40 bg-[#8C78C8]/[0.08]',  // lilac/purple
    scheduled: 'border-presence-online/35 bg-presence-online/[0.06]',
    idle: 'border-border-default bg-bg-elevated',
  }[state];

  return (
    <article className={cn(
      'rounded-lg border px-3.5 py-3 text-[12.5px] leading-snug transition-colors',
      stateClasses,
    )}>
      {/* Top: «Склад 8022» + кнопка «Редактировать» (cluster+day+phones в одном окне) */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tabular-nums text-text-strong">
          {t('mol.warehouse')} {warehouse.id}
        </h3>
        <EditDialog warehouse={warehouse} />
      </div>

      {/* Shop name */}
      {warehouse.shop_name && (
        <p className="whitespace-normal break-words font-medium leading-snug text-text-primary">
          {warehouse.shop_name}
        </p>
      )}

      {/* Field list */}
      <div className="mt-2 space-y-0.5 text-text-secondary">
        {warehouse.description && (
          <FieldRow label={t('mol_sidebar.field_description')} value={warehouse.description} />
        )}
        {warehouse.designation && (
          <FieldRow label={t('mol_sidebar.field_designation')} value={warehouse.designation} />
        )}
        {warehouse.keeper && (
          <FieldRow label={t('mol_sidebar.field_keeper')} value={warehouse.keeper} />
        )}
        {warehouse.legacy_id && (
          <FieldRow label={t('mol_sidebar.field_legacy_id')} value={warehouse.legacy_id} mono />
        )}
        {warehouse.shop_code && (
          <FieldRow label={t('mol_sidebar.field_code')} value={warehouse.shop_code} mono />
        )}
      </div>

      {/* Phones */}
      {phones.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {phones.map((phone, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onContactAction({
                kind: 'callWarehouse',
                target: phone,
                display: phone,
                contactName: `${t('mol.warehouse')} ${warehouse.id}`,
              })}
              className={cn(
                '-mx-1 flex w-full items-center gap-2 rounded px-1 py-0.5',
                'text-left text-[13.5px] font-semibold tabular-nums text-text-strong',
                'transition-colors hover:bg-bg-hover',
              )}
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span>{phone}</span>
            </button>
          ))}
        </div>
      )}

      {/* Status pills */}
      <StatusPills warehouse={warehouse} />
    </article>
  );
}

function FieldRow({
  label, value, mono = false,
}: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="whitespace-normal break-words">
      <span className="text-text-muted">{label}: </span>
      <span className={mono ? 'font-mono tabular-nums text-text-primary' : ''}>{value}</span>
    </p>
  );
}

type StatusOption = 'idle' | 'delivery' | 'shipping' | 'removed';

// Status pill — display-only. Изменение статуса теперь через EditDialog
// (там же status-toggle + cluster/day + телефоны под одной кнопкой Подтвердить).
function StatusPills({ warehouse }: { warehouse: Warehouse }) {
  const { t } = useTranslation();
  const isRemoved = warehouse.is_removed === 1;
  const isShipping = warehouse.is_shipping === 1;
  const isScheduled = warehouse.in_schedule === 1;
  const hasClusterDay = warehouse.cluster && warehouse.delivery_day;

  const stateLabel = isRemoved
    ? t('mol_sidebar.status_removed')
    : isShipping
      ? t('mol_sidebar.status_shipping')
      : isScheduled
        ? t('mol_sidebar.status_delivery')
        : t('mol_sidebar.status_idle');
  const stateTone: 'green' | 'purple' | 'red' | 'muted' = isRemoved
    ? 'red'
    : isShipping
      ? 'purple'
      : isScheduled
        ? 'green'
        : 'muted';

  const toneClass = (t: 'green' | 'purple' | 'red' | 'muted') =>
    t === 'green' ? 'bg-presence-online/15 text-presence-online'
    : t === 'purple' ? 'bg-[#8C78C8]/20 text-[#8C78C8]'
    : t === 'red' ? 'bg-danger/15 text-danger'
    : 'bg-bg-hover text-text-muted';

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {hasClusterDay && !isRemoved && warehouse.cluster && warehouse.delivery_day && (
        <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-text-secondary">
          {clusterLabel(warehouse.cluster, t)} · {weekdayShortLabel(warehouse.delivery_day, t)}
        </span>
      )}
      <span
        className={cn(
          'ml-auto inline-flex items-center rounded px-2 py-0.5 text-[10.5px] font-semibold tracking-wide',
          toneClass(stateTone),
        )}
      >
        {stateLabel}
      </span>
    </div>
  );
}

// ─── Edit dialog: status + cluster + day + phones под одной кнопкой ───────

/** Live-формат для phone input. «490282» → «49  02  82», «7 14 15» → «7  14  15».
 *  На каждом keystroke. Strip-ает 5-значный city+country prefix (логика
 *  formatWorkPhone), потом конвертит одиночные пробелы в двойные. */
function formatPhoneLive(raw: string): string {
  if (!raw) return '';
  return formatWorkPhone(raw).replace(/ /g, '  ');
}

function statusFromWarehouse(w: Warehouse): StatusOption {
  if (w.is_removed === 1) return 'removed';
  if (w.is_shipping === 1) return 'shipping';
  if (w.in_schedule === 1) return 'delivery';
  return 'idle';
}

function EditDialog({ warehouse }: { warehouse: Warehouse }) {
  const { t } = useTranslation();
  const updateFields = useWarehousesStore((s) => s.updateFields);

  const initialPhones = useMemo(() => {
    const arr = (warehouse.work_phone ?? '')
      .split(/[\r\n]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map(formatPhoneLive); // нормализуем визуал на загрузке
    return arr.length > 0 ? arr : [''];
  }, [warehouse.work_phone]);

  const initialStatus = statusFromWarehouse(warehouse);

  const [open, setOpen] = useState(false);
  const [phones, setPhones] = useState<string[]>(initialPhones);
  const [status, setStatus] = useState<StatusOption>(initialStatus);
  const [cluster, setCluster] = useState<WarehouseCluster | null>(warehouse.cluster);
  const [day, setDay] = useState<WarehouseWeekday | null>(warehouse.delivery_day);
  // Inline confirm when current=delivery + draft=shipping
  const [confirmShipping, setConfirmShipping] = useState(false);

  useEffect(() => {
    if (open) {
      setPhones(initialPhones);
      setStatus(initialStatus);
      setCluster(warehouse.cluster);
      setDay(warehouse.delivery_day);
      setConfirmShipping(false);
    }
  }, [open, initialPhones, initialStatus, warehouse.cluster, warehouse.delivery_day]);

  const setOne = (i: number, v: string) =>
    setPhones((prev) => prev.map((p, idx) => (idx === i ? formatPhoneLive(v) : p)));
  const addOne = () => setPhones((prev) => [...prev, '']);
  const removeOne = (i: number) =>
    setPhones((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : ['']));

  const tryChangeStatus = (next: StatusOption) => {
    if (next === status) return;
    // Только переход Доставка → Отгрузка требует inline-confirm
    // (потому что cluster/day будут сброшены).
    if (status === 'delivery' && next === 'shipping') {
      setConfirmShipping(true);
      return;
    }
    setStatus(next);
  };

  const acceptShipping = () => {
    setStatus('shipping');
    setConfirmShipping(false);
  };

  // Подтверждать можно если:
  //  - статус delivery → нужны cluster + day
  //  - другие статусы — всегда
  const canSave = status !== 'delivery' || (cluster !== null && day !== null);

  const save = () => {
    if (!canSave) return;
    const cleanPhones = phones
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const fields: Partial<Warehouse> = {
      work_phone: cleanPhones.length > 0 ? cleanPhones.join('\n') : null,
    };
    if (status === 'delivery') {
      fields.in_schedule = 1; fields.is_shipping = 0; fields.is_removed = 0;
      fields.cluster = cluster;
      fields.delivery_day = day;
    } else if (status === 'shipping') {
      fields.in_schedule = 0; fields.is_shipping = 1; fields.is_removed = 0;
      fields.cluster = null; fields.delivery_day = null;
    } else if (status === 'idle') {
      fields.in_schedule = 0; fields.is_shipping = 0; fields.is_removed = 0;
    } else {
      fields.in_schedule = 0; fields.is_shipping = 0; fields.is_removed = 1;
    }
    updateFields(warehouse.id, fields);
    setOpen(false);
  };

  const statusOptions: { key: StatusOption; label: string }[] = [
    { key: 'delivery', label: t('mol_sidebar.status_delivery') },
    { key: 'shipping', label: t('mol_sidebar.status_shipping') },
    { key: 'idle', label: t('mol_sidebar.status_idle') },
    { key: 'removed', label: t('mol_sidebar.status_removed') },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay"
          title={t('mol_sidebar.edit_btn_tip')}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          {t('mol_sidebar.edit_btn')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-default bg-bg-elevated p-3.5 shadow-2xl outline-none">
          <Dialog.Title className="text-[13px] font-semibold text-text-strong">
            {t('mol.warehouse')} {warehouse.id}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('mol_sidebar.edit_btn')}
          </Dialog.Description>

          {/* Status: 4 опции в одну строку */}
          <div className="mt-3">
            <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
              {t('mol_sidebar.section_status')}
            </span>
            <div className="grid grid-cols-4 gap-1">
              {statusOptions.map((opt) => {
                const active = opt.key === status;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => tryChangeStatus(opt.key)}
                    className={cn(
                      'h-7 rounded text-[10.5px] font-semibold outline-none transition-colors',
                      active
                        ? 'bg-accent-clay-bg text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                        : 'bg-white/[0.04] text-text-primary hover:bg-white/[0.08] hover:text-text-strong',
                    )}
                  >{opt.label}</button>
                );
              })}
            </div>
            {confirmShipping && (
              <div className="mt-1.5 flex items-center justify-between rounded border border-accent-clay/30 bg-accent-clay-bg/50 px-2 py-1">
                <span className="text-[11.5px] text-text-strong">
                  {t('mol_sidebar.ask_delivery_to_shipping')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmShipping(false)}
                    className="h-5 rounded px-1.5 text-[11px] text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
                  >{t('mol_sidebar.no')}</button>
                  <button
                    type="button"
                    onClick={acceptShipping}
                    className="h-5 rounded bg-accent-clay px-1.5 text-[11px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim"
                  >{t('mol_sidebar.yes')}</button>
                </div>
              </div>
            )}
          </div>

          {/* Cluster + day — только если выбрана Доставка */}
          {status === 'delivery' && (
            <div className="mt-3">
              <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                {t('mol_sidebar.section_cluster')}
              </span>
              <div className="grid grid-cols-3 gap-1">
                {CLUSTERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCluster((cur) => (cur === c ? null : c))}
                    className={cn(
                      'h-7 rounded text-[11px] font-semibold outline-none transition-colors',
                      cluster === c
                        ? 'bg-accent-clay-bg text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                        : 'bg-white/[0.04] text-text-primary hover:bg-white/[0.08] hover:text-text-strong',
                    )}
                  >{clusterLabel(c, t)}</button>
                ))}
              </div>
              <span className="mb-1 mt-2 block text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                {t('mol_sidebar.section_delivery_day')}
              </span>
              <div className="grid grid-cols-7 gap-0.5">
                {DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay((cur) => (cur === d ? null : d))}
                    className={cn(
                      'h-7 rounded text-[10.5px] font-semibold outline-none transition-colors',
                      day === d
                        ? 'bg-accent-clay-bg text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                        : 'bg-white/[0.04] text-text-primary hover:bg-white/[0.08] hover:text-text-strong',
                    )}
                  >{weekdayShortLabel(d, t)}</button>
                ))}
              </div>
            </div>
          )}

          {/* Phones — всегда */}
          <div className="mt-3">
            <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
              {t('mol_sidebar.section_phones')}
            </span>
            <div className="space-y-1">
              {phones.map((p, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={p}
                    onChange={(e) => setOne(i, e.target.value)}
                    placeholder={t('mol_sidebar.phone_placeholder')}
                    className={cn(
                      'flex-1 rounded border border-border-default bg-bg-surface px-2 py-1',
                      'font-mono text-[12px] tabular-nums text-text-primary outline-none',
                      'placeholder:text-text-muted/60 focus:border-accent-clay/40',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => removeOne(i)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-danger/15 hover:text-danger"
                    title={t('mol_sidebar.phone_remove_tip')}
                    disabled={phones.length === 1 && !p.trim()}
                  >
                    <X className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addOne}
              className="mt-1 flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-border-default text-[11px] font-medium text-text-muted outline-none transition-colors hover:border-accent-clay/40 hover:bg-accent-clay-bg/40 hover:text-accent-clay"
            >
              <Plus className="h-3 w-3" strokeWidth={1.75} />
              {t('mol_sidebar.phone_add_btn')}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-end gap-1.5">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-7 rounded px-2.5 text-[11.5px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
              >{t('mol_sidebar.cancel_btn')}</button>
            </Dialog.Close>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={cn(
                'h-7 rounded px-3 text-[11.5px] font-medium outline-none transition-colors',
                canSave
                  ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
                  : 'cursor-not-allowed bg-bg-hover text-text-muted',
              )}
              title={canSave ? t('mol_sidebar.confirm_btn_tip_ok') : t('mol_sidebar.confirm_btn_tip_invalid')}
            >{t('mol_sidebar.confirm_btn')}</button>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-2.5 top-2.5 text-text-muted outline-none transition-colors hover:text-text-strong"
              title={t('mol_sidebar.close_tip')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
