import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { isValidPersonFio, type Person } from '@pyn/core';
import { cn } from '@/lib/cn';

interface OrphanPanelProps {
  /** Активные МОЛ без валидного ФИО (есть табельный). */
  newMols: Person[];
  /** source=sap_mol, уже не МОЛ, ФИО не завели. */
  newContacts: Person[];
  /** Режим «Нормализация» — единый список «кривых» записей (tab + дыры в данных). */
  normalizeMode?: boolean;
  normalizePeople?: Person[];
  onEdit: (person: Person) => void;
}

/**
 * Боковая панель: «Новый МОЛ / Новые контакты» или «Нормализация».
 */
export function OrphanPanel({
  newMols,
  newContacts,
  normalizeMode = false,
  normalizePeople = [],
  onEdit,
}: OrphanPanelProps): JSX.Element | null {
  const { t } = useTranslation();

  if (normalizeMode) {
    if (normalizePeople.length === 0) {
      return (
        <div className="mol-pattern-bg flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg pl-3">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-6 text-center">
            <p className="text-[12.5px] font-semibold text-text-strong">
              {t('mol.normalize.title')}
            </p>
            <p className="mt-1 text-[11px] text-text-muted">{t('mol.normalize.empty')}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="mol-pattern-bg flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg pl-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0.5 py-2">
          <div className="my-auto flex max-h-full min-h-0 w-full flex-col">
            <SectionHeader
              title={t('mol.normalize.title')}
              count={normalizePeople.length}
            />
            <div className="min-h-0 overflow-y-auto">
              <div className="flex flex-col gap-2 pb-0.5">
                {normalizePeople.map((p) => (
                  <OrphanCard
                    key={p.id}
                    person={p}
                    kind={p.isMol ? 'mol' : 'contact'}
                    onEdit={() => onEdit(p)}
                    showGaps
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (newMols.length === 0 && newContacts.length === 0) return null;

  const hasMols = newMols.length > 0;
  const hasContacts = newContacts.length > 0;
  const both = hasMols && hasContacts;

  const molTitle =
    newMols.length === 1 ? t('mol.orphan.title_mol_one') : t('mol.orphan.title_mol_many');
  const contactTitle =
    newContacts.length === 1
      ? t('mol.orphan.title_contact_one')
      : t('mol.orphan.title_contact_many');

  if (!both) {
    const people = hasMols ? newMols : newContacts;
    const kind = hasMols ? 'mol' : 'contact';
    const title = hasMols ? molTitle : contactTitle;
    return (
      <div className="mol-pattern-bg flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg pl-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0.5 py-2">
          <div className="my-auto flex max-h-full min-h-0 w-full flex-col">
            <SectionHeader title={title} count={people.length} />
            <div className="min-h-0 overflow-y-auto">
              <CardList people={people} kind={kind} onEdit={onEdit} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mol-pattern-bg flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg pl-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0.5">
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden border-b border-border-default/25 pb-2 pt-1">
          <div className="flex max-h-full min-h-0 w-full flex-col">
            <SectionHeader title={molTitle} count={newMols.length} />
            <div className="min-h-0 overflow-y-auto">
              <CardList people={newMols} kind="mol" onEdit={onEdit} />
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-1 pt-2">
          <div className="flex max-h-full min-h-0 w-full flex-col">
            <SectionHeader title={contactTitle} count={newContacts.length} />
            <div className="min-h-0 overflow-y-auto">
              <CardList people={newContacts} kind="contact" onEdit={onEdit} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }): JSX.Element {
  return (
    <div className="shrink-0 px-0.5 pb-1.5">
      <h3 className="text-[12.5px] font-semibold text-text-strong">
        {title}
        <span className="ml-1.5 tabular-nums text-text-muted">{count}</span>
      </h3>
    </div>
  );
}

function CardList({
  people,
  kind,
  onEdit,
}: {
  people: Person[];
  kind: 'mol' | 'contact';
  onEdit: (person: Person) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 pb-0.5">
      {people.map((p) => (
        <OrphanCard key={p.id} person={p} kind={kind} onEdit={() => onEdit(p)} />
      ))}
    </div>
  );
}

function gapLabels(person: Person, t: (k: string) => string): string[] {
  const hasWh = person.warehouses.some(
    (w) => (w.code && w.code !== 'МОЛ' && w.code !== 'MOL') || w.isWas,
  );
  const gaps: string[] = [];
  if (!isValidPersonFio(person.fio)) gaps.push(t('mol.normalize.gap_fio'));
  // Почта — метка только если есть склад/«был» (для просто МОЛ не требуем).
  if (hasWh && !person.mail.trim()) gaps.push(t('mol.normalize.gap_mail'));
  if (!person.mobile.trim()) gaps.push(t('mol.normalize.gap_mobile'));
  return gaps;
}

function OrphanCard({
  person,
  kind,
  onEdit,
  showGaps = false,
}: {
  person: Person;
  kind: 'mol' | 'contact';
  onEdit: () => void;
  showGaps?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  // Реальные склады + «был» (код склада), без плейсхолдера «МОЛ».
  const codes = person.warehouses
    .filter((w) => w.code && w.code !== 'МОЛ' && w.code !== 'MOL')
    .map((w) => ({ code: w.code, isWas: !!w.isWas }));
  const isMol = kind === 'mol';
  const gaps = showGaps ? gapLabels(person, t) : [];
  const hasWh = codes.length > 0;
  return (
    <article
      className={cn(
        'shrink-0 rounded-lg border px-3 py-2.5 backdrop-blur-sm',
        isMol || hasWh
          ? 'border-amber-400/30 bg-amber-400/[0.06]'
          : 'border-border-default/80 bg-bg-elevated/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tabular-nums text-text-strong">
          {t('mol.tab_short')} {person.tab}
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
      {person.fio.trim() && (
        <div className="mt-1 truncate text-[11px] text-text-secondary" title={person.fio}>
          {person.fio}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {/* Склады / просто МОЛ — всегда видно, что за тип */}
        {hasWh
          ? codes.map(({ code, isWas }) => (
              <span
                key={`${code}-${isWas ? 'was' : 'now'}`}
                className={cn(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                  isWas
                    ? 'bg-text-muted/12 text-text-muted ring-1 ring-border-default/50'
                    : 'bg-bg-hover text-text-secondary',
                )}
                title={isWas ? t('mol.normalize.was_wh') : undefined}
              >
                {isWas ? `${code} · ${t('mol.normalize.was_short')}` : code}
              </span>
            ))
          : (
              <span className="inline-flex items-center rounded-md bg-accent-clay/[0.12] px-1.5 py-0.5 text-[11px] font-medium text-accent-clay">
                {t('mol.orphan.mol_flag')}
              </span>
            )}
        {/* Дыры: нет сотового / почты / ФИО */}
        {showGaps
          && gaps.map((g) => (
            <span
              key={g}
              className="inline-flex items-center rounded-md bg-danger/[0.1] px-1.5 py-0.5 text-[10.5px] font-medium text-danger/90"
            >
              {g}
            </span>
          ))}
      </div>
    </article>
  );
}
