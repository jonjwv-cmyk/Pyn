import { createZustandStore as create } from '@pyn/core';

/**
 * Состояние раздела «Глонасс» (спутниковый мониторинг транспорта на карте).
 * Данные тянет главный процесс через VPS-мост (`window.pyn.glonass`); здесь —
 * только UI-состояние: парк, выбранные машины, live-позиции и слои истории.
 *
 * Машины НЕ показываем все скопом: пользователь ищет/выбирает нужные из списка.
 */

export type GlonassVehicle = {
  id: number;
  guid: string;
  name: string;   // "(1034) Т300КН 96"
  garage: string; // "1034"
  gos: string;    // "Т300КН 96"
  imei: string;
  status: number;
};

export type GlonassPosition = {
  id: number;
  lat: number;
  lng: number;
  speed: number | null;
  course: number | null;
  ign: boolean | null; // зажигание (для статуса остановка/стоянка)
  time: string | null;
};

export type GlonassHistoryPoint = {
  lat: number;
  lng: number;
  speed: number | null;
  time: string;
};

export type GlonassHistorySegment = {
  id: string;
  vehicleId: number;
  vehicleLabel: string;
  points: GlonassHistoryPoint[];
};

export type GlonassHistoryLayerKind = 'replay' | 'yearRoads';

export type GlonassHistoryLayer = {
  id: string;
  kind: GlonassHistoryLayerKind;
  title: string;
  subtitle: string;
  color: string;
  visible: boolean;
  from: string;
  to: string;
  vehicleId: number | null;
  vehicleLabel: string;
  segments: GlonassHistorySegment[];
  pointCount: number;
  createdAt: number;
};

export type GlonassHistoryLoading = {
  kind: GlonassHistoryLayerKind;
  layerId: string | null;
  label: string;
  done: number;
  total: number;
  failed?: number;
};

/** Готовая к отрисовке точка машины на карте (позиция + подпись + статус). */
export type GlonassMarker = {
  id: number;
  garage: string;
  gos: string;
  lat: number;
  lng: number;
  course: number | null;
  speed: number | null;
  status: GlonassStatus;
};

export type GlonassReplayMarker = {
  id: string;
  garage: string;
  gos: string;
  lat: number;
  lng: number;
  course: number | null;
  speed: number | null;
  color: string;
  time: string;
};

export type GlonassStatus = 'moving' | 'stop' | 'parking' | 'disabled';

export const HISTORY_REPLAY_COLOR = '#38BDF8';
export const HISTORY_YEAR_COLOR = '#F472D0';
export const PLAYBACK_SPEEDS = [1, 15, 60, 300, 600] as const;
const YEAR_CHUNK_MS = 3 * 24 * 60 * 60 * 1000;

let historyJobToken = 0;

export function formatGlonassSpeed(speed: number | null | undefined): string {
  return speed == null ? '— км/ч' : `${Math.round(speed)} км/ч`;
}

/** Статус машины из последней позиции: В движении / Остановка / Стоянка / Отключен. */
export function vehicleStatus(pos: GlonassPosition | undefined, nowMs = Date.now()): GlonassStatus {
  if (!pos) return 'disabled';
  const t = pos.time ? Date.parse(pos.time) : NaN;
  // Нет свежего фикса (старше 30 мин) — считаем «Отключен».
  if (Number.isFinite(t) && nowMs - t > 30 * 60 * 1000) return 'disabled';
  if (pos.speed != null && pos.speed > 3) return 'moving';
  // На сайте 332 приходит без Speed, Ign=false и отображается как «Остановка».
  // Поэтому отсутствие скорости не трактуем как стоянку; стоянка — только явный
  // ноль скорости при выключенном зажигании.
  if (pos.speed != null && pos.speed <= 0.5 && pos.ign === false) return 'parking';
  return 'stop';
}

