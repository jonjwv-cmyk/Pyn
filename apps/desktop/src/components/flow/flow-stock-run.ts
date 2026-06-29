import { getMacroBundle, flowStockImport, releaseSheetLock, type FlowStockImportResult } from '@pyn/core';
import { api } from '@/lib/api';
import { reportClientError } from '@/lib/error-report';
import { useWarehousesStore } from '@/lib/warehouses-store';

/**
 * Выгрузка ОСТАТКОВ по складам (SAP Y_DVK_31000007) → flow_stock_wh. Запускается
 * СРАЗУ ПОСЛЕ выгрузки заказов, в том же SAP-сеансе (ТЗ «после заказов выгрузка
 * остатков»). Тот же путь, что у заказов/zm_vl: сервер выдаёт VBS (tunable без
 * пересборки EXE) → приложение запускает SAP → ALV-grid → TSV С ШАПКОЙ → шлём
 * чанками в flow_stock_import (смысловой маппинг колонок — на сервере).
 *
 * Список складов берём из БАЗЫ ЦЕХА (живой справочник складов), пишем во входной
 * файл В КОДИРОВКЕ ANSI(1251) — коды '824Т','824Ц' содержат кириллицу, SAP/чтение
 * тем же codepage иначе бьёт коды. Windows-only (нужен SAP).
 */

const STOCK_ACTION_ID = 'flow_stock_export';

/** Все активные склады из базы цеха (не удалённые) — список для выгрузки остатков. */
function collectWarehouseCodes(): string[] {
  const codes = new Set<string>();
  for (const w of useWarehousesStore.getState().warehouses) {
    if (w.is_removed === 1) continue;
    const id = String(w.id ?? '').trim();
    if (id) codes.add(id);
  }
  return [...codes].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}

export interface FlowStockRunResult {
  ok: boolean;
  msg: string;
  result?: FlowStockImportResult;
}

/**
 * Прогнать выгрузку остатков. `password` — тот же, что у «Выгрузки заказов» (цепочка
 * после заказов не просит второй раз). Ошибки возвращаем как { ok:false, msg } — они
 * НЕ должны валить уже сохранённые заказы у вызывателя.
 */
export async function runFlowStockExport(password?: string): Promise<FlowStockRunResult> {
  if (window.pyn?.platform !== 'win32') return { ok: false, msg: 'Остатки: только на Windows (нужен SAP)' };
  const warehouses = collectWarehouseCodes();
  if (warehouses.length === 0) return { ok: false, msg: 'Остатки: пустой список складов (база цеха не загружена)' };
  try {
    const bundle = await getMacroBundle(api, {
      actionId: STOCK_ACTION_ID,
      password,
      tabName: '', // остатки не трогают видимый лист — без замка-оверлея на вкладке
      actionLabel: 'Выгрузка остатков',
    });
    if (!bundle.ok) {
      return { ok: false, msg: bundle.error === 'wrong_password' ? 'Остатки: неверный пароль' : `Остатки/макрос: ${bundle.error}` };
    }
    const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource, {
      inputFiles: [{
        envName: 'OTL_FLOW_WAREHOUSE_FILE',
        filename: 'flow-stock-warehouses.txt',
        content: warehouses.join('\r\n'),
        encoding: 'win1251', // ANSI — кириллица в кодах складов
      }],
    });
    if (!vbs || !vbs.ok || vbs.tsv == null) return { ok: false, msg: `Остатки SAP/VBS: ${vbs?.error ?? 'ошибка'}` };

    const result = await flowStockImport(api, vbs.tsv, warehouses);
    if (!result.stored) {
      // Колонки не распознались — данные пришли, но маппинг на сервере надо донастроить.
      return {
        ok: false,
        result,
        msg: `Остатки: колонки не распознаны (${result.header.length} кол). Шапка: ${result.header.slice(0, 12).join(', ')}`,
      };
    }
    return { ok: true, result, msg: `Остатки: ${result.inserted} строк по ${warehouses.length} складам · всего ${result.total}` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('flow_stock_import', m, { stack: e instanceof Error ? e.stack : undefined, context: 'Выгрузка остатков' });
    return { ok: false, msg: `Остатки: ошибка ${m.slice(0, 90)}` };
  } finally {
    await releaseSheetLock(api, STOCK_ACTION_ID).catch(() => undefined);
  }
}
