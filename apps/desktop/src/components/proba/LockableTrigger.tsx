import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';

interface LockableTriggerProps {
  /** true — месяц зафиксирован: popover не открывается, вместо него tooltip. */
  locked: boolean;
  /** Триггер-элемент (кнопка с классом proba-editable). */
  children: ReactNode;
}

/**
 * Триггер editable-popover'а с поддержкой «зафиксировано». Рендерится ВНУТРИ
 * Popover.Root конкретного редактора графика (PersonEditor / DatePicker /
 * ExceptionsEditor / HolidaysCalendar) — Radix-контекст наследуется.
 *
 * • не locked → обычный Popover.Trigger (открывает редактор).
 * • locked → НЕ Popover.Trigger, а Tooltip с подсказкой `proba.commit_locked_tip`:
 *   клик ничего не открывает, а haze/курсор гасятся через data-frozen
 *   (см. CSS `.proba-editable[data-frozen]`).
 *
 * MonthYearPicker этот враппер НЕ использует — навигация по месяцам доступна и
 * на зафиксированном графике.
 */
export function LockableTrigger({ locked, children }: LockableTriggerProps) {
  const { t } = useTranslation();
  if (!locked) {
    return <Popover.Trigger asChild>{children}</Popover.Trigger>;
  }
  const frozenChild = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-frozen': '' })
    : children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{frozenChild}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
        >
          {t('proba.commit_locked_tip')}
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
