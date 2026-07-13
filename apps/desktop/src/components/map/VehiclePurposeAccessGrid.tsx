import { cn } from '@/lib/cn';
import {
  POINT_PURPOSE_META,
  POINT_VEHICLE_TYPES,
  type PointPurpose,
  type VehicleType,
} from './map-types';

type VehiclePurposeMatrix = Partial<Record<PointPurpose, VehicleType[]>>;

export function VehiclePurposeAccessGrid({ value, onChange }: {
  value: VehiclePurposeMatrix;
  onChange: (next: VehiclePurposeMatrix) => void;
}) {
  const columns: Array<{ id: PointPurpose; short: string }> = [
    { id: 'tech', short: 'Тех.' },
    { id: 'exped', short: 'Эксп.' },
    { id: 'other', short: 'Иное' },
  ];
  const allVehicles = POINT_VEHICLE_TYPES.map((vehicle) => vehicle.id);
  const purposeMeta = (purpose: PointPurpose) => POINT_PURPOSE_META.find((item) => item.id === purpose)!;

  const toggleCell = (vehicle: VehicleType, purpose: PointPurpose) => {
    const current = value[purpose] ?? [];
    onChange({
      ...value,
      [purpose]: current.includes(vehicle)
        ? current.filter((item) => item !== vehicle)
        : [...current, vehicle],
    });
  };

  const toggleColumn = (purpose: PointPurpose) => {
    const current = value[purpose] ?? [];
    onChange({ ...value, [purpose]: current.length >= allVehicles.length ? [] : [...allVehicles] });
  };

  return (
    <div className="overflow-hidden rounded-md border border-border-subtle">
      <div className="grid grid-cols-[minmax(6.5rem,1fr)_repeat(3,2.45rem)] items-center border-b border-border-subtle bg-bg-deep/40 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Тип ТС</span>
        {columns.map((column) => {
          const meta = purposeMeta(column.id);
          const allOn = (value[column.id] ?? []).length >= allVehicles.length;
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => toggleColumn(column.id)}
              className="text-center text-[9.5px] font-semibold outline-none transition-opacity hover:opacity-75"
              style={{ color: meta.color }}
              title={`${meta.label}: ${allOn ? 'снять все типы ТС' : 'разрешить все типы ТС'}`}
            >{column.short}</button>
          );
        })}
      </div>
      {POINT_VEHICLE_TYPES.map((vehicle) => (
        <div
          key={vehicle.id}
          className="grid grid-cols-[minmax(6.5rem,1fr)_repeat(3,2.45rem)] items-center border-b border-border-subtle/40 px-2 py-[3px] last:border-b-0"
        >
          <span className="truncate text-[11px] text-text-secondary" title={vehicle.label}>{vehicle.label}</span>
          {columns.map((column) => {
            const meta = purposeMeta(column.id);
            const on = (value[column.id] ?? []).includes(vehicle.id);
            return (
              <button
                key={column.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`${vehicle.label}: ${meta.label}`}
                onClick={() => toggleCell(vehicle.id, column.id)}
                className={cn(
                  'mx-auto flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border text-[10px] leading-none outline-none transition-colors',
                  !on && 'border-border-default text-transparent hover:bg-bg-hover',
                )}
                style={on ? { borderColor: meta.color, backgroundColor: `${meta.color}2a`, color: meta.color } : undefined}
              >{on ? '✓' : ''}</button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
