import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import type { Person } from '@pyn/core';
import { cn } from '@/lib/cn';

interface OrphanPanelProps {
  orphans: Person[];
  onEdit: (person: Person) => void;
}

/**
 * Панель «Нет МОЛов» — справа на начальном экране. Орфан = МОЛ-табельный из
 * договора без ФИО. Здесь — паттерн-фон виден (в отличие от Цеха), карточки
 * по центру (от середины), список растёт вниз и при переполнении прокручивается
 * (как панель складов). Карточка: табельный + склады (или «МОЛ») + «Редактировать».
 * Уходит при начале поиска (рендерится только на пустом запросе — решает MolScreen).
 */
export function OrphanPanel({ orphans, onEdit }: OrphanPanelProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mol-pattern-bg flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg pl-3">
      <div className="flex flex-1 flex-col overflow-y-auto px-0.5">
        {/* my-auto — блок по центру при паре карточек; растёт вниз и скроллится при многих. */}
        <div className="my-auto flex flex-col gap-2 py-2">
          <div className="mb-1 px-0.5">
            <h3 className="text-[12.5px] font-semibold text-text-strong">
              {t('mol.orphan.title')}
              <span className="ml-1.5 tabular-nums text-text-muted">{orphans.length}</span>
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-text-muted">{t('mol.orphan.subtitle')}</p>
          </div>
          {orphans.map((p) => (
            <OrphanCard key={p.id} person={p} onEdit={() => onEdit(p)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrphanCard({ person, onEdit }: { person: Person; onEdit: () => void }): JSX.Element {
  const { t } = useTranslation();
  const codes = person.warehouses.map((w) => w.code).filter(Boolean);
  return (
    <article className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tabular-nums text-text-strong">
          {t('mol.tab_short')} {person.tab || '—'}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-accent-clay"
          title={t('mol.edit_contact_tip')}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          {t('mol.orphan.edit')}
        </button>
      </div>
      {/* «МОЛ» если нет склада; иначе пилюли складов — переносятся по строкам, если не влазят. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {codes.length > 0 ? (
          codes.map((c) => (
            <span
              key={c}
              className={cn(
                'inline-flex items-center rounded-md bg-bg-hover px-1.5 py-0.5',
                'text-[11px] font-medium tabular-nums text-text-secondary',
              )}
            >
              {c}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center rounded-md bg-accent-clay/[0.12] px-1.5 py-0.5 text-[11px] font-medium text-accent-clay">
            {t('mol.orphan.mol_flag')}
          </span>
        )}
      </div>
    </article>
  );
}
