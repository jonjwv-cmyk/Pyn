import { createZustandStore as create } from '@pyn/core';
import type { LatLng } from './map-types';
import { formatGosPlate, formatHistoryChipTitle } from './glonass-format';

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
  /** Перед точкой нет пути по дороге (разрыв сети/сигнала): след рвём, маркер
   *  телепортируется — проигрыватель не рисует диагональ. Ставится снапом. */
  gapBefore?: boolean;
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

/** Точка живого пути машины: снапнутая к дороге позиция + время фикса. */
export type GlonassTimedPathPoint = {
  lat: number;
  lng: number;
  time: string;
  speed?: number | null;
  /** Перед точкой нет пути по дороге — след рвётся, маркер телепортируется. */
  gapBefore?: boolean;
};

/** Готовая к отрисовке точка машины на карте (позиция + подпись + статус). */
export type GlonassMarker = {
  id: number;
  garage: string;
  gos: string;
  lat: number;
  lng: number;
  /** Сырой GPS (до delayed) — rAF без timedPath всегда сажает raw→дорога. */
  rawLat?: number;
  rawLng?: number;
  path?: LatLng[];
  /** Живое движение: снапнутый к дорогам путь с таймингом. MapCanvas ведёт маркер
   *  по нему НЕПРЕРЫВНО (rAF, время = сейчас − delayMs) — машина едет по дороге
   *  плавно, след рисуется строго ЗА ней, не обгоняя. */
  timedPath?: GlonassTimedPathPoint[];
  delayMs?: number;
  course: number | null;
  speed: number | null;
  time: string | null;
  status: GlonassStatus;
  /** Момент (ms), когда начался «плохой сигнал»: статус «движется», а машина
   *  стоит на месте. null — сигнал нормальный. Для ⚠ и таймера над машиной. */
  badSince?: number | null;
};

export type GlonassReplayMarker = {
  id: string;
  garage: string;
  gos: string;
  lat: number;
  lng: number;
  path?: LatLng[];
  course: number | null;
  speed: number | null;
  color: string;
  time: string;
  animationMs?: number;
};

export type GlonassStatus = 'moving' | 'stop' | 'parking' | 'disabled';

