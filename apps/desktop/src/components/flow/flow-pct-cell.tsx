import { useEffect, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import type { FlowDeliveryRow } from '@pyn/core';
import { flowDeliveryEventsGet } from '@pyn/core';
import { api } from '@/lib/api';
import { fmtNum3, fmtPct, livePct } from './flow-sandbox.fixtures';
import { useFlipUpIfClipped } from './flow-cell-flip';

/** Ячейка «%»: двойной клик → оверлей как у MAT (разбор вывоза + история отчёта снизу). */
export interface FlowPctData {
  readonly kind: 'flow-pct';
  readonly label: string;
  readonly hasHistory: boolean;
  readonly ord: string;
  readonly it: string;
  readonly qty: number | null;
  readonly chg: number | null;
  readonly uom: string;
}
export type FlowPctCell = CustomCell<FlowPctData>;

const PCT_GREEN = '#1F7A33';

function episodeIsReal(e: FlowDeliveryRow): boolean {
  return !!(
    String(e.dlv ?? '').trim() ||
    String(e.done_stat ?? '').trim() ||
    e.fact_qty != null ||
    Number(e.fixation_id) > 0
  );
}

function statusText(doneStat: string, failReason: string): string {
  const d = (doneStat || '').trim();
  if (d === 'выполнено' || d === 'увезли') return 'увезено';
  if (d === 'не увезли') return failReason ? `не увезли · ${failReason}` : 'не увезли';
  return failReason ? `не увезли · ${failReason}` : 'ожидание';
}

function fmtEpisodeDate(iso: string): string {
  const d = (iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return '';
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${parseInt(m[3] ?? '1', 10)} ${months[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

function FlowPctEditor({ value: cell }: { value: FlowPctCell }) {
  const { ord, it, qty, chg, uom, hasHistory } = cell.data;
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  const [loading, setLoading] = useState(false);
  const [episodes, setEpisodes] = useState<FlowDeliveryRow[]>([]);

  useEffect(() => {
    if (!hasHistory || !ord) {
      setEpisodes([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    flowDeliveryEventsGet(api, ord, it)
      .then((d) => {
        if (!alive) return;
        const eps = (d.episodes ?? [])
          .filter(episodeIsReal)
          .sort((a, b) => (b.plan_date || '').localeCompare(a.plan_date || ''));
        setEpisodes(eps);
      })
      .catch(() => { if (alive) setEpisodes([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ord, it, hasHistory]);

  const pct = livePct({ qty, chg });
  const shipped = chg != null && qty != null ? chg - qty : null;
  const uomSfx = uom ? ` ${uom}` : '';

  return (
    <div
      ref={flipRef}
      className="flex max-h-[60vh] min-w-[280px] max-w-[70vw] flex-col gap-0.5 overflow-y-auto p-2 text-[12px] leading-relaxed text-text-secondary"
    >
      {chg != null && qty != null ? (
        <>
          <div className="text-text-secondary">
            В заказе: {fmtNum3(chg)}
            {uomSfx}
          </div>
          <div className="text-text-secondary">
            Вывезено: {fmtNum3(shipped ?? 0)}
            {uomSfx}
            {pct != null && <> · {fmtPct(pct)}</>}
          </div>
        </>
      ) : (
        <div className="text-text-muted/70">Нет данных</div>
      )}

      <div className="my-1.5 border-t border-white/10" />

      {loading && <div className="text-text-muted/70">Загрузка…</div>}
      {!loading && (!hasHistory || episodes.length === 0) && (
        <div className="text-text-muted/80">Нет в отчете</div>
      )}
      {!loading &&
        episodes.map((e) => {
          const dlv = (e.dlv || '').trim();
          const pos = (e.dlv_pos || '').trim();
          const dlvTxt = dlv ? `поставка ${dlv}${pos ? `/${pos}` : ''}` : 'черновик';
          const date = e.plan_date ? fmtEpisodeDate(e.plan_date) : '';
          const qtyTxt = e.qty != null ? `${fmtNum3(e.qty)} ${e.uom || ''}`.trim() : '';
          const parts = [statusText(e.done_stat, e.fail_reason), dlvTxt, date, qtyTxt].filter(Boolean);
          return (
            <div key={e.id} className="text-text-muted/90">
              {parts.join(' · ')}
            </div>
          );
        })}
    </div>
  );
}

export const flowPctRenderer: CustomRenderer<FlowPctCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowPctCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-pct',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { label, hasHistory } = cell.data;
    if (!label) return true;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `700 ${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hasHistory ? PCT_GREEN : theme.textDark;
    ctx.fillText(label, rect.x + theme.cellHorizontalPadding, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowPctEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(217,119,87,0.40)',
      borderRadius: '12px',
      boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
      padding: '4px',
    },
  }),
};