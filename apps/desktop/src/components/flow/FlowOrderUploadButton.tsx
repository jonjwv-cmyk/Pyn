import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';
import { flowImport, getMacroBundle, parseOrdersTsv } from '@pyn/core';
import { api } from '@/lib/api';
import { customActionLabel, useTablesRegistry } from '@/lib/use-tables-registry';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';
import { reportClientError } from '@/lib/error-report';
import { runFlowStockExport } from '@/components/flow/flow-stock-run';

/** Гонять ли выгрузку ОСТАТКОВ тем же SAP-сеансом после заказов. Выключено (юзер
 *  2026-07-04) — остатки ни разу не доехали (нет ни таблицы, ни stock_last_header в D1);
 *  включим обратно после отдельного разбирательства с макросом Y_DVK_31000007. */
const FLOW_STOCK_CHAIN: boolean = false;

/**
 * Кнопка «Выгрузка заказов» (этап Формирование раздела «Поток»). Запускает ТОТ ЖЕ
 * VBS-макрос заказов, что и раздел «Таблицы» (SAP VL10D → TSV), но результат шлёт в
 * НАШЕ формирование (`flow_import`, E2E через слепой VPS), а не в Google. Само
 * действие/VBS-исходник берём из реестра «Таблиц» (`get_macro_bundle`) — VBS не
 * дублируем. Windows-only (cscript+SAP); на Mac — подсказка.
 */
export function FlowOrderUploadButton({
  onRunningChange,
  blocked = false,
}: {
  /** Сообщает родителю (FlowScreen) о старте/завершении прогона — для индикатора/блокировки листа. */
  onRunningChange?: (running: boolean) => void;
  /** Кто-то ДРУГОЙ уже гонит выгрузку (общий lock) — кнопка заблокирована, параллельно нельзя. */
  blocked?: boolean;
} = {}): JSX.Element {
  const { t } = useTranslation();
  const { files } = useTablesRegistry();

  // Находим действие «Обновить заказы» (любой лист/вкладка) — у него есть macroId.
  const found = useMemo(() => {
    for (const f of files) {
      for (const tab of f.tabs) {
        for (const a of tab.actions ?? []) {
          if (a.macroId && customActionLabel(a.label, t) === t('tables_registry.action_update_orders')) {
            return { action: a, tabName: tab.rawName };
          }
        }
      }
    }
    return null;
  }, [files, t]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  const run = async (password?: string): Promise<void> => {
    if (!found || busy) return;
    if (window.pyn?.platform !== 'win32') {
      setMsg('Только на Windows (нужен SAP)');
      return;
    }
    // Момент нажатия — начало прогона (включает VBS/SAP); для журнала LOG + окна-блокировки.
    const startedAt = new Date().toISOString();
    setBusy(true);
    onRunningChange?.(true);
    setMsg(null);
    try {
      const bundle = await getMacroBundle(api, {
        actionId: found.action.id,
        password,
        tabName: found.tabName,
        actionLabel: found.action.label,
      });
      if (!bundle.ok) {
        setMsg(bundle.error === 'wrong_password' ? 'Неверный пароль' : `Макрос: ${bundle.error}`);
        return;
      }
      const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource);
      if (!vbs || !vbs.ok || !vbs.tsv) {
        setMsg(`SAP/VBS: ${vbs?.error ?? 'ошибка'}`);
        return;
      }
      const rows = parseOrdersTsv(vbs.tsv);
      if (rows.length === 0) {
        setMsg('Пустая выгрузка');
        return;
      }
      const r = await flowImport(api, rows, startedAt);
      const ordersMsg = `Готово: было ${r.total_before} → стало ${r.total_after} · +${r.inserted} нов · ${r.deleted} удал · ${r.off} OFF`;
      // Цепочка «после заказов выгрузка остатков» ВЫКЛЮЧЕНА (юзер 2026-07-04: остатки
      // не тянутся — SAP-шаг ни разу не доехал до сервера; отключаем до отдельного
      // разбирательства, заказы живут сами по себе). Вернуть: FLOW_STOCK_CHAIN = true.
      if (FLOW_STOCK_CHAIN) {
        setMsg(`${ordersMsg} · остатки…`);
        const stock = await runFlowStockExport(password);
        setMsg(`${ordersMsg} · ${stock.msg}`);
      } else {
        setMsg(ordersMsg);
      }
    } catch (e) {
      setMsg(`Ошибка: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      reportClientError('flow_import', e instanceof Error ? e.message : String(e), {
        stack: e instanceof Error ? e.stack : undefined,
        context: 'Выгрузка заказов',
      });
    } finally {
      setBusy(false);
      onRunningChange?.(false);
    }
  };

  const onClick = (): void => {
    if (!found || busy || blocked) return;
    if (found.action.requiresPassword) setPwOpen(true);
    else void run();
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="no-drag-region max-w-[260px] truncate text-[11px] text-text-muted/80" title={msg}>{msg}</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={!found || busy || blocked}
        title={
          blocked
            ? 'Идёт выгрузка заказов (другой пользователь)'
            : found
              ? 'Выгрузить заказы из SAP в формирование'
              : 'Действие выгрузки не найдено в реестре «Таблиц»'
        }
        className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:opacity-50"
      >
        {busy ? (
          <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <Download size={13} strokeWidth={1.75} />
        )}
        Выгрузка заказов
      </button>
      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel="Выгрузка заказов"
        onSubmit={(pw) => {
          setPwOpen(false);
          void run(pw);
        }}
        onCancel={() => setPwOpen(false)}
      />
    </div>
  );
}
