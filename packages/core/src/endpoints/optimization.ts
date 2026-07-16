import type { ApiClient } from '../api/client';

/** Перерыв: обед / форс-мажор (минуты суток). OR-Tools breaks. */
export interface OptimizationBreakInput {
  start_min: number;
  end_min: number;
  label?: string;
}

export interface OptimizationVehicleInput {
  id: string;
  type_id: string;
  capacity_kg: number;
  start_node: number;
  end_node: number;
  shift_start_min: number;
  shift_end_min: number;
  /** Обед + закрытые форс-мажоры; опционально (старые клиенты/сервер игнорят). */
  breaks?: OptimizationBreakInput[];
}

export interface OptimizationPositionInput {
  id: string;
  node: number;
  demand_kg: number;
  service_min: number;
  window_start_min: number;
  window_end_min: number;
  allowed_vehicle_ids: string[] | null;
  locked_vehicle_id?: string | null;
  eps: number;
}

export interface OptimizationPayload {
  positions: OptimizationPositionInput[];
  vehicles: OptimizationVehicleInput[];
  time_matrix: number[][];
  time_limit_s?: number;
}

export interface OptimizationJob {
  id: string;
  source: string;
  day: string;
  status: string;
  explanation: string;
  error: string;
  result: {
    routes?: Array<{
      vehicle_id: string;
      vehicle_type?: string;
      stops: Array<{ position_id: string; arrival_min: number; load_kg?: number }>;
      finish_min?: number;
    }>;
    unserved?: Array<{ id: string; reason: string }>;
    explanation?: string;
  } | null;
  confirmed_at: string;
  created_at: string;
  updated_at: string;
}

export async function optimizationStart(
  client: ApiClient,
  day: string,
  payload: OptimizationPayload,
): Promise<{ job_id: string; status: string }> {
  return client.call('optimization_start', { day, payload });
}

export async function optimizationStatus(
  client: ApiClient,
  jobId?: string,
  day?: string,
): Promise<OptimizationJob> {
  // Авто-маршрутизация по крону льёт джобы за сегодня и завтра — читаем последний
  // ИМЕННО нашего дня (сервер фильтрует по operational_day). Без дня — последний вообще.
  const params = jobId ? { job_id: jobId } : day ? { day } : {};
  const wire = await client.call<{ job?: OptimizationJob }>('optimization_status', params);
  if (!wire.job) throw new Error('optimization_job_not_found');
  return wire.job;
}

export async function optimizationConfirm(client: ApiClient, jobId: string): Promise<{ confirmed_at: string }> {
  return client.call('optimization_confirm', { job_id: jobId });
}
