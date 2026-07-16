/**
 * Парсер HTML-выгрузки SAP «молы-договора» (Y_DVK_31000126).
 * Логика 1:1 с Google-скриптом wf_import (колонки A..E).
 */

export interface MolsHtmlWarehouse {
  code: string;
  until: string;
  /** Исторический МОЛ — склад без нового назначения в выгрузке. */
  isWas?: boolean;
}

export interface MolsHtmlEntry {
  tab: string;
  position: string;
  warehouses: MolsHtmlWarehouse[];
}

export interface MolsHtmlStats {
  htmlRows: number;
  skippedNoTab: number;
  skippedInvalidDate: number;
  skippedExpired: number;
  uniqueTabs: number;
  molOnly: number;
  withWarehouses: number;
  totalWarehouseLinks: number;
  sampleTabs: string[];
}

type ContractInfo =
  | { type: 'INVALID' }
  | { type: 'INFINITE' }
  | { type: 'TERM'; key: number; display: string };

interface WhState {
  hasInfinite: boolean;
  maxTermKey: number | null;
  maxTermDisplay: string | null;
}

interface TabGroup {
  warehouses: Map<string, WhState>;
  hasInfiniteForMol: boolean;
  maxTermKeyForMol: number | null;
  maxTermDisplayForMol: string | null;
  hasPlant1000: boolean;
  hasEmptyPlant: boolean;
}

