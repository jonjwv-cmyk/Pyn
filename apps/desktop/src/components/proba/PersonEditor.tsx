import { useEffect, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { LockableTrigger } from './LockableTrigger';

interface PersonEditorProps {
  /** Подпись поповера, e.g. «Утверждающий» или «Подготовил». */
  heading: string;
  /** ФИО, e.g. «П.А. Харламцев» / «И. В. Калягин». */
  name: string;
  /** Должность, e.g. «Начальник УПП». */
  title: string;
  onChange: (next: { name: string; title: string }) => void;
  children: ReactNode;
  /** Collaboration lock resource_id, e.g. 'schedule:2026-05:approver'. */
  lockResourceId?: string;
  /** true — месяц зафиксирован: редактор не открывается, на hover tooltip. */
  locked?: boolean;
}

/**
 * Popover-редактор ФИО + должности. Открывается из шапки/подвала Пробы при
 * клике на pill подсвеченной зоны. При open копирует текущие значения в
 * draft state, на «Подтвердить» вызывает onChange. Inheritance на следующий
 * месяц проставляется через `inheritForNewMonth` в ProbaScreen — здесь
 * только UI.
 *
 * Контент сохраняется в meta.approver/meta.deputy → persist в snapshot →
 * виден на печати. Pill сам ::before скрыт в @media print.
 */
export function PersonEditor({
  heading,
  name,
  title,
  onChange,
  children,
  lockResourceId,
  locked = false,
}: PersonEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftTitle, setDraftTitle] = useState(title);

  // Каждый раз при открытии — синкуем draft с текущими значениями
  // (на случай если они поменялись через undo/redo пока попап был закрыт).
  useEffect(() => {
    if (open) {
      setDraftName(name);
      setDraftTitle(title);
    }
  }, [open, name, title]);

  const dirty = draftName !== name || draftTitle !== title;

  const confirm = () => {
    onChange({ name: draftName.trim(), title: draftTitle.trim() });
    setOpen(false);
  };

  return (
    <Popover.Root open={locked ? false : open} onOpenChange={(o) => { if (!locked) setOpen(o); }}>
      <LockableTrigger locked={locked}>{children}</LockableTrigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[320px] rounded-lg border border-white/[0.08] bg-bg-elevated p-3 text-text-primary shadow-2xl outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) {
              e.preventDefault();
              confirm();
            }
          }}
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          <div className="mb-2 text-[12px] font-medium text-text-strong">
            {heading}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                {t('proba.person_name_label')}
              </span>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="П.А. Харламцев"
                className="h-7 rounded border border-white/[0.08] bg-bg-surface px-2 text-[12px] text-text-primary placeholder-text-muted/60 outline-none transition-colors focus:border-accent-clay/40"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                {t('proba.person_title_label')}
              </span>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Начальник УПП"
                className="h-7 rounded border border-white/[0.08] bg-bg-surface px-2 text-[12px] text-text-primary placeholder-text-muted/60 outline-none transition-colors focus:border-accent-clay/40"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded px-2.5 text-[12px] text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              {t('proba.person_cancel')}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!dirty || draftName.trim().length === 0}
              className="flex h-7 items-center gap-1 rounded bg-accent-clay px-2.5 text-[12px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-accent-clay"
            >
              <Check className="h-3 w-3" strokeWidth={1.75} />
              {t('proba.person_confirm')}
            </button>
          </div>
          </LockedEditorContent>

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
