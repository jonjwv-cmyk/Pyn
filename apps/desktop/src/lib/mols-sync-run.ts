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

/** Откат к последнему резерву (developer + пароль 01012 на сервере). */
export async function runMolsRestore(password: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await personsMolsBackupRestore(api, { password });
    await refreshPersonsAndMol();
    const from = r.versionFrom || '—';
    const to = r.versionTo || r.version || '—';
    const sec = r.durationMs ? `${Math.round(r.durationMs / 1000)} с` : '';
    return {
      ok: true,
      msg: `Откат базы контактов: ${from} → ${to}`
        + (sec ? ` · ${sec}` : '')
        + ` · ${r.personsCount} контактов, ${r.molCount} МОЛ`,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('mols_restore', m, { context: 'Откат МОЛ' });
    if (/wrong_password|403/i.test(m)) return { ok: false, msg: 'Неверный пароль отката' };
    if (/developer|forbidden/i.test(m)) return { ok: false, msg: 'Откат только для разработчика' };
    return { ok: false, msg: `Откат: ${m.slice(0, 100)}` };
  }
}

/**
 * Импорт базы МОЛ: SAP → HTML → persons_import_mols.
 * Резерв «как есть» делает UI перед вызовом (auto_before_import) — чтобы
 * «Откат» всегда имел слепок до изменений.
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
    actionLabel: 'Импорт МОЛ',
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
      actionLabel: 'Импорт МОЛ',
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

    const molDelta = r.molAfter - r.molBefore;
    const molDeltaStr = molDelta > 0 ? `+${molDelta}` : molDelta < 0 ? `${molDelta}` : '±0';
    const parts = [
      r.contactsNew > 0 ? `Контакты: +${r.contactsNew} новых` : 'Контакты: +0 новых',
      `МОЛ: было ${r.molBefore} → стало ${r.molAfter} (${molDeltaStr})`,
    ];
    const whDelta = r.whEmptyAfter - r.whEmptyBefore;
    const whDeltaStr = whDelta > 0 ? `+${whDelta}` : whDelta < 0 ? `${whDelta}` : '±0';
    let whPart = `Склады без МОЛ: было ${r.whEmptyBefore} → стало ${r.whEmptyAfter} (${whDeltaStr})`;
    if (r.whEmptyCodes.length > 0) {
      const list = r.whEmptyCodes.slice(0, 12).join(', ')
        + (r.whEmptyCodes.length > 12 ? '…' : '');
      whPart += `: ${list}`;
    }
    parts.push(whPart);

    return { ok: true, msg: parts.join(' · ') };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    reportClientError('mols_sync', m, { stack: e instanceof Error ? e.stack : undefined, context: 'Импорт МОЛ' });
    return { ok: false, msg: `Ошибка: ${m.slice(0, 100)}` };
  } finally {
    useSheetsLockStore.getState().release(MOLS_SYNC_ACTION_ID);
    await releaseSheetLock(api, MOLS_SYNC_ACTION_ID).catch(() => undefined);
  }
}
