import {
  flowScriptPress,
  getMacroBundle,
  parseMolsHtml,
  personsImportMols,
  personsMolsBackupCreate,
  personsMolsBackupRestore,
  releaseSheetLock,
  useSheetsLockStore,
} from '@pyn/core';
import { api } from '@/lib/api';
import { reportClientError } from '@/lib/error-report';
import { refreshMolFromServer } from '@/lib/mol-repo';
import { refreshPersonsFromServer } from '@/lib/persons-repo';

export const MOLS_SYNC_ACTION_ID = 'mols_sync';

async function refreshPersonsAndMol(): Promise<void> {
  await refreshPersonsFromServer({ force: true });
  await refreshMolFromServer({ force: true });
}

/** Резерв контактов + МОЛ (перед синхронизацией). */
export async function runMolsBackup(label = 'manual_desktop'): Promise<{ ok: boolean; msg: string }> {
  try {
    const b = await personsMolsBackupCreate(api, label);
    if (!b.id) return { ok: false, msg: 'Резерв не создан' };
    return {
      ok: true,
      msg: `Резерв #${b.id}: ${b.personsCount} контактов, ${b.molCount} МОЛ, ${b.warehouseLinksCount} складов`,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('mols_backup', m, { context: 'Резерв МОЛ' });
    return { ok: false, msg: `Резерв: ${m.slice(0, 100)}` };
  }
}

/** Откат к последнему резерву (контакты + МОЛ + производный блоб). */
export async function runMolsRestore(): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await personsMolsBackupRestore(api);
    await refreshPersonsAndMol();
    return {
      ok: true,
      msg: `Откат #${r.backupId}: ${r.personsCount} контактов, ${r.molCount} МОЛ (резерв ${r.backupLabel || r.backupCreatedAt})`,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('mols_restore', m, { context: 'Откат МОЛ' });
    return { ok: false, msg: `Откат: ${m.slice(0, 100)}` };
  }
}

/**
 * Синхронизация базы МОЛов: SAP Y_DVK_31000126 → HTML → persons_import_mols.
 * Путь сохранения задаётся через OTL_MACRO_OUTPUT (как у выгрузки заказов).
 */
export async function runMolsSync(password?: string): Promise<{ ok: boolean; msg: string }> {
  if (window.pyn?.platform !== 'win32') {
    return { ok: false, msg: 'Только на Windows (нужен SAP)' };
  }

  const lock = useSheetsLockStore.getState().activeLock;
  if (lock && lock.actionId !== MOLS_SYNC_ACTION_ID) {
    return { ok: false, msg: `Занято: ${lock.actionLabel} (${lock.userName})` };
  }

  const startedAt = new Date().toISOString();
  useSheetsLockStore.getState().acquire({
    actionId: MOLS_SYNC_ACTION_ID,
    actionLabel: 'База МОЛов',
    userName: 'Вы',
    tabName: '',
    lockedTabRawNames: [],
  });

  try {
    void flowScriptPress(api, 'mols').catch(() => undefined);

    const bundle = await getMacroBundle(api, {
      actionId: MOLS_SYNC_ACTION_ID,
      password,
      tabName: '',
      actionLabel: 'База МОЛов',
    });
    if (!bundle.ok) {
      return { ok: false, msg: bundle.error === 'wrong_password' ? 'Неверный пароль' : `Макрос: ${bundle.error}` };
    }

    const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource, { outputFormat: 'html' });
    if (!vbs || !vbs.ok || !vbs.html) {
      return { ok: false, msg: `SAP/VBS: ${vbs?.error ?? 'ошибка'}` };
    }

    const entries = parseMolsHtml(vbs.html);
    if (entries.length === 0) {
      return { ok: false, msg: 'Пустая выгрузка МОЛ (нет строк в HTML)' };
    }

    const r = await personsImportMols(api, entries, startedAt);
    await refreshPersonsAndMol();

    const delta = r.molAfter - r.molBefore;
    const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
    const newPart = r.newCount > 0 ? ` · +${r.newCount} новых таб.` : '';
    const tabsPart = r.newTabs.length > 0 ? ` (${r.newTabs.slice(0, 5).join(', ')}${r.newTabs.length > 5 ? '…' : ''})` : '';
    return {
      ok: true,
      msg: `МОЛы: было ${r.molBefore} → стало ${r.molAfter} (${deltaStr})${newPart}${tabsPart} · ${r.received} таб.`,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('mols_sync', m, { stack: e instanceof Error ? e.stack : undefined, context: 'База МОЛов' });
    return { ok: false, msg: `Ошибка: ${m.slice(0, 100)}` };
  } finally {
    useSheetsLockStore.getState().release(MOLS_SYNC_ACTION_ID);
    await releaseSheetLock(api, MOLS_SYNC_ACTION_ID).catch(() => undefined);
  }
}