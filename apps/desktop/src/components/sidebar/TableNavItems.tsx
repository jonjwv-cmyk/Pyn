import * as React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { ClipboardList, FileSpreadsheet, Target, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useUiStateStore } from '@/lib/stores';
import {
  customTabName,
  customTableName,
  customTableShortName,
  useTablesRegistry,
  type TableFile,
  type TableTab,
} from '@/lib/use-tables-registry';
import { isSheetNavId, makeSheetNavId, sheetIdFromNavId, type NavSectionId } from '@/types/nav';

/**
 * Динамические nav-items для Google-таблиц. Каждая таблица — самостоятельный
 * пункт в основном Sidebar (как «МОЛы», «Чаты», …). Hover на пункт →
 * flyout справа со списком вкладок (без заголовка таблицы внутри, мы и
 * так знаем где находимся).
 */
interface TableNavItemsProps {
  collapsed: boolean;
  activeSection: NavSectionId;
  onPick: (sectionId: NavSectionId, fileId: string, tabName: string) => void;
}

/**
 * Узнаваемые иконки для таблиц (по raw-title, uppercase). ЦВЕТ убран: ОТИФ/Workflow —
 * не дневные «герои» (месяц/легаси), поэтому нейтральные + только подсветка активной
 * вкладки (договорённость: цвет иконки — только у важных дневных разделов Поток/ВГХ/База).
 *   • Workflow → ClipboardList, OTIF5 → Target (оба нейтральные). Прочие → FileSpreadsheet.
 */
const TABLE_ICONS: Record<string, LucideIcon> = {
  WORKFLOW: ClipboardList,
  OTIF5: Target,
};

function tableIconFor(rawTitle: string): { Icon: LucideIcon; iconColor: string | null } {
  const Icon = TABLE_ICONS[(rawTitle || '').toUpperCase()];
  return { Icon: Icon ?? FileSpreadsheet, iconColor: null };
}

/**
 * Порядок таблиц в сайдбаре (юзер 2026-06-07): ОТИФ5 — живая метрика, закрытие месяца —
 * выше; Workflow почти не используется (скоро уберём) — ниже. Прочие таблицы — между, в
 * порядке реестра. Это только ПОКАЗ (onPick по file.id), сам реестр не трогаем.
 */
const TABLE_SORT_PRIORITY: Record<string, number> = { OTIF5: 0, WORKFLOW: 100 };

function tableSortKey(file: TableFile): number {
  return TABLE_SORT_PRIORITY[(file.title || '').toUpperCase()] ?? 50;
}

export function TableNavItems({ collapsed, activeSection, onPick }: TableNavItemsProps) {
  const { files, loading } = useTablesRegistry();
  // Стабильная сортировка (V8) — таблицы с равным ключом сохраняют порядок реестра.
  const orderedFiles = [...files].sort((a, b) => tableSortKey(a) - tableSortKey(b));

  if (loading && files.length === 0) {
    return (
      <div className="flex animate-pulse flex-col gap-1.5 px-3 py-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-3 w-3/4 rounded bg-bg-hover" />
        ))}
      </div>
    );
  }

  return (
    <>
      {orderedFiles.map((file) => (
        <TableNavRow
          key={file.id}
          file={file}
          activeSection={activeSection}
          collapsed={collapsed}
          onPick={onPick}
        />
      ))}
    </>
  );
}

