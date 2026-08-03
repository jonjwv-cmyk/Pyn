/**
 * Режим поверхности: тёмная / «бумага» (тёплый светлый лист).
 * Хранится отдельно для notes / transport / report в localStorage.
 */
import { useSyncExternalStore } from 'react';

export type WorkspaceSurface = 'dark' | 'paper';
export type WorkspaceSurfaceSection = 'notes' | 'transport' | 'report';

const PREFIX = 'pyn.workspace-surface.';

const listeners = new Map<WorkspaceSurfaceSection, Set<() => void>>();
const cache = new Map<WorkspaceSurfaceSection, WorkspaceSurface>();

function storageKey(section: WorkspaceSurfaceSection): string {
  return `${PREFIX}${section}.v1`;
}

function read(section: WorkspaceSurfaceSection): WorkspaceSurface {
  try {
    const v = localStorage.getItem(storageKey(section));
    if (v === 'paper' || v === 'dark') return v;
  } catch {
    /* */
  }
  return 'dark';
}

function ensure(section: WorkspaceSurfaceSection): WorkspaceSurface {
  if (!cache.has(section)) cache.set(section, read(section));
  return cache.get(section)!;
}

export function getWorkspaceSurface(section: WorkspaceSurfaceSection): WorkspaceSurface {
  return ensure(section);
}

export function setWorkspaceSurface(
  section: WorkspaceSurfaceSection,
  next: WorkspaceSurface,
): void {
  if (next !== 'dark' && next !== 'paper') return;
  const prev = ensure(section);
  if (prev === next) return;
  cache.set(section, next);
  try {
    localStorage.setItem(storageKey(section), next);
  } catch {
    /* */
  }
  const set = listeners.get(section);
  if (set) {
    for (const cb of set) {
      try {
        cb();
      } catch {
        /* */
      }
    }
  }
}

export function toggleWorkspaceSurface(section: WorkspaceSurfaceSection): WorkspaceSurface {
  const next: WorkspaceSurface = ensure(section) === 'paper' ? 'dark' : 'paper';
  setWorkspaceSurface(section, next);
  return next;
}

export function subscribeWorkspaceSurface(
  section: WorkspaceSurfaceSection,
  cb: () => void,
): () => void {
  let set = listeners.get(section);
  if (!set) {
    set = new Set();
    listeners.set(section, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

export function useWorkspaceSurface(section: WorkspaceSurfaceSection): WorkspaceSurface {
  return useSyncExternalStore(
    (cb) => subscribeWorkspaceSurface(section, cb),
    () => getWorkspaceSurface(section),
    () => 'dark' as WorkspaceSurface,
  );
}
