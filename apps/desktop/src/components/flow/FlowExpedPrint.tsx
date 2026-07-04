import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import type { ExpedGroup } from './flow-export-xlsx';

/**
 * Печать «Экспедиторам» ИЗ ПРИЛОЖЕНИЯ (юзер 2026-07-04: «можем и скачать, а можем как
 * машины Транспорт напечатать»). Превью как у Транспорта: реальный лист → «Печать»
 * (системный диалог) или «PDF» через print-bridge. Раскидка по МАШИНАМ (гаражный ID):
 * каждая машина со своей страницы (разрыв), шапка машины тонирована её цветом/заливкой,
 * группы складов (отправитель, получатель; Т-пары слиты) разделены заметной линией.
 */
export function FlowExpedPrint({
  title,
  groups,
  onClose,
}: {
  /** «июль 6, 2026» — для заголовка/имени файла. */
  title: string;
  groups: ExpedGroup[];
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const fmtN = (n: number | null, dec: number): string =>
    n == null || !Number.isFinite(n) || n === 0
      ? ''
      : n.toLocaleString('ru-RU', { maximumFractionDigits: dec }).replace(/ | /g, ' ');

  const run = async (mode: 'dialog' | 'save'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    document.body.classList.add('tr-printing');
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const name = `Экспедиторам на ${title}`.slice(0, 80);
      const pyn = window.pyn?.print;
      if (pyn) {
        const res = mode === 'save' ? await pyn.savePdf(name) : await pyn.dialog(name);
        if (!res?.ok && res?.error) setMsg(`Печать: ${res.error}`);
      } else {
        window.print();
      }
    } catch (e) {
      setMsg(`Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    } finally {
      document.body.classList.remove('tr-printing');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="tr-print-overlay">
      <style>{`
        .tr-print-overlay {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
        }
        .tr-print-frame {
          display: flex; flex-direction: column; gap: 8px;
          max-height: 92vh; width: min(980px, 94vw);
        }
        .tr-print-sheet {
          background: #fff; color: #111; border-radius: 6px;
          padding: 18px 20px; overflow: auto;
          font-family: 'Inter Variable', system-ui, sans-serif;
        }
        .tr-print-sheet h1 { font-size: 15px; margin: 0 0 8px; }
        .tr-print-sheet table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: auto; }
        .tr-print-sheet th, .tr-print-sheet td {
          border: 0.5px solid #999; padding: 3px 5px; text-align: left; vertical-align: middle;
          white-space: nowrap; line-height: 1.25;
        }
        .tr-print-sheet th { background: #EFEDE8; font-weight: 600; font-size: 10px; }
        .tr-print-sheet td.ep-mat { white-space: normal; width: 100%; min-width: 200px; overflow-wrap: break-word; }
        .tr-print-sheet td.ep-note { white-space: normal; min-width: 110px; max-width: 190px; overflow-wrap: break-word; }
        .tr-print-sheet td.ep-num { text-align: right; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .ep-mhead td {
          font-weight: 700; font-size: 11px; padding: 5px 6px; border-top: 2px solid #444;
        }
        /* Разделитель групп складов (отправитель, получатель; Т-пары слиты) — заметная линия. */
        .tr-print-sheet tr.ep-grp td { border-top: 2px solid #8A8F98; }
        @media print {
          body.tr-printing #root { display: none !important; }
          .tr-print-overlay { position: static; background: none; display: block; }
          .tr-print-frame { max-height: none; width: auto; }
          .tr-print-sheet { border-radius: 0; padding: 0; overflow: visible;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .tr-noprint { display: none !important; }
          .tr-print-sheet tr { break-inside: avoid; }
          /* Каждая машина — со своей страницы (кроме первой). */
          .tr-print-sheet tr.ep-break { break-before: page; }
        }
      `}</style>
      <div className="tr-print-frame">
        <div className="tr-noprint flex items-center gap-2 text-[12px] text-white">
          <span className="font-medium">Предпросмотр · Экспедиторам на {title}</span>
          {msg && <span className="text-white/70">{msg}</span>}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('dialog')}
              className="flex h-7 items-center gap-1.5 rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Printer size={13} strokeWidth={1.75} />
              Печать
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('save')}
              className="flex h-7 items-center rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/30 transition-colors hover:bg-white/10"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </span>
        </div>
        <div className="tr-print-sheet">
          <h1>Экспедиторам на {title}</h1>
          <table>
            <thead>
              <tr>
                <th>От</th><th>СП</th><th>CLST</th><th>Поставка</th><th>МОЛ</th><th>Ном №</th>
                <th>Материал</th><th>ЕИ</th><th>Кол-во</th><th>КГ</th><th>V</th><th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const line1 = g.garage
                  ? ['гр. №', g.garage, g.vehicleType, g.expeditors].filter(Boolean).join('   ')
                  : 'Без машины';
                const tone = g.fillArgb ? `#${g.fillArgb.slice(-6)}` : '#F3F1EC';
                return (
                  <Fragment key={`${g.garage}|${gi}`}>
                    <tr className={`ep-mhead${gi > 0 ? ' ep-break' : ''}`}>
                      <td colSpan={12} style={{ background: tone }}>
                        {line1}
                        <span style={{ fontWeight: 400 }}> · От: {g.frList} · СП: {g.toList}</span>
                      </td>
                    </tr>
                    {g.items.map((it, ii) => (
                      <tr key={ii} className={it.topBorder ? 'ep-grp' : undefined}>
                        <td>{it.fr}</td>
                        <td>{it.to_wh}</td>
                        <td>{it.clst}</td>
                        <td>{it.dlvs.map((d, di) => <div key={di}>{d}</div>)}</td>
                        <td>{it.mol}</td>
                        <td>{it.no_num}</td>
                        <td className="ep-mat" title={it.matNote || undefined}>{it.mat}</td>
                        <td>{it.uom}</td>
                        <td className="ep-num">{fmtN(it.qty, 3)}</td>
                        <td className="ep-num">{fmtN(it.kg, 2)}</td>
                        <td className="ep-num">{fmtN(it.v, 2)}</td>
                        <td className="ep-note">{it.note}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