export const STATUS_LABEL: Record<GlonassStatus, string> = {
  moving: 'В движении',
  stop: 'Остановка',
  parking: 'Стоянка',
  disabled: 'Отключен',
};

export const STATUS_COLOR: Record<GlonassStatus, string> = {
  moving: '#22C55E',   // зелёный — В движении
  stop: '#2563EB',     // синий — Остановка
  parking: '#F5B301',  // жёлтый — Стоянка
  disabled: '#DC2626', // красный — Отключен
};

type GlonassState = {
  open: boolean;
  fleet: GlonassVehicle[];
  fleetLoaded: boolean;
  loading: boolean;
  error: string | null;
  /** Выбранные машины (ведём на карте). */
  selected: Set<number>;
  /** Последние позиции по id. */
  positions: Map<number, GlonassPosition>;
  /** Накопленный live-след выбранных машин за текущую сессию. */
  tracks: Map<number, GlonassPosition[]>;
  /** Исторические слои: маршруты за период + розовые годовые следы. */
  historyLayers: GlonassHistoryLayer[];
  activeHistoryLayerId: string | null;
  historyLoading: GlonassHistoryLoading | null;
  playbackIndex: number;
  playbackPlaying: boolean;
  playbackSpeed: number;
  /** true — последний опрос вернул «парк офлайн» (нет онлайн-данных). */
  offline: boolean;
  lastPollAt: number;

  setOpen: (open: boolean) => void;
  loadFleet: () => Promise<void>;
  toggleSelect: (id: number) => void;
  clearSelected: () => void;
  refreshPositions: () => Promise<void>;
  createHistoryLayer: (vehicleId: number, from: string, to: string) => Promise<void>;
  createYearRoadLayer: (vehicleIds: number[], from: string, to: string) => Promise<void>;
  toggleHistoryVisibility: (id: string) => void;
  removeHistoryLayer: (id: string) => void;
  setActiveHistoryLayer: (id: string | null) => void;
  setPlaybackIndex: (index: number) => void;
  setPlaybackPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  cancelHistoryLoading: () => void;
};

