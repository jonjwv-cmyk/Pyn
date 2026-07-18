/**
 * flow-live-value — крошечный внешний стор для «горячих» значений грида
 * (выделение, hover-подсказка): они меняются на каждый tick мыши и потому НЕ
 * должны жить в state листа-монолита — иначе каждый tick ре-рендерит весь
 * компонент (корень лага, разобран в FlowGridEditor). Подписчики — мелкие
 * компоненты (статус-бар выделения, тултип): ре-рендерятся только они, лист
 * остаётся неподвижным.
 */
import { useSyncExternalStore } from 'react';

export interface LiveValue<T> {
  get(): T;
  set(v: T): void;
  subscribe(fn: () => void): () => void;
}

export function createLiveValue<T>(initial: T): LiveValue<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      if (Object.is(v, value)) return;
      value = v;
      for (const fn of listeners) fn();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Подписка компонента на LiveValue (useSyncExternalStore). */
export function useLiveValue<T>(lv: LiveValue<T>): T {
  return useSyncExternalStore(lv.subscribe, lv.get, lv.get);
}
