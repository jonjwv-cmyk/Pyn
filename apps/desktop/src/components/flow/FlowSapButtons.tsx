import { useState } from 'react';
import { FileText, Inbox, RefreshCw } from 'lucide-react';
import {
  flowSedReconcile,
  flowZmvlReconcile,
  getMacroBundle,
  parseSedTsv,
  parseZmvlTsv,
  releaseSheetLock,
} from '@pyn/core';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';
import { api } from '@/lib/api';
import { reportClientError } from '@/lib/error-report';

const PASSWORD = '7777';

/**
 * SAP-кнопки актуализации (ТЗ HANDOFF_2026-06-15_sed_zmvl_otif5):
 *  • «Выгрузка СЭД» (ZM_EDM_DOCS) → движение документа (подписан/на ком) в `flow_sed_reconcile`.
 *  • «zm_vl открытые» → незакрытые поставки (`sap_open`), reconcile full=false.
 * Макрос тянется с сервера (server-tunable; новый EXE для правок макроса не нужен). Только Windows.
 */
function useSapRun(
  actionId: string,
  tabName: string,
  actionLabel: string,
  process: (tsv: string) => Promise<string>,
) {
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
      const bundle = await getMacroBundle(api, { actionId, password, tabName, actionLabel });
      if (!bundle.ok) {
        setMsg(bundle.error === 'wrong_password' ? 'Неверный пароль' : `Макрос: ${bundle.error}`);
        return;
      }
      const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource);
      if (!vbs || !vbs.ok || vbs.tsv == null) {
        setMsg(`SAP/VBS: ${vbs?.error ?? 'ошибка'}`);
        return;
      }
      setMsg(await process(vbs.tsv));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(`Ошибка: ${m.slice(0, 100)}`);
      reportClientError(actionId, m, { stack: e instanceof Error ? e.stack : undefined, context: actionLabel });
    } finally {
      await releaseSheetLock(api, actionId).catch(() => undefined);
      setBusy(false);
    }
  };
  return { pwOpen, setPwOpen, busy, msg, setMsg, run };
}

function SapButton({
  state, label, busyLabel, title, Icon,
}: {
  state: ReturnType<typeof useSapRun>;
  label: string;
  busyLabel: string;
  title: string;
  Icon: typeof FileText;
}): JSX.Element {
  const { pwOpen, setPwOpen, busy, msg, setMsg, run } = state;
  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="no-drag-region max-w-[280px] truncate text-[11px] text-text-muted/80" title={msg}>
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={() => { if (!busy) setPwOpen(true); }}
        disabled={busy}
        title={title}
        className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:cursor-default disabled:opacity-50"
      >
        {busy ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Icon size={13} strokeWidth={1.75} />}
        {busy ? busyLabel : label}
      </button>
      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel={title}
        onSubmit={(pw) => { setPwOpen(false); if (pw !== PASSWORD) setMsg('Неверный пароль'); else void state.run(pw); }}
        onCancel={() => setPwOpen(false)}
      />
    </div>
  );
}

export function FlowSedButton(): JSX.Element {
  const state = useSapRun('flow_sed_reconcile', 'СЭД', 'Выгрузка СЭД', async (tsv) => {
    const rows = parseSedTsv(tsv);
    if (rows.length === 0) return 'Пустая выгрузка СЭД';
    const r = await flowSedReconcile(api, rows);
    return `СЭД: ${r.received} строк · ${r.docs} поставок · ${r.updated} обновл · ${r.events} событий`;
  });
  return <SapButton state={state} label="Выгрузка СЭД" busyLabel="СЭД…" title="Выгрузка СЭД (движение документа)" Icon={FileText} />;
}

export function FlowZmvlOpenButton(): JSX.Element {
  const state = useSapRun('flow_zmvl_open', 'ZM_VL', 'zm_vl открытые', async (tsv) => {
    const rows = parseZmvlTsv(tsv);
    if (rows.length === 0) return 'Пустая выгрузка открытых';
    const r = await flowZmvlReconcile(api, rows, false);
    return `Открытые: ${r.received} строк · ${r.updated} обновл · ${r.inserted} нов`;
  });
  return <SapButton state={state} label="zm_vl открытые" busyLabel="Открытые…" title="zm_vl открытые (незакрытые поставки)" Icon={Inbox} />;
}
