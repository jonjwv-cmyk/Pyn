import { useState } from 'react';
import { DatabaseZap, RefreshCw } from 'lucide-react';
import { flowZmvlReconcile, getMacroBundle, parseZmvlTsv, releaseSheetLock } from '@pyn/core';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';
import { api } from '@/lib/api';

/** Пароль кнопки сверки (ТЗ §5.2) — фиксирован заранее, обработка подключится позже. */
const ZMVL_PASSWORD = '7777';
const ZMVL_ACTION_ID = 'flow_zmvl_reconcile';

/**
 * «Полная выгрузка zm_vl (сверка)» (ТЗ §5.2): сервер выдаёт VBS `zmvl_full_sap`,
 * приложение запускает SAP, получает TSV из ALV-grid, парсит и шлёт в наш
 * flow_zmvl_reconcile. Google-листы в этом потоке не участвуют.
 */
export function FlowZmVlButton(): JSX.Element {
  const [pwOpen, setPwOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (password: string): Promise<void> => {
    if (busy) return;
    if (window.pyn?.platform !== 'win32') {
      setMsg('Только на Windows (нужен SAP)');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const bundle = await getMacroBundle(api, {
        actionId: ZMVL_ACTION_ID,
        password,
        tabName: 'ZM_VL',
        actionLabel: 'Сверка zm_vl',
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
      const rows = parseZmvlTsv(vbs.tsv);
      if (rows.length === 0) {
        setMsg('Пустая выгрузка zm_vl');
        return;
      }
      const r = await flowZmvlReconcile(api, rows, true);
      setMsg(
        `Сверка: ${r.received} строк · ${r.assigned} к черновикам · ${r.updated} обновл · ${r.inserted} нов · ${r.reserved} резерв`,
      );
    } catch (e) {
      setMsg(`Ошибка: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
    } finally {
      await releaseSheetLock(api, ZMVL_ACTION_ID).catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="no-drag-region max-w-[320px] truncate text-[11px] text-text-muted/80" title={msg}>
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          if (!busy) setPwOpen(true);
        }}
        disabled={busy}
        title="Полная сверочная выгрузка zm_vl: SAP → TSV → сверка поставок"
        className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:cursor-default disabled:opacity-50"
      >
        {busy ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <DatabaseZap size={13} strokeWidth={1.75} />}
        {busy ? 'Сверка…' : 'Сверка zm_vl'}
      </button>
      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel="Полная выгрузка zm_vl (сверка)"
        onSubmit={(pw) => {
          setPwOpen(false);
          if (pw !== ZMVL_PASSWORD) setMsg('Неверный пароль');
          else void run(pw);
        }}
        onCancel={() => setPwOpen(false)}
      />
    </div>
  );
}
