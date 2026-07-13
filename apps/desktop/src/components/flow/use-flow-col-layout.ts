import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flowColLayoutGet, flowColLayoutSet } from '@pyn/core';
import { api } from '@/lib/api';
import {
  applyColOrder,
  parseColLayout,
  serializeColLayout,
  type FlowColLayoutState,
  type FlowGridKind,
} from './flow-col-layout';

/**
 * Per-user порядок колонок (T6): загрузка с сервера, кнопка «Перестановка»,
 * drag-reorder через onColumnMoved (только когда customOn).
 */
export function useFlowColLayout<T extends { id: string }>(
  grid: FlowGridKind,
  baseColumns: readonly T[],
): {
  customOn: boolean;
  toggleCustom: () => void;
  displayColumns: T[];
  onColumnMoved: ((start: number, end: number) => void) | undefined;
} {
  const [customOn, setCustomOn] = useState(false);
  const [colOrder, setColOrder] = useState<string[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const colOrderRef = useRef(colOrder);
  colOrderRef.current = colOrder;

  const scheduleSave = useCallback((state: FlowColLayoutState) => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flowColLayoutSet(api, grid, serializeColLayout(state)).catch(() => undefined);
    }, 600);
  }, [grid]);

  useEffect(() => {
    let alive = true;
    void flowColLayoutGet(api, grid)
      .then((res) => {
        if (!alive) return;
        const parsed = parseColLayout(res.value);
        setCustomOn(parsed.customOn);
        setColOrder(parsed.colOrder);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [grid]);

  const baseIds = useMemo(() => baseColumns.map((c) => c.id), [baseColumns]);

  const displayColumns = useMemo(() => {
    if (!customOn) return [...baseColumns];
    const order = colOrder.length ? colOrder : baseIds;
    return applyColOrder(baseColumns, order);
  }, [baseColumns, baseIds, colOrder, customOn]);

  const displayIdsRef = useRef<string[]>([]);
  displayIdsRef.current = displayColumns.map((c) => c.id);

  const toggleCustom = useCallback(() => {
    setCustomOn((prev) => {
      const next = !prev;
      const order = colOrderRef.current.length ? colOrderRef.current : baseIds;
      if (next && !colOrderRef.current.length) setColOrder(order);
      scheduleSave({ customOn: next, colOrder: order });
      return next;
    });
  }, [baseIds, scheduleSave]);

  const onColumnMoved = useCallback(
    (start: number, end: number) => {
      if (!customOn) return;
      const next = [...displayIdsRef.current];
      const [moved] = next.splice(start, 1);
      if (moved == null) return;
      next.splice(end, 0, moved);
      setColOrder(next);
      scheduleSave({ customOn: true, colOrder: next });
    },
    [customOn, scheduleSave],
  );

  return {
    customOn,
    toggleCustom,
    displayColumns,
    onColumnMoved: customOn ? onColumnMoved : undefined,
  };
}