export const HISTORY_REPLAY_COLOR = '#38BDF8';
export const GLONASS_PRO_COLOR = '#38BDF8';
export const GLONASS_RAW_COLOR = '#FB7185';
export const HISTORY_YEAR_COLOR = '#F472D0';
export const PLAYBACK_SPEEDS = Array.from({ length: 24 }, (_, index) => (index + 1) * 0.5);
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
  /** Плохой сигнал: id → момент (ms) начала «движется, но стоит». */
  staleSince: Map<number, number>;
  /** Исторические слои: маршруты за период + розовые годовые следы. */
  historyLayers: GlonassHistoryLayer[];
  activeHistoryLayerId: string | null;
  historyLoading: GlonassHistoryLoading | null;
  playbackIndex: number;
  playbackPlaying: boolean;
  playbackSpeed: number;
  /** Независимые слои сравнения: обработанный PRO и исходные точки провайдера. */
  showPro: boolean;
  showRaw: boolean;
  /** true — последний опрос вернул «парк офлайн» (нет онлайн-данных). */
  offline: boolean;
  lastPollAt: number;
  /**
   * Слежение: можно за несколькими сразу (камера держит их в кадре).
   * Пустой Set — ни за кем.
   */
  followIds: Set<number>;
  /** Динамическая ширина панели / сдвиг погоды (считает GlonassPanel). */
  panelWidthPx: number;
  weatherLeftPx: number;
  pillWidthPx: number;

  setOpen: (open: boolean) => void;
  setPanelLayout: (layout: { panelWidth: number; weatherLeft: number; pillWidth: number }) => void;
  loadFleet: () => Promise<void>;
  toggleSelect: (id: number) => void;
  /** Заменить набор выбранных (фильтр по статусу и т.п.). */
  setSelected: (ids: Iterable<number>) => void;
  clearSelected: () => void;
  /** Вкл/выкл слежение за машиной (мультивыбор). */
  toggleFollow: (id: number) => void;
  refreshPositions: () => Promise<void>;
  createHistoryLayer: (vehicleId: number, from: string, to: string) => Promise<void>;
  createYearRoadLayer: (vehicleIds: number[], from: string, to: string) => Promise<void>;
  toggleHistoryVisibility: (id: string) => void;
  removeHistoryLayer: (id: string) => void;
  setActiveHistoryLayer: (id: string | null) => void;
  setPlaybackIndex: (index: number) => void;
  setPlaybackPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setShowPro: (show: boolean) => void;
  setShowRaw: (show: boolean) => void;
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
  staleSince: new Map(),
  historyLayers: [],
  activeHistoryLayerId: null,
  historyLoading: null,
  playbackIndex: 0,
  playbackPlaying: false,
  playbackSpeed: 1,
  showPro: true,
  showRaw: false,
  offline: false,
  lastPollAt: 0,
  followIds: new Set(),
  panelWidthPx: 360,
  weatherLeftPx: 382,
  pillWidthPx: 128,

  setOpen: (open) => {
    set({ open });
    if (open && !get().fleetLoaded && !get().loading) void get().loadFleet();
  },

  setPanelLayout: (layout) => {
    const cur = get();
    if (
      cur.panelWidthPx === layout.panelWidth
      && cur.weatherLeftPx === layout.weatherLeft
      && cur.pillWidthPx === layout.pillWidth
    ) return;
    set({
      panelWidthPx: layout.panelWidth,
      weatherLeftPx: layout.weatherLeft,
      pillWidthPx: layout.pillWidth,
    });
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
    // Сняли с карты — снять и слежение.
    const followIds = new Set([...get().followIds].filter((fid) => next.has(fid)));
    set({ selected: next, tracks, followIds });
    void get().refreshPositions();
  },

  setSelected: (ids) => {
    const next = new Set<number>();
    for (const id of ids) {
      if (Number.isFinite(id)) next.add(Number(id));
    }
    const tracks = new Map(get().tracks);
    for (const key of tracks.keys()) {
      if (!next.has(key)) tracks.delete(key);
    }
    const followIds = new Set([...get().followIds].filter((fid) => next.has(fid)));
    const prev = get().selected;
    const same = prev.size === next.size && [...next].every((id) => prev.has(id));
    set({ selected: next, tracks, followIds });
    if (!same) void get().refreshPositions();
  },

  clearSelected: () => set({
    selected: new Set(),
    positions: new Map(),
    tracks: new Map(),
    staleSince: new Map(),
    followIds: new Set(),
  }),

  toggleFollow: (id) => {
    const next = new Set(get().followIds);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      // Следить можно только за отмеченными на карте.
      if (!get().selected.has(id)) {
        const selected = new Set(get().selected);
        selected.add(id);
        set({ selected, followIds: next });
        void get().refreshPositions();
        return;
      }
    }
    set({ followIds: next });
  },

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
        const staleSince = new Map(current.staleSince);
        const now = Date.now();
        for (const p of res.positions) {
          if (!selected.has(p.id)) continue;
          const prev = current.positions.get(p.id);
          // «Движется» (скорость>3), но координата не сдвинулась (<3 м) → плохой/
          // зависший сигнал: врёт зелёным. Запоминаем момент начала для таймера.
          const frozen = vehicleStatus(p) === 'moving' && prev != null && distanceMeters(prev, p) < 3;
          if (frozen) {
            if (!staleSince.has(p.id)) staleSince.set(p.id, now);
          } else {
            staleSince.delete(p.id);
          }
        }
        for (const p of res.positions) map.set(p.id, p);
        for (const p of res.positions) {
          if (!selected.has(p.id)) continue;
          // Трек НЕ стираем на остановке: короткая пауза (светофор/дрогнувший
          // сигнал) стирала накопленный путь — отложенный маркер терял дорогу и
          // «летал» между сырой позицией и −30с (ТЗ 2026-07-12, мультивыбор).
          // Дедуп самой точки и рестарт после долгого разрыва (>2 мин / >240 м)
          // уже делает appendTrackPoint.
          tracks.set(p.id, appendTrackPoint(tracks.get(p.id) ?? [], p));
        }
        for (const key of tracks.keys()) {
          if (!selected.has(key)) tracks.delete(key);
        }
        for (const key of [...staleSince.keys()]) {
          if (!selected.has(key)) staleSince.delete(key);
        }
        set({ positions: map, tracks, staleSince, offline: !!res.offline, lastPollAt: Date.now() });
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
      const segments = splitAndSimplifyHistory(res.points, 7).map((points, index) => ({
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
        // На карте: «401 июль 19» / «401 июль 19 2025»
        title: formatHistoryChipTitle(vehicle.garage || vehicle.gos, from),
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
  setShowPro: (showPro) => set({ showPro }),
  setShowRaw: (showRaw) => set({ showRaw }),
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
  return segments
    .map(trimStationaryHistoryTail)
    .filter((segment): segment is GlonassHistoryPoint[] => segment !== null);
}

function trimStationaryHistoryTail(segment: GlonassHistoryPoint[]): GlonassHistoryPoint[] | null {
  const measured = segment.filter((point) => point.speed != null && Number.isFinite(point.speed));
  if (measured.length < 2) return segment;
  const movingIndexes = segment
    .map((point, index) => ((point.speed ?? 0) > 3 ? index : -1))
    .filter((index) => index >= 0);
  if (movingIndexes.length < 2 || (movingIndexes.length < 3 && movingIndexes.length / measured.length < 0.5)) return null;
  const first = movingIndexes[0]!;
  const last = movingIndexes[movingIndexes.length - 1]!;
  const trimmed = segment.slice(first, last + 1);
  let meters = 0;
  for (let i = 1; i < trimmed.length; i += 1) meters += distanceMeters(trimmed[i - 1]!, trimmed[i]!);
  return meters >= 12 ? trimmed : null;
}

function shouldSplitHistorySegment(a: GlonassHistoryPoint, b: GlonassHistoryPoint): boolean {
  const gapMs = Math.abs(Date.parse(b.time) - Date.parse(a.time));
  const dist = distanceMeters(a, b);
  // Разрыв — только «машина ПЕРЕМЕСТИЛАСЬ без данных» (неизвестный путь). Пауза
  // НА МЕСТЕ — это стоянка: терминал на стоянке шлёт фикс раз в 1.5–10 минут
  // (живой трек 09.07: медиана шага 4–9 с в движении, до 600 с на месте), и
  // резка «gap > 90 с» рвала линию на КАЖДОЙ разгрузке — сайт ГЛОНАСС рисует
  // тот же участок непрерывным кольцом. Стоянка не рвёт ни линию, ни HMM-прогон:
  // манёвра у развилки из неё не возникает, точки геометрически на месте.
  return dist > 2500 || (gapMs > 90 * 1000 && dist > 300);
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
  // Ярлык слоя истории: гаражный + гос с пробелами (тип/марка/водитель — в пикере).
  const gos = formatGosPlate(vehicle.gos) || vehicle.gos;
  return [vehicle.garage, gos].filter(Boolean).join(' | ') || vehicle.name || 'машина';
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
