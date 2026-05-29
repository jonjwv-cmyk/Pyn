import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow } from 'lucide-react';
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
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated">
                <AppWindow className="h-8 w-8 text-text-muted opacity-50" strokeWidth={1.2} />
              </div>
              <h2 className="mt-6 text-xl font-semibold text-text-primary">
                {t('storage.corp_pc_only_title')}
              </h2>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
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
