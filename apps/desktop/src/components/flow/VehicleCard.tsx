import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Truck } from 'lucide-react';
import { flowVehiclesUpsert, type FlowVehicle, type Person } from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';
import { formatMobilePhone } from '@/lib/mol-format';

/**
 * Карточка машины (база машин, ключ — гаражный №). Открывается из «Добавить»
 * (машины нет в базе) или для правки. ВОДИТЕЛЬ ищется в НАШЕЙ базе контактов —
 * по ФИО / сот. / табельному; выбор подставляет ФИО + телефон. Остальные поля
 * вносятся руками (заказ/работа — на строке дня, не здесь).
 */
export function VehicleCard({
  garageNo,
  vehicle,
  onClose,
  onSaved,
}: {
  garageNo: string;
  vehicle: FlowVehicle | null;
  onClose: () => void;
  onSaved: (veh: FlowVehicle) => void;
}): JSX.Element {
  const [gosNo, setGosNo] = useState(vehicle?.gos_no ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [vtype, setVtype] = useState(vehicle?.vtype ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [capacity, setCapacity] = useState(vehicle?.capacity_kg != null ? String(vehicle.capacity_kg) : '');
  const [maxMass, setMaxMass] = useState(vehicle?.max_mass_kg != null ? String(vehicle.max_mass_kg) : '');
  const [lenMm, setLenMm] = useState(vehicle?.len_mm != null ? String(vehicle.len_mm) : '');
  const [widMm, setWidMm] = useState(vehicle?.wid_mm != null ? String(vehicle.wid_mm) : '');
  const [heiMm, setHeiMm] = useState(vehicle?.hei_mm != null ? String(vehicle.hei_mm) : '');
  const [ban, setBan] = useState(Number(vehicle?.ban) === 1);
  const [driver, setDriver] = useState(vehicle?.driver ?? '');
  const [driverPhone, setDriverPhone] = useState(vehicle?.driver_phone ?? '');
  const [note, setNote] = useState(vehicle?.note ?? '');
  const [driverQuery, setDriverQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // База контактов — для поиска водителя (ФИО / сот / табельный).
  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);

  const suggestions = useMemo<Person[]>(() => {
    const q = driverQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    const out: Person[] = [];
    for (const p of persons) {
      const byFio = p.fio.toLowerCase().includes(q);
      const byTab = digits.length >= 3 && p.tab.includes(digits);
      const byPhone = digits.length >= 4 && (p.mobile.replace(/\D/g, '').includes(digits) || p.work.replace(/\D/g, '').includes(digits));
      if (byFio || byTab || byPhone) {
        out.push(p);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [persons, driverQuery]);

  const numOrNull = (s: string): number | null => {
    const t = s.replace(/\s+/g, '').replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const save = (): void => {
    if (busy) return;
    setBusy(true);
    setErr('');
    void flowVehiclesUpsert(api, {
      garage_no: garageNo,
      gos_no: gosNo.trim(),
      color: color.trim(),
      vtype: vtype.trim(),
      model: model.trim(),
      capacity_kg: numOrNull(capacity),
      max_mass_kg: numOrNull(maxMass),
      len_mm: numOrNull(lenMm),
      wid_mm: numOrNull(widMm),
      hei_mm: numOrNull(heiMm),
      ban: ban ? 1 : 0,
      driver: driver.trim(),
      driver_phone: driverPhone.trim(),
      note: note.trim(),
    })
      .then((veh) => {
        if (veh) onSaved(veh);
        else setErr('Сервер не вернул машину');
      })
      .catch((e) => setErr((e instanceof Error ? e.message : String(e)).slice(0, 100)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle bg-bg-surface p-4 shadow-2xl outline-none">
          <Dialog.Title className="flex items-center gap-2 text-[14px] font-semibold text-text-strong">
            <Truck size={16} strokeWidth={1.75} className="text-accent-clay" />
            Машина · гаражный {garageNo}
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[11px] text-text-muted/80">
            {vehicle ? 'Правка карточки — пустые поля затирают.' : 'Новой машины нет в базе — заполните карточку.'}
          </Dialog.Description>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="ГОС. №" value={gosNo} onChange={setGosNo} placeholder="К333РУ 96" />
            <Field label="Цвет кузова" value={color} onChange={setColor} placeholder="Светло-серый" />
            <Field label="Тип" value={vtype} onChange={setVtype} placeholder="Грузовые седельные тягачи" />
            <Field label="Модель" value={model} onChange={setModel} placeholder="КамАЗ 54115N" />
            <Field label="Грузопод., кг" value={capacity} onChange={setCapacity} placeholder="12 225" />
            <Field label="Max. доп. масса, кг" value={maxMass} onChange={setMaxMass} placeholder="19 305" />
            <div className="col-span-2 grid grid-cols-3 gap-2">
              <Field label="Д кузова, мм" value={lenMm} onChange={setLenMm} placeholder="11 900" />
              <Field label="Ш, мм" value={widMm} onChange={setWidMm} placeholder="2 060" />
              <Field label="В, мм" value={heiMm} onChange={setHeiMm} placeholder="450" />
            </div>
          </div>

          {/* Водитель: поиск по базе контактов (ФИО / сот / табельный) или руками. */}
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-text-muted/70">Водитель</div>
            <input
              value={driver}
              onChange={(e) => {
                setDriver(e.target.value);
                setDriverQuery(e.target.value);
              }}
              placeholder="Поиск: ФИО / сот. / табельный"
              className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
            />
            {suggestions.length > 0 && (
              <div className="mt-1 flex max-h-[150px] flex-col gap-0.5 overflow-y-auto rounded-md border border-border-subtle p-1">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setDriver(p.fio);
                      setDriverPhone(p.mobile || p.work || '');
                      setDriverQuery('');
                    }}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12px] text-text-secondary transition-colors hover:bg-accent-clay/15 hover:text-text-strong"
                  >
                    <span className="truncate">{p.fio}</span>
                    <span className="shrink-0 tabular-nums text-[11px] text-text-muted/70">
                      {p.tab ? `таб. ${p.tab}` : ''}
                      {p.mobile ? ` · ${formatMobilePhone(p.mobile)}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Сот. водителя" value={driverPhone} onChange={setDriverPhone} placeholder="8 909 021 0980" />
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-text-muted/70">
                Запрет выезда
                <button
                  type="button"
                  onClick={() => setBan((b) => !b)}
                  className={cn(
                    'h-8 rounded-md border text-[12px] transition-colors',
                    ban
                      ? 'border-danger/60 text-danger'
                      : 'border-border-subtle text-text-secondary hover:border-border-default',
                  )}
                >
                  {ban ? 'ДА — выезд запрещён' : 'НЕТ — выезд разрешён'}
                </button>
              </label>
            </div>
            <div className="mt-2">
              <Field label="Заметка" value={note} onChange={setNote} placeholder="" />
            </div>
          </div>

          {err && <div className="mt-2 text-[11px] text-danger">{err}</div>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="h-8 rounded-md border border-accent-clay/60 px-3 text-[12px] font-medium text-text-strong transition-colors hover:bg-accent-clay/15 disabled:opacity-40"
            >
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-text-muted/70">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] normal-case text-text-primary outline-none focus:border-accent-clay/60"
      />
    </label>
  );
}