export const useGlonassStore = create<GlonassState>((set, get) => ({
  open: false,
  fleet: [],
  fleetLoaded: false,
  loading: false,
  error: null,
  selected: new Set(),
  positions: new Map(),
  tracks: new Map(),
  historyLayers: [],
  activeHistoryLayerId: null,
  historyLoading: null,
  playbackIndex: 0,
  playbackPlaying: false,
  playbackSpeed: 60,
  offline: false,
  lastPollAt: 0,

  setOpen: (open) => {
    set({ open });
    if (open && !get().fleetLoaded && !get().loading) void get().loadFleet();
  },

  loadFleet: async () => {
    const api = window.pyn?.glonass;
    if (!api) { set({ error: 'Мост недоступен' }); return; }
    set({ loading: true, error: null });
    try {
      const res = await api.vehicles();
      if (res.ok) {
        set({ fleet: res.vehicles, fleetLoaded: true, error: null });
        void get().refreshPositions();
      } else {
        set({ error: res.error || 'Не удалось загрузить парк' });
      }
    } catch {
      set({ error: 'Ошибка связи с ГЛОНАСС' });
    } finally {
      set({ loading: false });
    }
  },

  toggleSelect: (id) => {
    const next = new Set(get().selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    const tracks = new Map(get().tracks);
    for (const key of tracks.keys()) {
      if (!next.has(key)) tracks.delete(key);
    }
    set({ selected: next, tracks });
    void get().refreshPositions();
  },

  clearSelected: () => set({ selected: new Set(), positions: new Map(), tracks: new Map() }),

  refreshPositions: async () => {
    const api = window.pyn?.glonass;
    const state = get();
    const ids = state.open && state.fleet.length > 0 ? state.fleet.map((v) => v.id) : [...state.selected];
    if (!api || ids.length === 0) { set({ positions: new Map(), offline: false }); return; }
    try {
      const res = await api.positions(ids);
      if (res.ok) {
        const current = get();
        const selected = current.selected;
        const map = new Map(current.positions);
        const tracks = new Map(current.tracks);
        for (const p of res.positions) map.set(p.id, p);
        for (const p of res.positions) {
          if (!selected.has(p.id)) continue;
          if (vehicleStatus(p) !== 'moving') {
            tracks.delete(p.id);
            continue;
          }
          tracks.set(p.id, appendTrackPoint(tracks.get(p.id) ?? [], p));
        }
        for (const key of tracks.keys()) {
          if (!selected.has(key)) tracks.delete(key);
        }
        set({ positions: map, tracks, offline: !!res.offline, lastPollAt: Date.now() });
      }
    } catch {
      /* временный сбой опроса — оставляем прошлые позиции */
    }
  },

  createHistoryLayer: async (vehicleId, from, to) => {
    const api = window.pyn?.glonass;
    const vehicle = findVehicle(get().fleet, vehicleId);
    if (!api) { set({ error: 'Мост ГЛОНАСС недоступен' }); return; }
    if (!vehicle) { set({ error: 'Выберите машину для истории' }); return; }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      set({ error: 'Проверьте дату и время истории' });
      return;
    }
    set({
      historyLoading: { kind: 'replay', layerId: null, label: 'Маршрут за период', done: 0, total: 1 },
      error: null,
    });
    try {
      const res = await api.historyPoints(vehicleId, from, to);
      if (!res.ok) {
        set({ error: res.error || 'История маршрута недоступна' });
        return;
      }
      const layerId = makeLayerId('history');
      const segments = splitAndSimplifyHistory(res.points, 2.5).map((points, index) => ({
        id: `${layerId}-${index}`,
        vehicleId,
        vehicleLabel: vehicleLabel(vehicle),
        points,
      }));
      const pointCount = countPoints(segments);
      if (pointCount < 2) {
        set({ error: 'За выбранный период точек движения нет' });
        return;
      }
      const layer: GlonassHistoryLayer = {
        id: layerId,
        kind: 'replay',
        title: `${vehicle.garage || vehicle.gos} · маршрут`,
        subtitle: `${formatPeriodShort(from, to)} · ${pointCount} т.`,
        color: HISTORY_REPLAY_COLOR,
        visible: true,
        from,
        to,
        vehicleId,
        vehicleLabel: vehicleLabel(vehicle),
        segments,
        pointCount,
        createdAt: Date.now(),
      };
      set((state) => ({
        historyLayers: [layer, ...state.historyLayers],
        activeHistoryLayerId: layer.id,
        playbackIndex: 0,
        playbackPlaying: false,
        error: null,
      }));
    } catch {
      set({ error: 'Ошибка загрузки истории маршрута' });
    } finally {
      set({ historyLoading: null });
    }
  },

  createYearRoadLayer: async (vehicleIds, from, to) => {
    const api = window.pyn?.glonass;
    if (!api) { set({ error: 'Мост ГЛОНАСС недоступен' }); return; }
    const ids = Array.from(new Set(vehicleIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))));
    if (ids.length === 0) { set({ error: 'Отметьте машины для годового следа' }); return; }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      set({ error: 'Проверьте период годового следа' });
      return;
    }

    const token = ++historyJobToken;
    const fleet = get().fleet;
    const chunks = periodChunks(fromMs, toMs, YEAR_CHUNK_MS);
    const total = ids.length * chunks.length;
    const layerId = makeLayerId('year');
    const layer: GlonassHistoryLayer = {
      id: layerId,
      kind: 'yearRoads',
      title: `Следы с 01.01 · ${ids.length} маш.`,
      subtitle: 'розовые реальные линии движения',
      color: HISTORY_YEAR_COLOR,
      visible: true,
      from,
      to,
      vehicleId: ids.length === 1 ? ids[0]! : null,
      vehicleLabel: ids.length === 1 ? vehicleLabel(findVehicle(fleet, ids[0]!) ?? null) : `${ids.length} машин`,
      segments: [],
      pointCount: 0,
      createdAt: Date.now(),
    };
    set((state) => ({
      historyLayers: [layer, ...state.historyLayers],
      activeHistoryLayerId: layer.id,
      historyLoading: { kind: 'yearRoads', layerId, label: 'Годовые следы', done: 0, total },
      playbackPlaying: false,
      error: null,
    }));

    let done = 0;
    let any = false;
    let failed = 0;
    try {
      for (const id of ids) {
        const vehicle = findVehicle(fleet, id);
        for (const [chunkFrom, chunkTo] of chunks) {
          if (token !== historyJobToken) return;
          const label = `${vehicleLabel(vehicle)} · ${done + 1}/${total}`;
          set({ historyLoading: { kind: 'yearRoads', layerId, label, done, total, failed } });
          try {
            const res = await api.historyPoints(id, new Date(chunkFrom).toISOString(), new Date(chunkTo).toISOString());
            if (!res.ok) {
              failed += 1;
            } else if (res.points.length > 1) {
              const segments = splitAndSimplifyHistory(res.points, 10).map((points, index) => ({
                id: `${layerId}-${id}-${chunkFrom}-${index}`,
                vehicleId: id,
                vehicleLabel: vehicleLabel(vehicle),
                points,
              }));
              const count = countPoints(segments);
              if (count > 1) {
                any = true;
                set((state) => ({
                  historyLayers: state.historyLayers.map((item) => item.id === layerId
                    ? {
                      ...item,
                      segments: [...item.segments, ...segments],
                      pointCount: item.pointCount + count,
                      subtitle: `${item.pointCount + count} т. · ${done + 1}/${total}`,
                    }
                    : item),
                }));
              }
            }
          } catch {
            failed += 1;
            /* Один кусок истории может упасть; остальной год продолжаем грузить. */
          } finally {
            done += 1;
            const subtitle = failed > 0 ? `${countLayerPoints(get().historyLayers, layerId)} т. · ${done}/${total} · пропущено ${failed}` : undefined;
            set((state) => ({
              historyLoading: { kind: 'yearRoads', layerId, label, done, total, failed },
              historyLayers: subtitle
                ? state.historyLayers.map((item) => item.id === layerId ? { ...item, subtitle } : item)
                : state.historyLayers,
            }));
            await sleep(240);
          }
        }
      }
      if (!any) {
        set((state) => ({
          historyLayers: state.historyLayers.filter((item) => item.id !== layerId),
          activeHistoryLayerId: state.activeHistoryLayerId === layerId ? null : state.activeHistoryLayerId,
          error: 'За выбранный годовой период следов движения нет',
        }));
      }
    } finally {
      if (token === historyJobToken) set({ historyLoading: null });
    }
  },

  toggleHistoryVisibility: (id) => {
    set((state) => ({
      historyLayers: state.historyLayers.map((layer) => layer.id === id ? { ...layer, visible: !layer.visible } : layer),
    }));
  },

  removeHistoryLayer: (id) => {
    set((state) => {
      const next = state.historyLayers.filter((layer) => layer.id !== id);
      const active = state.activeHistoryLayerId === id ? (next[0]?.id ?? null) : state.activeHistoryLayerId;
      return {
        historyLayers: next,
        activeHistoryLayerId: active,
        playbackIndex: active === state.activeHistoryLayerId ? state.playbackIndex : 0,
        playbackPlaying: active === state.activeHistoryLayerId ? state.playbackPlaying : false,
      };
    });
  },

  setActiveHistoryLayer: (id) => set({
    activeHistoryLayerId: id,
    playbackIndex: 0,
    playbackPlaying: false,
  }),

  setPlaybackIndex: (index) => set({ playbackIndex: Math.max(0, index) }),
  setPlaybackPlaying: (playing) => set({ playbackPlaying: playing }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  cancelHistoryLoading: () => {
    historyJobToken += 1;
    set({ historyLoading: null });
  },
}));

