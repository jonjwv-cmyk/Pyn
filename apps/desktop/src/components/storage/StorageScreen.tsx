import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorageStore } from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { Breadcrumb } from './Breadcrumb';
import { FileList } from './FileList';
import { StorageHome } from './StorageHome';

/**
 * Storage = SMB-проводник по сетевой папке Экспедиция.
 *
 * Layout:
 *   • На корне — StorageHome (3 крупных tile-card)
 *   • Внутри подпапок — Breadcrumb + FileList
 *   • Mac — заглушка «Доступно только на Windows»
 *
 * §pyn-1.2.17 — убран FolderTree. Глубокая иерархия Planы/2026/Май/7.5.26
 * раньше тяжело смотрелась в дереве слева. Теперь Finder-style: каждое окно
 * показывает одну папку, навигация двойным кликом / breadcrumb-segment'ами /
 * back-forward кнопками.
 */
export function StorageScreen() {
  const { t } = useTranslation();
  const [platformState, setPlatformState] = useState<
    | { status: 'loading' }
    | { status: 'unsupported' }
    | { status: 'ready'; root: string }
  >({ status: 'loading' });

  const currentPath = useStorageStore((s) => s.currentPath);
  const setCurrentPath = useStorageStore((s) => s.setCurrentPath);

  useEffect(() => {
    let cancelled = false;
    void window.pyn?.fs?.platform().then((res) => {
      if (cancelled) return;
      if (!res?.supported) {
        setPlatformState({ status: 'unsupported' });
        return;
      }
      setPlatformState({ status: 'ready', root: res.root });
      if (!currentPath) setCurrentPath(res.root);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRoot =
    platformState.status === 'ready' &&
    (currentPath === platformState.root || !currentPath);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_storage')}
        </span>
      </div>
      <WorkspaceCard>
        {platformState.status === 'loading' ? null : platformState.status === 'unsupported' ? (
          // Фон и центрирование — как пустое состояние МОЛ (mol-pattern-bg +
          // крупный центрированный текст), без иконки.
          <div className="mol-pattern-bg flex flex-1 items-center justify-center p-6">
            <p className="max-w-[440px] text-center text-[22px] font-semibold tracking-[-0.015em] text-text-secondary/85">
              {t('storage.corp_pc_only_title')}
            </p>
          </div>
        ) : (
          // p-4 — единое поле 16px по периметру (как на всех листах): проводник
          // (хлебные крошки + список) отступает от окантовки карточки на эту линию.
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <Breadcrumb root={platformState.root} currentPath={currentPath} />
            {onRoot ? (
              <StorageHome root={platformState.root} />
            ) : (
              <FileList currentPath={currentPath} />
            )}
          </div>
        )}
      </WorkspaceCard>
    </main>
  );
}
