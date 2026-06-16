import {
  flowSedReconcile,
  flowZmvlReconcile,
  getMacroBundle,
  parseSedTsv,
  parseZmvlTsv,
  releaseSheetLock,
} from '@pyn/core';
import { api } from '@/lib/api';
import { reportClientError } from '@/lib/error-report';

/**
 * Общий прогон SAP-актуализации «Потока» (СЭД / zm_vl открытые / zm_vl сверка).
 * Раньше жил в кнопках тулбара Отчёта; теперь кнопки переехали в ЛЕВЫЙ САЙДБАР
 * (юзер 2026-06-16: «думал они в сайдбаре слева, не сверху отчёта») → логика вынесена сюда,
 * чтобы и сайдбар, и любой другой вызыватель гоняли один и тот же путь:
 *   сервер выдаёт VBS (server-tunable) → приложение запускает SAP → TSV из ALV/файла →
 *   parse → reconcile в D1 → реалтайм всем. Только Windows (нужен SAP). Пароль — у вызывателя.
 */
export const FLOW_SAP_PASSWORD = '7777';

export type FlowSapActionId = 'sed' | 'obd' | 'zmvl';

type SapActionDef = {
  /** id действия для getMacroBundle / sheets-registry / журнала прогона. */
  actionId: string;
  /** Вкладка-источник (для подбора макроса на сервере). */
  tabName: string;
  /** Человекочитаемое имя действия (журнал/ошибки). */
  actionLabel: string;
  /** Разбор TSV → reconcile → строка-итог для показа. */
  process: (tsv: string) => Promise<string>;
};

/** Маппинг сайдбар-кнопок на реальные действия (ТЗ §5): OBD→открытые, zm_vl→полная сверка, СЭД→СЭД. */
export const FLOW_SAP_ACTIONS: Record<FlowSapActionId, SapActionDef> = {
  sed: {
    actionId: 'flow_sed_reconcile',
    tabName: 'СЭД',
    actionLabel: 'Выгрузка СЭД',
    process: async (tsv) => {
      const rows = parseSedTsv(tsv);
      if (rows.length === 0) return 'Пустая выгрузка СЭД';
      const r = await flowSedReconcile(api, rows);
      return `СЭД: ${r.received} строк · ${r.docs} поставок · ${r.updated} обновл · ${r.events} событий`;
    },
  },
  obd: {
    actionId: 'flow_zmvl_open',
    tabName: 'ZM_VL',
    actionLabel: 'zm_vl открытые',
    process: async (tsv) => {
      const rows = parseZmvlTsv(tsv);
      if (rows.length === 0) return 'Пустая выгрузка открытых';
      const r = await flowZmvlReconcile(api, rows, false);
      return `Открытые: ${r.received} строк · ${r.updated} обновл · ${r.inserted} нов`;
    },
  },
  zmvl: {
    actionId: 'flow_zmvl_reconcile',
    tabName: 'ZM_VL',
    actionLabel: 'Сверка zm_vl',
    process: async (tsv) => {
      const rows = parseZmvlTsv(tsv);
      if (rows.length === 0) return 'Пустая выгрузка zm_vl';
      const r = await flowZmvlReconcile(api, rows, true);
      return `Сверка: ${r.received} строк · ${r.assigned} к черновикам · ${r.updated} обновл · ${r.inserted} нов · ${r.reserved} резерв`;
    },
  },
};

/** Прогнать одно SAP-действие. Возвращает итог для UI (ошибки тоже как { ok:false, msg }). */
export async function runFlowSapAction(
  id: FlowSapActionId,
  password: string,
): Promise<{ ok: boolean; msg: string }> {
  const def = FLOW_SAP_ACTIONS[id];
  if (window.pyn?.platform !== 'win32') return { ok: false, msg: 'Только на Windows (нужен SAP)' };
  try {
    const bundle = await getMacroBundle(api, {
      actionId: def.actionId,
      password,
      tabName: def.tabName,
      actionLabel: def.actionLabel,
    });
    if (!bundle.ok) {
      return { ok: false, msg: bundle.error === 'wrong_password' ? 'Неверный пароль' : `Макрос: ${bundle.error}` };
    }
    const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource);
    if (!vbs || !vbs.ok || vbs.tsv == null) return { ok: false, msg: `SAP/VBS: ${vbs?.error ?? 'ошибка'}` };
    return { ok: true, msg: await def.process(vbs.tsv) };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError(def.actionId, m, { stack: e instanceof Error ? e.stack : undefined, context: def.actionLabel });
    return { ok: false, msg: `Ошибка: ${m.slice(0, 100)}` };
  } finally {
    await releaseSheetLock(api, def.actionId).catch(() => undefined);
  }
}
