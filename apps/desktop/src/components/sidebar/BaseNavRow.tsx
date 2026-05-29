import * as React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export type BaseTab = 'mol' | 'warehouses';

interface BaseNavRowProps {
  collapsed: boolean;
  active: boolean;
  baseTab: BaseTab;
  onPick: (tab: BaseTab) => void;
}

/**
 * Пункт «База» в сайдбаре с hover-флайаутом «листов» (МОЛы / Склады) — по
 * принципу Google-таблиц (TableNavRow). Клик по листу → переключение активного
 * листа базы + переход в раздел. Название листа и его параметры показываются в
 * шапке экрана (MolTopBar). Клик по самому пункту открывает текущий лист.
 */
export function BaseNavRow({ collapsed, active, baseTab, onPick }: BaseNavRowProps) {
  const { t } = useTranslation();
  const sheets: { id: BaseTab; label: string }[] = [
    { id: 'mol', label: t('sidebar.nav_mol') },
    { id: 'warehouses', label: t('mol.tab_shops') },
  ];
  return (
    <HoverCard.Root openDelay={80} closeDelay={150}>
      <HoverCard.Trigger asChild>
        <BaseTrigger
          collapsed={collapsed}
          active={active}
          label={t('sidebar.nav_base')}
          onClick={() => onPick(baseTab)}
        />
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className={cn(
            'z-50 flex w-[180px] flex-col',
            'rounded-xl border border-border-default bg-bg-elevated p-1.5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[side=right]:slide-in-from-left-2',
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {sheets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s.id)}
                  className={cn(
                    'flex h-8 w-full items-center rounded-md px-2 text-left text-[12.5px]',
                    'outline-none transition-colors',
                    // Подсветка активного листа — по baseTab, НЕ завязана на
                    // active-раздел: флайаут показывает текущий лист Базы даже
                    // когда мы в другом разделе (как у Таблиц с rememberedTab).
                    baseTab === s.id
                      ? 'bg-bg-hover text-text-strong'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

type BaseTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  collapsed: boolean;
  active: boolean;
  label: string;
};

/**
 * Trigger-кнопка «База» с forwardRef + spread props — иначе Radix HoverCard не
 * подхватит hover-события. Иконка на line-12, лейбл гаснет через opacity при
 * сворачивании (как у NavItem).
 */
const BaseTrigger = React.forwardRef<HTMLButtonElement, BaseTriggerProps>(
  function BaseTrigger({ collapsed, active, label, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded-md px-1.5',
          'text-text-primary outline-none transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
          active && 'bg-bg-selected text-text-strong',
          className,
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-start">
          <Database
            className={cn(
              'h-[18px] w-[18px] transition-colors',
              active ? 'text-accent-clay' : 'text-text-primary group-hover:text-text-strong',
            )}
            strokeWidth={1.75}
          />
        </span>
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center overflow-hidden transition-opacity duration-200',
            collapsed ? 'opacity-0' : 'opacity-100',
          )}
        >
          <span className="truncate text-[13px] font-normal tracking-[-0.005em]">{label}</span>
        </span>
      </button>
    );
  },
);
