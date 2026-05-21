import { useCallback, useEffect, useState } from 'react';
import { appStatus, useAppLockStore, type AppStatusResponse, type Session } from '@pyn/core';
import { api } from '@/lib/api';
import { compareSemver, getDesktopScope } from '@/lib/version';
import { useWsEvent } from '@/lib/ws';

type UpdateStage = 'detected' | 'downloading' | 'ready' | 'installing';

export interface UseUpdateFlowResult {
  updateInfo: AppStatusResponse | null;
  updateStage: UpdateStage;
  updateBytes: number;
  updateTotal: number;
  updateLocalPath: string | null;
  updateConfirmOpen: boolean;
  setUpdateConfirmOpen: (v: boolean) => void;
  handleUpdatePillClick: () => Promise<void>;
  handleUpdateConfirm: () => Promise<void>;
}

/**
 * Update flow state machine.
 *
 *   detected   — pill «Доступно обновление»
 *   downloading — pill «Загрузка NN%»
 *   ready      — pill «Обновление готово», + confirm dialog «обновиться?»
 *   installing — pill «Установка…», installer запущен, app сейчас quit'нется
 *
 * §pyn-1.2.15 — Раньше был `setInterval(check, 30 * 60 * 1000)` fallback
 * polling. Убран: источник правды теперь WS `app_version_changed` push.
 * Initial check на mount сохранён — нужно знать состояние при cold start
 * (до того как WS-канал откроется). WS подхватит любые последующие changes
 * без overhead'а CF Worker requests.
 *
 * Также seed'ит desktop scope в useAppLockStore из `app_status` response
 * на mount — kill switch state доступен сразу без отдельного запроса.
 */
export function useUpdateFlow(session: Session | null): UseUpdateFlowResult {
  const [updateInfo, setUpdateInfo] = useState<AppStatusResponse | null>(null);
  const [updateStage, setUpdateStage] = useState<UpdateStage>('detected');
  const [updateBytes, setUpdateBytes] = useState(0);
  const [updateTotal, setUpdateTotal] = useState(0);
  const [updateLocalPath, setUpdateLocalPath] = useState<string | null>(null);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);

  // Initial appStatus check + kill switch seed (1 запрос на login).
  // Без 30-мин polling'а — WS push покрывает update notifications.
  useEffect(() => {
    if (!session) return;
    const scope = getDesktopScope();
    const appVersion = window.pyn?.appVersion ?? '0.0.0';
    let cancelled = false;
    void (async () => {
      try {
        const res = await appStatus(api, { appScope: scope, appVersion });
        if (cancelled) return;
        if (res.updateUrl && compareSemver(res.currentVersion, appVersion) > 0) {
          setUpdateInfo(res);
        }
        // Сидируем desktop scope из app_status response. Android scope узнаем
        // позже через get_app_lock_status (когда юзер зайдёт в Settings →
        // Управление) или через WS push.
        if (res.appLockState) {
          useAppLockStore.getState().setScopeFromServer('desktop', {
            state: res.appLockState,
            title: res.appLockTitle || '',
            message: res.appLockMessage || '',
            wipeAt: res.appLockWipeAt ?? null,
            initiatedBy: res.appLockInitiatedBy || '',
          });
        }
      } catch {
        /* offline / network — silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Когда `appStatus` обнаружил новую версию — сразу проверяем кэш через IPC.
  // Если файл уже скачан раньше → stage='ready'. Юзер кликает на pill → confirm
  // dialog без повторного download.
  useEffect(() => {
    if (!updateInfo || !updateInfo.updateUrl) return;
    let cancelled = false;
    void window.pyn?.update
      ?.checkCached?.(updateInfo.updateUrl, updateInfo.currentVersion)
      .then((res) => {
        if (cancelled) return;
        if (res?.exists) {
          setUpdateLocalPath(res.localPath);
          setUpdateStage('ready');
        }
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancelled = true;
    };
  }, [updateInfo]);

  // Подписка на download progress (приходит из main process).
  useEffect(() => {
    const unsub = window.pyn?.update?.onProgress?.((p) => {
      setUpdateBytes(p.bytes);
      setUpdateTotal(p.total);
    });
    return () => {
      unsub?.();
    };
  }, []);

  // Click на UpdateAvailablePill в sidebar — state machine transitions.
  const handleUpdatePillClick = useCallback(async (): Promise<void> => {
    if (!updateInfo || !updateInfo.updateUrl) return;
    if (updateStage === 'ready') {
      setUpdateConfirmOpen(true);
      return;
    }
    if (updateStage !== 'detected') return;
    setUpdateStage('downloading');
    setUpdateBytes(0);
    setUpdateTotal(0);
    try {
      const res = await window.pyn?.update?.download?.(
        updateInfo.updateUrl,
        updateInfo.currentVersion,
        // Server возвращает SHA-256 свежего бинаря в `app_status.binary_sha`.
        // main process после скачивания сравнит — mismatch = подмена exe в
        // пути, download rejected, error.
        updateInfo.binarySha || undefined,
      );
      if (res?.ok && res.localPath) {
        setUpdateLocalPath(res.localPath);
        setUpdateStage('ready');
        setUpdateConfirmOpen(true);
      } else {
        // Откат на detected — юзер может попробовать снова кликом на pill.
        setUpdateStage('detected');
        console.warn('[pyn:update] download failed:', res?.error);
      }
    } catch (err) {
      setUpdateStage('detected');
      console.warn('[pyn:update] download error:', err);
    }
  }, [updateInfo, updateStage]);

  // «Да, обновить» в confirm dialog → install + quit.
  const handleUpdateConfirm = useCallback(async (): Promise<void> => {
    if (!updateLocalPath) return;
    setUpdateConfirmOpen(false);
    setUpdateStage('installing');
    try {
      await window.pyn?.update?.install?.(updateLocalPath);
    } catch (err) {
      console.warn('[pyn:update] install failed:', err);
      setUpdateStage('ready');
    }
  }, [updateLocalPath]);

  // WS push: новая версия приложения опубликована — мгновенный re-check.
  // Главный канал обновления (вместо 30-мин polling, который был раньше).
  useWsEvent<{ type: string; scope?: string; current_version?: string }>(
    'app_version_changed',
    (event) => {
      const scope = getDesktopScope();
      // Реагируем только если событие касается нашего scope.
      if (event.scope && event.scope !== scope) return;
      const appVersion = window.pyn?.appVersion ?? '0.0.0';
      void appStatus(api, { appScope: scope, appVersion })
        .then((res) => {
          if (res.updateUrl && compareSemver(res.currentVersion, appVersion) > 0) {
            setUpdateInfo(res);
            setUpdateStage('detected');
          }
        })
        .catch(() => {
          /* silent */
        });
    },
  );

  return {
    updateInfo,
    updateStage,
    updateBytes,
    updateTotal,
    updateLocalPath,
    updateConfirmOpen,
    setUpdateConfirmOpen,
    handleUpdatePillClick,
    handleUpdateConfirm,
  };
}