export function flattenHistoryLayer(layer: GlonassHistoryLayer | null | undefined): GlonassHistoryPoint[] {
  if (!layer) return [];
  return layer.segments
    .flatMap((segment) => segment.points)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function appendTrackPoint(track: GlonassPosition[], point: GlonassPosition): GlonassPosition[] {
  const last = track[track.length - 1];
  if (last) {
    const sameTime = last.time && point.time && last.time === point.time;
    const samePlace = Math.abs(last.lat - point.lat) < 0.000001 && Math.abs(last.lng - point.lng) < 0.000001;
    if (sameTime || samePlace) return track;
    const gapMs = last.time && point.time ? Math.abs(Date.parse(point.time) - Date.parse(last.time)) : 0;
    const jumpMeters = distanceMeters(last, point);
    // Если данные пришли с большим разрывом/скачком, начинаем след заново:
    // иначе линия визуально «отлипает» от машины и тянется через полкарты.
    if ((Number.isFinite(gapMs) && gapMs > 2 * 60 * 1000) || jumpMeters > 240) return [point];
  }
  return [...track, point].slice(-48);
}

function splitAndSimplifyHistory(points: GlonassHistoryPoint[], minMeters: number): GlonassHistoryPoint[][] {
  const sorted = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(Date.parse(p.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const segments: GlonassHistoryPoint[][] = [];
  let current: GlonassHistoryPoint[] = [];
  let lastRaw: GlonassHistoryPoint | null = null;
  let lastKept: GlonassHistoryPoint | null = null;

  for (const point of sorted) {
    if (lastRaw && shouldSplitHistorySegment(lastRaw, point)) {
      pushSegment(segments, current);
      current = [];
      lastKept = null;
    }
    if (!lastKept || distanceMeters(lastKept, point) >= minMeters) {
      current.push(point);
      lastKept = point;
    }
    lastRaw = point;
  }

  const last = sorted[sorted.length - 1];
  if (last && current.length > 0 && current[current.length - 1] !== last && !shouldSplitHistorySegment(current[current.length - 1]!, last)) {
    current.push(last);
  }
  pushSegment(segments, current);
  return segments;
}

function shouldSplitHistorySegment(a: GlonassHistoryPoint, b: GlonassHistoryPoint): boolean {
  const gapMs = Math.abs(Date.parse(b.time) - Date.parse(a.time));
  const dist = distanceMeters(a, b);
  return (gapMs > 10 * 60 * 1000 && dist > 350) || dist > 2500;
}

function pushSegment(out: GlonassHistoryPoint[][], segment: GlonassHistoryPoint[]): void {
  if (segment.length >= 2) out.push(segment);
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function countPoints(segments: GlonassHistorySegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.points.length, 0);
}

function countLayerPoints(layers: GlonassHistoryLayer[], id: string): number {
  return layers.find((layer) => layer.id === id)?.pointCount ?? 0;
}

function periodChunks(fromMs: number, toMs: number, stepMs: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let cursor = fromMs; cursor < toMs; cursor += stepMs) {
    chunks.push([cursor, Math.min(toMs, cursor + stepMs)]);
  }
  return chunks;
}

function findVehicle(fleet: GlonassVehicle[], id: number): GlonassVehicle | null {
  return fleet.find((v) => v.id === id) ?? null;
}

function vehicleLabel(vehicle: GlonassVehicle | null | undefined): string {
  if (!vehicle) return 'машина';
  return [vehicle.garage, vehicle.gos].filter(Boolean).join(' · ') || vehicle.name || 'машина';
}

function formatPeriodShort(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fmt.format(new Date(from))}—${fmt.format(new Date(to))}`;
}

function makeLayerId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
