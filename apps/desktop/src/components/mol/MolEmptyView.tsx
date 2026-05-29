import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { MolQueryMode } from '@pyn/core';
import { cn } from '@/lib/cn';
import { WarehouseCard } from './WarehouseSidebar';
import type { ContactActionRequest } from './ContactActionDialog';

/**
 * Пустое состояние таблицы МОЛ (нет людей в выдаче). Считается в MolScreen —
 * там доступны обе базы (МОЛы + склады).
 *   hero     — пустой запрос («Что ищем сегодня?»).
 *   noMols   — склад(ы) есть в базе, но без МОЛов: карточка склада по центру
 *              + пилл «На складе N нет МОЛов».
 *   notFound — не нашли нигде → один пилл по центру. Текст по режиму:
 *              склад → «Не найден склад»; ФИО/телефон/почта → «Не найден МОЛ».
 */
export type MolEmptyState =
  | { kind: 'hero' }
  | { kind: 'noMols'; warehouseIds: string[] }
  | { kind: 'notFound'; mode: MolQueryMode };

interface MolEmptyViewProps {
  state: MolEmptyState;
  onContactAction: (req: ContactActionRequest) => void;
}

export function MolEmptyView({ state, onContactAction }: MolEmptyViewProps): JSX.Element {
  const { t } = useTranslation();

  if (state.kind === 'hero') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-[28px] font-semibold tracking-[-0.02em] text-text-secondary/85">
          {t('mol.search_hero')}
        </p>
      </div>
    );
  }

  if (state.kind === 'noMols') {
    const joined = state.warehouseIds.join(', ');
    const text = state.warehouseIds.length === 1
      ? t('mol.warehouse_no_mols', { id: joined })
      : t('mol.warehouses_no_mols', { ids: joined });
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-4">
        <div className="flex w-full max-w-[360px] flex-col gap-3">
          {state.warehouseIds.map((id) => (
            <WarehouseCard key={id} warehouseId={id} onContactAction={onContactAction} />
          ))}
          <MolPill tone="muted" text={text} />
        </div>
      </div>
    );
  }

  const text = state.mode === 'warehouse' ? t('mol.warehouse_not_found') : t('mol.mol_not_found');
  return (
    <div className="flex flex-1 items-center justify-center">
      <MolPill tone="danger" text={text} />
    </div>
  );
}

/**
 * Пилл-сообщение в стиле приложения — прямоугольник со скруглёнными углами
 * (не овал). danger — для «не найдено», muted — нейтральное «нет МОЛов».
 */
function MolPill({ tone, text }: { tone: 'danger' | 'muted'; text: string }): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center gap-2 self-center rounded-lg border px-3.5 py-2',
        'text-[12.5px] font-medium leading-snug',
        tone === 'danger'
          ? 'border-danger/40 bg-danger/[0.08] text-danger'
          : 'border-border-subtle/60 bg-bg-elevated/50 text-text-secondary',
      )}
    >
      {tone === 'danger' && <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
      <span className="text-center">{text}</span>
    </div>
  );
}
