/**
 * PYN Dashboard Kit — конструктор блоков.
 *
 *   import '@/components/pyn-dash/pyn-dash.css';
 *   import { DashShell, DashHeader, DashKpi, DashPanel, … } from '@/components/pyn-dash';
 *
 * Состав:
 *  · DashShell / DashSpanFull / DashSpanHalf — сетка
 *  · DashHeader — заголовок периода
 *  · DashKpi / DashDelta — KPI-карточки
 *  · DashPanel — chart/list/table блок
 *  · DashList / DashRow / DashEmpty / DashMolBadge
 *  · DashTrack / DashStatBar
 *  · DashLegend / DashLegLine / DashLegDot / DashLegSep
 *  · DashSegment / DashSegBtn / DashChip
 */

export { cx } from './cx';
export { DashShell, DashSpanFull, DashSpanHalf } from './DashShell';
export { DashHeader } from './DashHeader';
export { DashKpi, DashDelta } from './DashKpi';
export { DashPanel } from './DashPanel';
export { DashList, DashRow, DashEmpty, DashMolBadge } from './DashList';
export { DashTrack, DashStatBar } from './DashTrack';
export { DashLegend, DashLegLine, DashLegDot, DashLegSep } from './DashLegend';
export { DashSegment, DashSegBtn, DashChip } from './DashControls';

export type { DashShellProps } from './DashShell';
export type { DashHeaderProps } from './DashHeader';
export type { DashKpiProps, DashKpiTone, DashKpiValueSize } from './DashKpi';
export type { DashPanelProps } from './DashPanel';
export type { DashTrackTone } from './DashTrack';
