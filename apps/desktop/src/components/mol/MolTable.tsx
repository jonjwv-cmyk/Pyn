import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MolRecord, ParsedMolQuery } from '@pyn/core';
import { cn } from '@/lib/cn';
import {
  formatMobilePhone,
  molStatusKind,
  splitAndFormatWorkPhones,
} from '@/lib/mol-format';
import { useUiStateStore } from '@/lib/stores';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import type { ContactActionRequest } from './ContactActionDialog';

interface MolTableProps {
  records: MolRecord[];
  parsed: ParsedMolQuery;
  /** true — справа есть WarehouseSidebar; колонки уже. */
  hasSidebar: boolean;
  /** Клик по phone/email → подтверждение действия в родителе. */
  onContactAction: (req: ContactActionRequest) => void;
  /**
   * Ключ persist'a scroll-position (включает текущий query чтобы scroll
   * сохранялся отдельно для каждого запроса). При reopen Pyn'a таблица
   * восстановится ровно туда где закрыли.
   */
  persistScrollKey: string;
}

/**
 * Linear-style таблица МОЛ — 5 колонок:
 *   № | ФИО (+должность под ним) | Телефоны (моб + раб) | E-mail | Статус (+таб.)
 *
 * Поведение:
 *   • ФИО wrap по словам — длинные двойные фамилии не обрезаются.
 *   • E-mail `break-all` wrap'ится на 2 строки если не помещается.
 *   • Клик по phone/email → callback `onContactAction` (родитель показывает
 *     confirmation dialog «Позвонить / Отправить письмо?»). Прямо `tel:` /
 *     `mailto:` НЕ открывается мгновенно — юзер должен подтвердить.
 *   • Cmd/Ctrl+A → выделяет только tbody.
 *   • onCopy на tbody → конвертирует selection в TSV (tab-разделённые ячейки,
 *     newline-разделённые строки) — Excel/Sheets paste'ит как proper cells,
 *     можно скопировать «столбец» простым cursor-выделением одной колонки.
 */