function cleanCell(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseTextDateParts(text: string): { d: number; m: number; y: number } | null {
  const m = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (!m) return null;
  const d = parseInt(m[1] ?? '', 10);
  const mo = parseInt(m[2] ?? '', 10);
  const y = parseInt(m[3] ?? '', 10);
  if (Number.isNaN(d) || Number.isNaN(mo) || Number.isNaN(y)) return null;
  return { d, m: mo, y };
}

function getContractInfo(dateText: string): ContractInfo {
  const t = dateText.trim();
  if (!t) return { type: 'INVALID' };

  const parts = parseTextDateParts(t);
  let d: number;
  let m: number;
  let y: number;
  let display: string;

  if (parts) {
    d = parts.d;
    m = parts.m;
    y = parts.y;
    display = `${pad2(d)}.${pad2(m)}.${y}`;
  } else {
    const yMatch = t.match(/(\d{4})/);
    if (!yMatch) return { type: 'INVALID' };
    y = parseInt(yMatch[1] ?? '', 10);
    d = 31;
    m = 12;
    display = `${pad2(d)}.${pad2(m)}.${y}`;
  }

  if (y % 100 === 99) return { type: 'INFINITE' };
  const key = y * 10000 + m * 100 + d;
  return { type: 'TERM', key, display };
}

function todayKey(now = new Date()): number {
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function splitTokens(raw: string): string[] {
  const s = cleanCell(raw);
  return s ? s.split(/\s+/).map((x) => x.trim()).filter(Boolean) : [];
}

function compareWarehouseCode(a: string, b: string): number {
  const an = /^(\d+)/.exec(a)?.[1];
  const bn = /^(\d+)/.exec(b)?.[1];
  if (an && bn && an !== bn) return parseInt(an, 10) - parseInt(bn, 10);
  if (an && !bn) return -1;
  if (!an && bn) return 1;
  return a.localeCompare(b, 'ru');
}

function whUntilFromState(w: WhState): string {
  if (w.hasInfinite) return '';
  if (w.maxTermKey != null && w.maxTermDisplay) return w.maxTermDisplay;
  return '';
}

interface RawMolsRow {
  date: string;
  plants: string;
  tab: string;
  position: string;
  wh: string;
}

/** Извлечь строки данных из HTML (колонки A..E). */
export function extractMolsHtmlRows(html: string): RawMolsRow[] {
  const out: RawMolsRow[] = [];
  const rowRe = /<tr\b[^>]*>\s*<td\b[^>]*background\s*:\s*#eef9ff[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [...rowMatch[0].matchAll(/<nobr\b[^>]*>([\s\S]*?)<\/nobr>/gi)]
      .map((m) => cleanCell(m[1] ?? ''));
    if (cells.length < 5) continue;
    out.push({
      date: cells[0] ?? '',
      plants: cells[1] ?? '',
      tab: cells[2] ?? '',
      position: cells[3] ?? '',
      wh: cells[4] ?? '',
    });
  }
  return out;
}

/**
 * Код склада в выгрузке: 4 знака — 3 цифры + цифра/буква (кир/лат).
 * Примеры: `8024`, `824Т`, `824Ц`, `824T`. Только `\d{4}` отбрасывал буквенные
 * склады → ложное «нет МОЛа» на 824Т/824Ц.
 */
const MOL_WAREHOUSE_CODE = /^\d{3}[\dA-Za-zА-Яа-яёЁ]$/;

/**
 * Сгруппировать строки HTML по табельному → записи для persons_import_mols.
 * Логика как в Google-скрипте: завод 1000, склады 4-значные (цифры/буква),
 * фильтр истёкших договоров. Т-пары (824Т↔8024) — разные склады, не сливать.
 */
export function parseMolsHtml(html: string, now = new Date()): MolsHtmlEntry[] {
  const { entries } = buildMolsFromRows(extractMolsHtmlRows(html), now);
  return entries;
}

/** Dry-run: парсинг + статистика без записи в БД. */
export function parseMolsHtmlWithStats(html: string, now = new Date()): {
  entries: MolsHtmlEntry[];
  stats: MolsHtmlStats;
} {
  return buildMolsFromRows(extractMolsHtmlRows(html), now);
}

function buildMolsFromRows(rows: RawMolsRow[], now: Date): {
  entries: MolsHtmlEntry[];
  stats: MolsHtmlStats;
} {
  const tKey = todayKey(now);
  const latestPosByTab = new Map<string, string>();
  const groups = new Map<string, TabGroup>();

  let skippedNoTab = 0;
  let skippedInvalidDate = 0;
  let skippedExpired = 0;

  for (const row of rows) {
    const tab = row.tab.trim();
    if (!tab) {
      skippedNoTab++;
      continue;
    }

    const pos = row.position.trim();
    if (pos) latestPosByTab.set(tab, pos);

    const contractInfo = getContractInfo(row.date);
    if (contractInfo.type === 'INVALID') {
      skippedInvalidDate++;
      continue;
    }
    if (contractInfo.type === 'TERM' && contractInfo.key <= tKey) {
      skippedExpired++;
      continue;
    }

    const plants = splitTokens(row.plants);
    const whs = splitTokens(row.wh);
    const rowHasAnyPlant = plants.length > 0;
    let rowHasPlant1000 = false;
    for (const p of plants) {
      if (p === '1000') {
        rowHasPlant1000 = true;
        break;
      }
    }
    const rowEligibleForMol = !rowHasAnyPlant || rowHasPlant1000;

    let g = groups.get(tab);
    if (!g) {
      g = {
        warehouses: new Map(),
        hasInfiniteForMol: false,
        maxTermKeyForMol: null,
        maxTermDisplayForMol: null,
        hasPlant1000: false,
        hasEmptyPlant: false,
      };
      groups.set(tab, g);
    }

    if (rowHasPlant1000) g.hasPlant1000 = true;
    if (!rowHasAnyPlant) g.hasEmptyPlant = true;

    if (rowEligibleForMol) {
      if (contractInfo.type === 'INFINITE') {
        g.hasInfiniteForMol = true;
      } else if (contractInfo.type === 'TERM') {
        if (g.maxTermKeyForMol === null || contractInfo.key > g.maxTermKeyForMol) {
          g.maxTermKeyForMol = contractInfo.key;
          g.maxTermDisplayForMol = contractInfo.display;
        }
      }
    }

    for (let i = 0; i < plants.length; i++) {
      if (plants[i] !== '1000') continue;
      const code = (i < whs.length ? (whs[i] ?? '') : '').trim();
      if (!code || !MOL_WAREHOUSE_CODE.test(code)) continue;

      let w = g.warehouses.get(code);
      if (!w) {
        w = { hasInfinite: false, maxTermKey: null, maxTermDisplay: null };
        g.warehouses.set(code, w);
      }
      if (contractInfo.type === 'INFINITE') {
        w.hasInfinite = true;
      } else if (contractInfo.type === 'TERM' && !w.hasInfinite) {
        if (w.maxTermKey === null || contractInfo.key > w.maxTermKey) {
          w.maxTermKey = contractInfo.key;
          w.maxTermDisplay = contractInfo.display;
        }
      }
    }
  }

  const entries: MolsHtmlEntry[] = [];
  let molOnly = 0;
  let withWarehouses = 0;
  let totalWarehouseLinks = 0;

  for (const [tab, g] of groups) {
    const position = latestPosByTab.get(tab) ?? '';
    const whCodes = [...g.warehouses.keys()].sort(compareWarehouseCode);

    if (whCodes.length > 0) {
      const warehouses = whCodes.map((code) => {
        const w = g.warehouses.get(code)!;
        return { code, until: whUntilFromState(w) };
      });
      withWarehouses++;
      totalWarehouseLinks += warehouses.length;
      entries.push({ tab, position, warehouses });
      continue;
    }

    const canWriteMol = g.hasEmptyPlant || g.hasPlant1000;
    if (!canWriteMol) continue;

    molOnly++;
    entries.push({ tab, position, warehouses: [] });
  }

  entries.sort((a, b) => a.tab.localeCompare(b.tab, 'ru', { numeric: true }));

  const uniqueTabs = groups.size;
  return {
    entries,
    stats: {
      htmlRows: rows.length,
      skippedNoTab,
      skippedInvalidDate,
      skippedExpired,
      uniqueTabs,
      molOnly,
      withWarehouses,
      totalWarehouseLinks,
      sampleTabs: entries.slice(0, 8).map((e) => e.tab),
    },
  };
}
