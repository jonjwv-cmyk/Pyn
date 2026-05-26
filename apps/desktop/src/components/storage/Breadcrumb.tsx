import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { useStorageStore } from '@pyn/core';
import { cn } from '@/lib/cn';

interface BreadcrumbProps {
  root: string;
  currentPath: string;
}

interface Segment {
  label: string;
  path: string;
}

/**
 * Top breadcrumb с back/forward кнопками. Сегменты пути clickable
 * (можно перейти на любой родительский уровень одним кликом).
 *
 * §pyn-1.2.21 — у каждого non-last сегмента есть маленький ChevronDown
 * рядом с label: клик на него → Popover со списком siblings (например
 * в «2026» chevron → выпадает список всех годов). Click на label —
 * как раньше, навигация к этому сегменту. Юзер: «удобнее быстро
 * прыгать в глубокой иерархии Планы/2026/Май/7.5.26».
 */
export function Breadcrumb({ root, currentPath }: BreadcrumbProps) {
  const { t } = useTranslation();
  const history = useStorageStore((s) => s.history);
  const forwardStack = useStorageStore((s) => s.forwardStack);
  const back = useStorageStore((s) => s.back);
  const forward = useStorageStore((s) => s.forward);
  const navigateTo = useStorageStore((s) => s.navigateTo);

  // §pyn-1.2.47 — Локализация первого сегмента (Tile-name). Папка
  // `1. Согласование и Рассылка` → `t('storage.home.consent_routing')`,
  // и т.д. Остальные сегменты (год, месяц, день) показываем как есть.
  const TILE_LABEL_KEYS: Record<string, string> = {
    '1.': 'storage.home.consent_routing',
    '2.': 'storage.home.plans',
    '3.': 'storage.home.delivery_schedule',
    '4.': 'storage.home.reports',
  };
  const localizeTileName = (name: string): string => {
    const trimmed = name.trim();
    for (const prefix in TILE_LABEL_KEYS) {
      if (trimmed.startsWith(prefix)) {
        return t(TILE_LABEL_KEYS[prefix]!, trimmed);
      }
    }
    return trimmed;
  };

  const segments: Segment[] = (() => {
    if (!currentPath || !currentPath.toLowerCase().startsWith(root.toLowerCase())) {
      return [{ label: t('storage.root_label', 'Хранилище'), path: root }];
    }
    const tail = currentPath.slice(root.length);
    const parts = tail.split('\\').filter((p) => p.length > 0);
    const segs: Segment[] = [{ label: t('storage.root_label', 'Хранилище'), path: root }];
    let acc = root;
    parts.forEach((part, idx) => {
      acc = acc + '\\' + part;
      // Первый сегмент после root — это «1. Согласование и Рассылка» и т.д.
      // Локализуем имя tile через mapping. Остальные (год, месяц, день) — as-is.
      const label = idx === 0 ? localizeTileName(part) : part;
      segs.push({ label, path: acc });
    });
    return segs;
  })();

  const canBack = history.length > 0;
  const canForward = forwardStack.length > 0;

  return (
    <div className="flex items-center gap-1 border-b border-border-subtle px-4 py-2.5">
      <button
        type="button"
        onClick={back}
        disabled={!canBack}
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        title={t('storage.back', 'Назад')}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={forward}
        disabled={!canForward}
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        title={t('storage.forward', 'Вперёд')}
      >
        <ArrowRight className="h-4 w-4" strokeWidth={2} />
      </button>

      <div className="mx-1 h-4 w-px bg-border-subtle" />

      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {segments.map((seg, idx) => {
          const isLast = idx === segments.length - 1;
          // parent для siblings — это родитель текущего сегмента (предыдущий
          // в массиве). Для root (idx=0) siblings нет — просто статичный label.
          const parentPath = idx > 0 ? segments[idx - 1]!.path : null;
          return (
            <div key={seg.path} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => navigateTo(seg.path)}
                className={`rounded-md px-2 py-1 text-sm transition-colors ${
                  isLast
                    ? 'font-medium text-text-primary'
                    : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                {seg.label}
              </button>
              {parentPath && (
                <SiblingDropdown
                  parentPath={parentPath}
                  currentPath={seg.path}
                  onNavigate={navigateTo}
                  rootPath={root}
                  localize={localizeTileName}
                />
              )}
              {!isLast && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-50" strokeWidth={2} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Маленький ChevronDown рядом с сегментом, открывает Popover со списком
 * соседних папок (siblings) на том же уровне. Click на sibling — navigate.
 * Lazy-load: list() вызывается только при открытии Popover'а.
 */
function SiblingDropdown({
  parentPath,
  currentPath,
  onNavigate,
  rootPath,
  localize,
}: {
  parentPath: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  rootPath: string;
  localize: (name: string) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [siblings, setSiblings] = useState<{ name: string; fullPath: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void window.pyn?.fs?.list(parentPath).then((res) => {
      if (cancelled) return;
      if (res?.ok && res.entries) {
        setSiblings(
          res.entries
            .filter((e) => e.isDirectory)
            .map((e) => ({ name: e.name, fullPath: e.fullPath })),
        );
      } else {
        setSiblings([]);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, parentPath]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('storage.breadcrumb_dropdown_aria')}
          className="rounded-md p-0.5 text-text-muted opacity-60 transition-colors hover:bg-bg-hover hover:text-text-primary hover:opacity-100 data-[state=open]:bg-bg-hover data-[state=open]:opacity-100"
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2.25} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            'z-50 max-h-[360px] min-w-[200px] overflow-y-auto rounded-xl',
            'border border-border-subtle bg-bg-elevated p-1 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-text-muted">
              {t('storage.loading')}
            </div>
          )}
          {!loading && siblings.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">—</div>
          )}
          {!loading && siblings.map((s) => {
            const isCurrent = s.fullPath.toLowerCase() === currentPath.toLowerCase();
            // §pyn-1.2.47 — если siblings лежат прямо в root → локализуем имя.
            const label = parentPath.toLowerCase() === rootPath.toLowerCase()
              ? localize(s.name)
              : s.name;
            return (
              <button
                key={s.fullPath}
                type="button"
                onClick={() => {
                  onNavigate(s.fullPath);
                  setOpen(false);
                }}
                className={cn(
                  'block w-full truncate rounded-md px-3 py-1.5 text-left text-sm outline-none transition-colors',
                  isCurrent
                    ? 'bg-accent-clay/10 font-medium text-accent-clay'
                    : 'text-text-primary hover:bg-bg-hover',
                )}
              >
                {label}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