export function MolTable({
  records,
  parsed,
  hasSidebar,
  onContactAction,
  persistScrollKey,
}: MolTableProps) {
  const { t } = useTranslation();
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const molScrollTop = useUiStateStore((s) => s.molScrollTop);
  const setMolScrollTop = useUiStateStore((s) => s.setMolScrollTop);
  const [uiHydrated, setUiHydrated] = useState(() => useUiStateStore.persist.hasHydrated());
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScrollRef = useRef<number>(-1);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    if (uiHydrated) return;
    const unsub = useUiStateStore.persist.onFinishHydration(() => setUiHydrated(true));
    return unsub;
  }, [uiHydrated]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // Restore scroll когда (1) UI hydrated, (2) records есть. Defer на rAF.
  useEffect(() => {
    if (!uiHydrated || records.length === 0 || restoredRef.current) return;
    const saved = molScrollTop;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved;
      lastSavedScrollRef.current = saved;
      restoredRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiHydrated, records.length === 0, persistScrollKey]);

  // При смене query — сбрасываем restored-флаг чтобы новый scroll был applied.
  useEffect(() => {
    restoredRef.current = false;
    lastSavedScrollRef.current = -1;
  }, [persistScrollKey]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    // Стрелка прокрутки вниз — show когда юзер пролистал и до низа осталось
    // больше 64px. Идентично Chats/News (см. ScrollToBottomButton).
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);

    if (!uiHydrated || !restoredRef.current) return;
    const current = el.scrollTop;
    if (Math.abs(current - lastSavedScrollRef.current) < 8) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedScrollRef.current = current;
      setMolScrollTop(current);
    }, 250);
  };

  // Обновляем visible-флаг стрелки при смене records (после search → новая
  // длина списка → может быть нужно показать/скрыть).
  useEffect(() => {
    handleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return;
      const table = tableRef.current;
      if (!table) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(tbody);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);

  const handleCopy = (e: React.ClipboardEvent<HTMLTableSectionElement>): void => {
    const tsv = buildTsvFromSelection(window.getSelection(), tableRef.current);
    if (tsv !== null) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', tsv);
    }
  };

  if (parsed.mode === 'empty') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className={cn(
            'text-center text-[28px] font-semibold tracking-[-0.02em]',
            'text-text-secondary/85',
          )}
        >
          {t('mol.search_hero')}
        </p>
      </div>
    );
  }

  if (records.length === 0) {
    const message =
      parsed.mode === 'warehouse'
        ? t('mol.warehouse_not_found')
        : parsed.mode === 'phone'
          ? t('mol.phone_not_found')
          : parsed.mode === 'email'
            ? t('mol.phone_not_found')
            : t('mol.employee_not_found');
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[12.5px] text-text-muted">{message}</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
      {/* pb-[64px] — последний row подпрыгивает над композером, не прижат. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="mol-scroll flex-1 overflow-y-auto pb-[64px]"
      >
        <table
          ref={tableRef}
          className="w-full table-fixed border-separate border-spacing-0 text-[12px]"
        >
          {hasSidebar ? (
            <colgroup>
              <col className="w-[5%]" />    {/* № */}
              <col className="w-[28%]" />   {/* ФИО + Должность */}
              <col className="w-[17%]" />   {/* Телефоны */}
              <col className="w-[36%]" />   {/* E-mail */}
              <col className="w-[14%]" />   {/* Статус + Таб */}
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[25%]" />
              <col className="w-[15%]" />
              <col className="w-[44%]" />
              <col className="w-[12%]" />
            </colgroup>
          )}
          <thead className="select-none sticky top-0 z-10 bg-bg-surface">
            {/* Заголовки — center horizontal + middle vertical. */}
            <tr className="text-center text-[10.5px] uppercase tracking-wider text-text-muted">
              <Th>№</Th>
              <Th>{t('mol.fio')}</Th>
              <Th>{t('mol.phones')}</Th>
              <Th>E-mail</Th>
              <Th>{t('mol.status')}</Th>
            </tr>
          </thead>
          <tbody className="select-text cursor-text" onCopy={handleCopy}>
            {records.map((r, idx) => (
              <MolRow
                key={`${r.remoteId}-${r.warehouseId}-${idx}`}
                record={r}
                index={idx}
                onContactAction={onContactAction}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MolRow({
  record,
  index,
  onContactAction,
}: {
  record: MolRecord;
  index: number;
  onContactAction: (req: ContactActionRequest) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const kind = molStatusKind(record.status);
  const mobile = formatMobilePhone(record.mobile);
  const workPhones = splitAndFormatWorkPhones(record.work);

  const rowBg =
    kind === 'ok'
      ? 'bg-presence-online/[0.08] hover:bg-presence-online/[0.14]'
      : kind === 'error'
        ? 'bg-danger/[0.06] hover:bg-danger/[0.12]'
        : index % 2 === 1
          ? 'bg-bg-elevated/30 hover:bg-bg-hover'
          : 'hover:bg-bg-hover';

  const statusColor =
    kind === 'ok' ? 'text-presence-online' : kind === 'error' ? 'text-danger' : 'text-text-muted';

  const callMobile = () =>
    onContactAction({
      kind: 'call',
      target: record.mobile,
      display: mobile,
      contactName: record.fio || t('mol.contact_unknown'),
    });

  const callWork = (workDisplay: string) =>
    onContactAction({
      kind: 'call',
      target: workDisplay,
      display: workDisplay,
      contactName: t('mol.contact_work_suffix', {
        name: record.fio || t('mol.contact_unknown_short'),
      }),
    });

  const sendMail = () =>
    onContactAction({
      kind: 'mail',
      target: record.mail,
      display: record.mail,
      contactName: record.fio || t('mol.contact_unknown'),
    });

  return (
    <tr className={cn('group transition-colors', rowBg)}>
      <Td className="text-center text-text-muted tabular-nums">{index + 1}</Td>

      {/* ФИО: wrap по словам (фамилия+имя в одну, отчество на 2-ю если не
           помещается). break-words гарантирует что слова не обрезаются. */}
      <Td>
        <div className="whitespace-normal break-words text-[13px] font-medium leading-snug text-text-strong">
          {record.fio || '—'}
        </div>
        {record.position && (
          <div className="mt-0.5 whitespace-normal break-words text-[11px] leading-snug text-text-muted">
            {record.position}
          </div>
        )}
      </Td>

      {/* Телефоны — mobile сверху bold, work снизу muted. Клик → confirm. */}
      <Td className="tabular-nums">
        {mobile || workPhones.length > 0 ? (
          <div className="flex flex-col gap-0.5 leading-tight">
            {mobile && (
              <button
                type="button"
                onClick={callMobile}
                className="text-left whitespace-nowrap text-text-strong hover:text-accent-clay"
              >
                {mobile}
              </button>
            )}
            {workPhones.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => callWork(p)}
                className="text-left whitespace-nowrap text-[11px] text-text-muted hover:text-accent-clay"
              >
                {p}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      {/* E-mail — целиком, длинный wrap'ится по символам (break-all). */}
      <Td>
        {record.mail ? (
          <button
            type="button"
            onClick={sendMail}
            className="block text-left break-all leading-snug text-accent-clay hover:underline"
          >
            {record.mail}
          </button>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      {/* Статус (цветной, одна строка с естественным wrap по словам) + таб. */}
      <Td>
        <div
          className={cn(
            'whitespace-normal break-words text-[11.5px] font-medium leading-snug',
            statusColor,
          )}
        >
          {record.status || '—'}
        </div>
        {record.tab && (
          <div className="mt-0.5 text-[10.5px] tabular-nums text-text-muted">
            таб. {record.tab}
          </div>
        )}
      </Td>
    </tr>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <th
      className={cn(
        'border-b border-border-subtle bg-bg-surface px-2 py-1.5 font-medium align-middle',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  // Vertical middle, horizontal left (text-left по умолчанию). Это даёт
  // ровный «glance» через ряд независимо от того сколько строк в каждой
  // ячейке (ФИО+должность vs phone vs single status).
  return (
    <td className={cn('border-b border-border-subtle px-2 py-1.5 align-middle text-left', className)}>
      {children}
    </td>
  );
}

/**
 * Превращает текущий selection в TSV: ячейки строки разделены TAB,
 * строки — newline. Excel / Sheets / Numbers распознают это как proper
 * табличные данные при paste.
 *
 * Логика:
 *   • Находим `<tr>` элементы внутри tbody, которые пересекаются с selection.
 *   • Для каждой tr берём все `<td>` и собираем text content.
 *   • Если td НЕ пересекается с selection — оставляем пустую строку
 *     (это позволяет «скопировать столбец»: выделил курсором cells
 *     одной column → остальные cells приходят пустыми).
 *
 * Возвращает `null` если selection вне tbody — пусть браузер делает свой
 * default copy.
 */
function buildTsvFromSelection(sel: Selection | null, table: HTMLTableElement | null): string | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  if (!table) return null;
  const tbody = table.querySelector('tbody');
  if (!tbody) return null;

  const rows: string[] = [];
  let anySelected = false;
  for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
    const trSelected = sel.containsNode(tr, true);
    if (!trSelected) continue;
    anySelected = true;
    const cells: string[] = [];
    for (const td of Array.from(tr.querySelectorAll('td'))) {
      if (!sel.containsNode(td, true)) {
        cells.push('');
        continue;
      }
      // Нормализуем whitespace внутри ячейки (множественные пробелы / \n →
      // одиночный пробел) — TSV не должен иметь tabs/newlines внутри cell.
      const text = (td.textContent || '')
        .replace(/[\t\n\r]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      cells.push(text);
    }
    rows.push(cells.join('\t'));
  }

  if (!anySelected) return null;
  return rows.join('\n');
}