function TableNavRow({
  file,
  activeSection,
  collapsed,
  onPick,
}: {
  file: TableFile;
  activeSection: NavSectionId;
  collapsed: boolean;
  onPick: (sectionId: NavSectionId, fileId: string, tabName: string) => void;
}): JSX.Element {
  // useTranslation подписывает на change-language → пересчёт displayName/tab labels.
  useTranslation();
  const sectionId = makeSheetNavId(file.id);
  const active = activeSection === sectionId;
  // Запомненный лист именно ЭТОЙ таблицы (per-file) — чтобы клик по таблице
  // возвращал туда, где были, независимо от текущего раздела и других таблиц.
  const rememberedTab = useUiStateStore((s) => s.tableTabByFile[file.id]);
  const visibleTabs = file.tabs.filter((t) => !t.hidden);
  const displayName = customTableName(file.title);
  const shortName = customTableShortName(file.title);
  const { Icon, iconColor } = tableIconFor(file.title);

  // Клик по таблице → открываем её запомненный лист (если ещё существует),
  // иначе первый. «Где были — туда и попадём».
  const pickActive = (): void => {
    const target =
      rememberedTab && visibleTabs.some((t) => t.rawName === rememberedTab)
        ? rememberedTab
        : visibleTabs[0]?.rawName;
    if (target) onPick(sectionId, file.id, target);
  };

  // Trigger — кастомная кнопка с forwardRef + явным forwarding всех
  // event-handlers Radix'у. `NavItem` для этого не подходит: он не
  // forwarding ref/onMouseEnter, и HoverCard остаётся «глухим». Здесь
  // и expanded, и collapsed используют один паттерн forwardRef-кнопки.
  return (
    <HoverCard.Root openDelay={80} closeDelay={150}>
      <HoverCard.Trigger asChild>
        {collapsed ? (
          <CollapsedTextPill
            label={shortName}
            active={active}
            onClick={pickActive}
            iconColor={iconColor}
          />
        ) : (
          <ExpandedTableTrigger
            label={displayName}
            active={active}
            onClick={pickActive}
            Icon={Icon}
            iconColor={iconColor}
          />
        )}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            'z-50 flex max-h-[420px] w-[220px] flex-col overflow-y-auto',
            'rounded-xl border border-border-default bg-bg-elevated p-1.5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'data-[side=right]:slide-in-from-left-2',
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {visibleTabs.length === 0 && (
              <li className="px-2 py-1.5 text-[12px] italic text-text-muted">
                Нет вкладок
              </li>
            )}
            {visibleTabs.map((tab) => (
              <TabRow
                key={`${file.id}-${tab.rawName}`}
                tab={tab}
                active={tab.rawName === rememberedTab}
                onPick={() => onPick(sectionId, file.id, tab.rawName)}
              />
            ))}
          </ul>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/**
 * Базовая trigger-кнопка для HoverCard. forwardRef + spread всех props,
 * чтобы Radix-Slot мог инжектировать свои event-handlers (onPointerEnter,
 * onFocus, etc) и автоматически открывать hover-card. Без этого hover
 * не сработает — Radix молча игнорирует child без ref/listeners.
 */
type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  label: string;
};

type ExpandedTriggerProps = TriggerProps & {
  Icon: LucideIcon;
  /** Постоянный цвет иконки (highlight частых таблиц); null = серый дефолт. */
  iconColor: string | null;
};

const ExpandedTableTrigger = React.forwardRef<HTMLButtonElement, ExpandedTriggerProps>(
  function ExpandedTableTrigger({ active, label, Icon, iconColor, className, ...rest }, ref) {
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
          <Icon
            className={cn(
              'h-[18px] w-[18px] transition-colors',
              // Active — clay (единообразно с остальной навигацией). Inactive —
              // постоянный highlight-цвет (если задан) либо серый дефолт.
              active
                ? 'text-accent-clay'
                : iconColor ?? 'text-text-primary group-hover:text-text-strong',
            )}
            strokeWidth={1.75}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-normal tracking-[-0.005em]">
          {label}
        </span>
      </button>
    );
  },
);

/**
 * Compact text-pill для collapsed sidebar. Вместо иконки FileSpreadsheet
 * показываем короткое имя таблицы (`WF`, `OTIF`). Тоже forwardRef +
 * spread props — иначе Radix HoverCard не подхватит hover-events.
 */
const CollapsedTextPill = React.forwardRef<
  HTMLButtonElement,
  TriggerProps & { iconColor: string | null }
>(
  function CollapsedTextPill({ label, active, iconColor, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        aria-label={label}
        title={label}
        className={cn(
          // §2026-05-19 — text-pill в collapsed sidebar выравниваем по
          // левому краю (justify-start), как в expanded sidebar.
          // §2026-05-29 — h-8 + px-1.5 (как NavItem/expanded-trigger): высота и
          // x-позиция совпадают с развёрнутым видом → при сворачивании пункт не
          // прыгает (ни по высоте, ни по горизонтали), только контент icon↔текст.
          'group flex h-8 w-full items-center justify-start rounded-md px-1.5',
          'text-[11.5px] font-semibold tabular-nums outline-none',
          'transition-colors',
          // Цвет имени = цвет иконки таблицы (бренд: WF синий, OTIF зелёный),
          // т.к. в collapsed иконки нет — текст её «замещает». Active → clay +
          // акцентная подсветка bg-bg-selected (как expanded и остальная навигация,
          // НЕ серый bg-bg-hover). Без цвета (дефолтные таблицы) — серый + hover.
          active
            ? 'bg-bg-selected text-accent-clay'
            : iconColor
              ? cn(iconColor, 'hover:bg-bg-hover')
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
          className,
        )}
      >
        {label}
      </button>
    );
  },
);

function TabRow({
  tab,
  active,
  onPick,
}: {
  tab: TableTab;
  active: boolean;
  onPick: () => void;
}): JSX.Element {
  const label = customTabName(tab.displayName || tab.rawName);
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]',
          'outline-none transition-colors',
          active
            ? 'bg-bg-hover text-text-strong'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
        )}
      >
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

export { sheetIdFromNavId, isSheetNavId };
