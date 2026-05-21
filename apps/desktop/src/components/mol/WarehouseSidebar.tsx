import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Phone } from 'lucide-react';
import type { MolRecord } from '@pyn/core';
import { cn } from '@/lib/cn';
import { splitAndFormatWorkPhones } from '@/lib/mol-format';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import type { ContactActionRequest } from './ContactActionDialog';

export interface NotFoundList {
  /** Введённые warehouse-id, которых нет в базе (включая неполные < 4 цифр). */
  warehouses: string[];
  /** Email-запросы которые ничего не нашли (raw). */
  emails: string[];
  /** ФИО-запросы которые ничего не нашли (raw). */
  names: string[];
}

interface WarehouseSidebarProps {
  /** Map<warehouseId, MolRecord[]> — найденные склады. */
  groups: Map<string, MolRecord[]>;
  /** Что НЕ нашли — рендерится отдельной карточкой сверху списка. */
  notFound: NotFoundList;
  /** Клик по телефону склада → подтверждение в родителе. */
  onContactAction: (req: ContactActionRequest) => void;
}

/**
 * Правый sidebar: сначала NotFoundCard (если есть невалидные/не-найденные
 * tokens), потом WarehouseCard на каждый найденный склад.
 *
 * Текст в карточках wrap'ится по словам (`break-words`), длинные названия
 * цехов и keeper'ов не вылезают за рамки даже на узких карточках.
 */
export function WarehouseSidebar({ groups, notFound, onContactAction }: WarehouseSidebarProps) {
  const entries = [...groups.entries()];
  const showNotFound =
    notFound.warehouses.length + notFound.emails.length + notFound.names.length > 0;
  const scrollRef = useRef<HTMLElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const checkScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);
  };

  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // Re-check при смене состава карточек (после нового search'a).
  useEffect(() => {
    checkScroll();
  }, [entries.length, showNotFound]);

  return (
    <div className="relative flex w-[320px] shrink-0">
      <aside
        ref={scrollRef}
        onScroll={checkScroll}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto border-l border-border-subtle',
          'bg-bg-surface p-3',
        )}
      >
        <div className="flex flex-col gap-2.5">
          {showNotFound && <NotFoundCard notFound={notFound} />}
          {entries.map(([wid, records]) => (
            <WarehouseCard
              key={wid}
              warehouseId={wid}
              records={records}
              onContactAction={onContactAction}
            />
          ))}
        </div>
      </aside>
      {/* В sidebar нет floating-композера — стрелку прижимаем низко (bottom-3)
          вместо bottom-20 для основного scroll-контейнера. Полупрозрачный
          backdrop-blur делает её читаемой над любой карточкой. */}
      <ScrollToBottomButton
        visible={showScrollDown}
        onClick={scrollToBottom}
        className="!bottom-3"
      />
    </div>
  );
}

function NotFoundCard({ notFound }: { notFound: NotFoundList }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'rounded-lg border border-danger/40 bg-danger/[0.06] px-4 py-3',
        'text-[12.5px] leading-snug',
      )}
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
        <h3 className="text-[13.5px] font-semibold text-danger">{t('mol.not_found_title')}</h3>
      </div>
      <ul className="mt-2 space-y-1">
        {notFound.warehouses.map((w) => (
          <li key={`w-${w}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">{t('mol.warehouse').toLowerCase()}</span>
            <span className="tabular-nums">{w}</span>
          </li>
        ))}
        {notFound.emails.map((e) => (
          <li key={`e-${e}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">email</span>
            <span className="break-all" title={e}>{e}</span>
          </li>
        ))}
        {notFound.names.map((n) => (
          <li key={`n-${n}`} className="flex items-baseline gap-2 text-text-secondary">
            <span className="text-[10.5px] uppercase tracking-wider text-text-muted">{t('mol.fio')}</span>
            <span className="break-words" title={n}>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WarehouseCard({
  warehouseId,
  records,
  onContactAction,
}: {
  warehouseId: string;
  records: MolRecord[];
  onContactAction: (req: ContactActionRequest) => void;
}) {
  const { t } = useTranslation();
  const first = records[0];
  if (!first) return null;

  // 4 поля складского справочника (1:1 с server-схемой base_records):
  //   warehouseName    — название цеха («первая строка», bold)
  //   warehouseDesc    — описание («Центральный склад СП»)
  //   warehouseMark    — обозначение («КБЦ МПЗ»)
  //   warehouseKeeper  — кладовщик («КБЦ МПЗ»)
  const workshop = first.warehouseName.trim();
  const desc = first.warehouseDesc.trim();
  const mark = first.warehouseMark.trim();
  const keeper = first.warehouseKeeper.trim();
  const phones = splitAndFormatWorkPhones(first.warehouseWorkPhones);

  return (
    <div
      className={cn(
        'rounded-lg border border-border-default bg-bg-elevated px-4 py-3',
        'text-[12.5px] leading-snug',
      )}
    >
      <h3 className="text-[15px] font-bold tabular-nums text-text-strong">
        {t('mol.warehouse')} {warehouseId}
      </h3>

      {workshop && (
        <p className="mt-1.5 whitespace-normal break-words font-medium leading-snug text-text-primary">
          {workshop}
        </p>
      )}

      {(desc || mark || keeper) && (
        <div className="mt-2 space-y-0.5 text-text-secondary">
          {desc && desc !== workshop && (
            <p className="whitespace-normal break-words">
              <span className="text-text-muted">{t('mol.description')}:</span> {desc}
            </p>
          )}
          {mark && (
            <p className="whitespace-normal break-words">
              <span className="text-text-muted">{t('mol.designation')}:</span> {mark}
            </p>
          )}
          {keeper && (
            <p className="whitespace-normal break-words">
              <span className="text-text-muted">{t('mol.keeper')}:</span> {keeper}
            </p>
          )}
        </div>
      )}

      {phones.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {phones.map((phone, i) => (
            <button
              key={i}
              type="button"
              onClick={() =>
                onContactAction({
                  kind: 'callWarehouse',
                  target: phone,
                  display: phone,
                  contactName: `${t('mol.warehouse')} ${warehouseId}`,
                })
              }
              className={cn(
                '-mx-1 flex w-full items-center gap-2 rounded px-1 py-0.5',
                'text-left text-[13.5px] font-semibold tabular-nums text-text-strong',
                'transition-colors hover:bg-bg-hover',
              )}
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span>{phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
