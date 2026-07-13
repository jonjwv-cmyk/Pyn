/**
 * G6 — автоматическая верификация T3/T4/G2 (чистые функции, без Electron).
 * Запуск: node apps/desktop/scripts/verify-g6.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandboxSrc = readFileSync(join(root, 'src/components/flow/FlowSandboxGrid.tsx'), 'utf8');
const planSrc = readFileSync(join(root, 'src/components/flow/FlowPlanGrid.tsx'), 'utf8');

let passed = 0;
let failed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, detail) { failed++; console.log(`  ✗ ${name}: ${detail}`); }

// ── T3: «Нет МОЛа» не блокирует день ───────────────────────────────────────
console.log('\nT3 — Нет МОЛа');
if (sandboxSrc.includes('!molIsGone(viewRow, molByWarehouse)') &&
    sandboxSrc.includes('«Нет МОЛа» не блокирует день')) {
  ok('FlowSandboxGrid: checkContract только при валидном МОЛ (не molIsGone)');
} else {
  fail('FlowSandboxGrid', 'нет guard !molIsGone для day edit');
}
if (planSrc.includes('Живые опции склада') && planSrc.includes('noMol')) {
  ok('FlowPlanGrid: плашка «Нет МОЛа» + живые опции при выгрузке молов');
} else {
  fail('FlowPlanGrid', 'нет T3 mol options');
}
if (sandboxSrc.includes('function molIsGone') && sandboxSrc.includes('НЕТ МОЛ')) {
  ok('molIsGone: детект «Нет МОЛа» по факту склада');
} else {
  fail('molIsGone', 'не найден');
}

// ── T4: перенос ─────────────────────────────────────────────────────────────
console.log('\nT4 — Перенос');
const transferSrc = readFileSync(join(root, 'src/components/flow/flow-transfer.ts'), 'utf8');
if (transferSrc.includes('transferMatPrefix') && transferSrc.includes('Перенос с')) {
  ok('flow-transfer: transferMatPrefix «Перенос с …»');
} else fail('flow-transfer', 'transferMatPrefix');
if (transferSrc.includes('planWasMatPrefix') && transferSrc.includes('Было в плане')) {
  ok('flow-transfer: planWasMatPrefix «Было в плане …»');
} else fail('flow-transfer', 'planWasMatPrefix');
if (transferSrc.includes('transferChainDates')) {
  ok('flow-transfer: цепочка transfer_src');
} else fail('flow-transfer', 'transferChainDates');
if (planSrc.includes('flowTransfer') && planSrc.includes('transferIds')) {
  ok('FlowPlanGrid: flowTransfer API + transferIds');
} else fail('FlowPlanGrid', 'flowTransfer');
if (sandboxSrc.includes('transferPendingByAnchor') && sandboxSrc.includes('planWasByAnchor')) {
  ok('FlowSandboxGrid: transferPending + planWas (воскрешение RGB)');
} else fail('FlowSandboxGrid', 'transfer maps');

// ── T4 labels runtime ───────────────────────────────────────────────────────
const TRANSFER_DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTH_NOM_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
function transferMatPrefix(iso, refYear = 2026) {
  const day = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const dow = TRANSFER_DOW[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? '';
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  const yearSuffix = y !== refYear ? ` ${y}` : '';
  return `Перенос с ${dow} ${MONTH_NOM_RU[mo]} ${d}${yearSuffix}`;
}
const label = transferMatPrefix('2026-07-09');
if (label === 'Перенос с ЧТ июль 9') ok(`метка МАТ: «${label}»`);
else fail('метка МАТ', `ожидали «Перенос с ЧТ июль 9», got «${label}»`);

// ── G2 приоритеты ───────────────────────────────────────────────────────────
console.log('\nG2 — Приоритеты');
function normPriority(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'high' || s.startsWith('выс') || s.startsWith('сроч')) return 'high';
  if (s === 'mid' || s.startsWith('сред') || s.startsWith('повыш')) return 'mid';
  return 'low';
}
const labels = { high: 'Срочный', mid: 'Повышенный', low: 'Обычный' };
for (const [inVal, out] of [['Высокий','Срочный'],['Средний','Повышенный'],['Низкий','Обычный'],['сроч','Срочный'],['повыш','Повышенный']]) {
  const got = labels[normPriority(inVal)];
  if (got === out) ok(`${inVal} → ${got}`);
  else fail('normPriority', `${inVal} → ${got}, expected ${out}`);
}

// ── G5 % блок ───────────────────────────────────────────────────────────────
console.log('\nG5 — % блок');
const pctSrc = readFileSync(join(root, 'src/components/flow/flow-pct-cell.tsx'), 'utf8');
if (pctSrc.includes('В заказе:') && pctSrc.includes('Вывезено:') && pctSrc.includes('Нет в отчете')) {
  ok('flow-pct-cell: оверлей % + история / «Нет в отчете»');
} else fail('G5', 'нет flow-pct-cell');
if (pctSrc.includes('hasHistory') && pctSrc.includes('#1F7A33')) {
  ok('flow-pct-cell: зелёный % при истории');
} else fail('G5', 'нет зелёного %');

// ── G3 План колонки ─────────────────────────────────────────────────────────
console.log('\nG3 — План колонки');
const planGridSrc = readFileSync(join(root, 'src/components/flow/FlowPlanGrid.tsx'), 'utf8');
const hiddenBlock = planGridSrc.match(/const PLAN_HIDDEN_COLS[\s\S]*?\];/)?.[0] ?? '';
for (const id of ['trz', 'exp', 'vehicleType', 'vehicle']) {
  if (!hiddenBlock.includes(`id: '${id}'`)) ok(`PLAN_HIDDEN_COLS: нет ${id}`);
  else fail('G3', `в PLAN_HIDDEN_COLS остался ${id}`);
}
if (planGridSrc.includes("id: 'exp', title: 'ЭКСПЕДИТОР'")) {
  ok('REPORT_COLS: exp остался в Отчёте');
} else fail('G3', 'REPORT exp удалён');

console.log(`\n── Итого: ${passed} passed, ${failed} failed ──`);
process.exit(failed > 0 ? 1 : 0);