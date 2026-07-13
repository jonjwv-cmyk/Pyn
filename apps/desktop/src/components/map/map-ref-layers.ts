/**
 * СПРАВОЧНЫЕ слои карты (ТЗ 2026-07-09, «как на Яндексе»): ж/д пути, контуры
 * зданий (фиолет) и пешеходные дорожки/переходы по зоне ЕВРАЗ НТМК.
 *
 * Источник — СЕРВЕРНЫЙ кэш (`map_ref_get`): воркер сам тянет OSM/Overpass,
 * хранит в D1 и обновляет раз в 12 МЕСЯЦЕВ — «данные уже у нас на серваке».
 * Клиент дополнительно держит локальный кэш (`flow-map-ref`), чтобы слои
 * вставали мгновенно, и раз в 12 часов освежает их с нашего сервера (быстрый
 * запрос из D1, Overpass при этом не дёргается).
 */

import { mapRefGet } from '@pyn/core';
import { api } from '@/lib/api';
import type { BuildingOutline, ExternalRailway, FootwayLine, LatLng } from './map-types';

const CACHE_NAME = 'flow-map-ref';
const REFRESH_MS = 12 * 3600 * 1000; // перечитать с НАШЕГО сервера раз в 12 часов
const CHECK_MS = 60 * 60 * 1000;     // проверка возраста раз в час, пока карта открыта

export interface MapRefLayers {
  /** Когда клиент забирал с сервера (Date.now()). */
  at: number;
  railways: ExternalRailway[];
  buildings: BuildingOutline[];
  footways: FootwayLine[];
}

const EMPTY_REF: MapRefLayers = { at: 0, railways: [], buildings: [], footways: [] };

let current: MapRefLayers = EMPTY_REF;
let refreshing = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(layers: MapRefLayers) => void>();

export function getRefLayers(): MapRefLayers {
  return current;
}

export function subscribeRefLayers(cb: (layers: MapRefLayers) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb(current);
}

function isLatLng(v: unknown): v is LatLng {
  return !!v && typeof v === 'object'
    && typeof (v as LatLng).lat === 'number' && typeof (v as LatLng).lng === 'number';
}

function lineVertices(raw: unknown): LatLng[] {
  return Array.isArray(raw) ? raw.filter(isLatLng) : [];
}

function normalizeLines(raw: unknown): ExternalRailway[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const r = item as { id?: unknown; name?: unknown; vertices?: unknown };
    const vertices = lineVertices(r.vertices);
    if (vertices.length < 2) return [];
    return [{
      id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
      name: typeof r.name === 'string' ? r.name : '',
      vertices,
    }];
  });
}

function normalizeBuildings(raw: unknown): BuildingOutline[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const r = item as { id?: unknown; vertices?: unknown };
    const vertices = lineVertices(r.vertices);
    if (vertices.length < 3) return [];
    return [{ id: typeof r.id === 'string' ? r.id : crypto.randomUUID(), vertices }];
  });
}

function normalizeFootways(raw: unknown): FootwayLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const r = item as { id?: unknown; crossing?: unknown; vertices?: unknown };
    const vertices = lineVertices(r.vertices);
    if (vertices.length < 2) return [];
    return [{
      id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
      crossing: Number(r.crossing) === 1 || r.crossing === true,
      vertices,
    }];
  });
}

async function loadFromCache(): Promise<void> {
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<MapRefLayers>;
    current = {
      at: typeof parsed.at === 'number' ? parsed.at : 0,
      railways: normalizeLines(parsed.railways),
      buildings: normalizeBuildings(parsed.buildings),
      footways: normalizeFootways(parsed.footways),
    };
    notify();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map-ref] cache load failed:', err);
  }
}

async function refreshFromServer(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const wire = await mapRefGet(api);
    const railways = normalizeLines(wire.railways);
    const buildings = normalizeBuildings(wire.buildings);
    const footways = normalizeFootways(wire.footways);
    // Пустой слой при уже имеющихся данных — не затираем (сбой на сервере).
    const next: MapRefLayers = {
      at: Date.now(),
      railways: railways.length > 0 ? railways : current.railways,
      buildings: buildings.length > 0 ? buildings : current.buildings,
      footways: footways.length > 0 ? footways : current.footways,
    };
    current = next;
    notify();
    try {
      await window.pyn?.cache?.save(CACHE_NAME, JSON.stringify(next));
    } catch { /* кэш не критичен */ }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map-ref] server refresh failed:', err);
  } finally {
    refreshing = false;
  }
}

/** Кэш мгновенно → при устаревании (12ч) обновление с нашего сервера фоном. */
export async function initRefLayers(): Promise<void> {
  if (!timer) {
    timer = setInterval(() => {
      if (Date.now() - current.at > REFRESH_MS) void refreshFromServer();
    }, CHECK_MS);
  }
  if (current.at === 0) await loadFromCache();
  if (Date.now() - current.at > REFRESH_MS) void refreshFromServer();
}
