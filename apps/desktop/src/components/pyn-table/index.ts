/**
 * PYN Table — переиспользуемый слой темы/форматтеров для Tabulator (и будущих sheet'ов).
 *
 * Подключение:
 *   import { pynStatusBadgeHtml, type PynTableTheme } from '@/components/pyn-table';
 *   import '@/components/pyn-table/pyn-table-theme.css';
 *
 *   <div className="pyn-table-root" data-pyn-table-theme="grok">…</div>
 */

export type PynTableTheme = 'classic' | 'grok';

export {
  pynStatusBadgeHtml,
  pynMonoHtml,
  statusKind,
  escapeHtml,
  TRANSPORT_STATUS_KIND,
  type PynStatusKind,
} from './formatters';
