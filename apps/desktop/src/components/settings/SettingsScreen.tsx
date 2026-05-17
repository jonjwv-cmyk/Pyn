import { useState, type ReactNode } from 'react';
import type { Role } from '@pyn/core';
import {
  SettingsSidebar,
  defaultSettingsSubSection,
  type SettingsSubSection,
} from './SettingsSidebar';
import { SettingsTopBar } from './SettingsTopBar';
import { GoogleAccountPanel } from './GoogleAccountPanel';
import { useUsersPanelState } from './users/use-users-panel-state';

interface SettingsScreenProps {
  /** Роль текущего юзера — пробрасываем в подпанели для гейтинга действий. */
  myRole: Role;
  /** Логин текущего юзера — чтобы не давать ему удалить/деактивировать себя. */
  myLogin: string;
  /** Возврат в основной раздел. */
  onBack: () => void;
}

/**
 * Экран Settings — full-screen «свой раздел»: основной Sidebar приложения
 * не рендерится; навигация только через внутренний SettingsSidebar +
 * back-кнопку в едином topbar'е.
 *
 * Layout:
 *   ┌─ SettingsTopBar h-12 на всю ширину окна ──────┐
 *   │ ← Назад │ Title │ … actions подсекции          │
 *   ├──────────────────┬─────────────────────────────┤
 *   │ SettingsSidebar  │ content body                │
 *   └──────────────────┴─────────────────────────────┘
 *
 * Title + actions topbar'a меняются в зависимости от активной подсекции.
 * State каждой панели lifted сюда через хук (`useUsersPanelState` и т.п.) —
 * это позволяет единому topbar'у отрисовывать controls конкретной панели.
 *
 * Default subsection: developer → «Пользователи»; остальные роли → «Язык».
 */
export function SettingsScreen({ myRole, myLogin, onBack }: SettingsScreenProps) {
  const [sub, setSub] = useState<SettingsSubSection>(() => defaultSettingsSubSection(myRole));

  // Хук всегда вызывается; `active` контролирует polling — выключен когда
  // юзер не на подсекции «Пользователи».
  const usersUi = useUsersPanelState({
    myRole,
    myLogin,
    active: sub === 'users',
  });

  const { title, actions, body } = pickSubSectionUi(sub, usersUi);

  return (
    <main className="flex flex-1 flex-col">
      <SettingsTopBar title={title} onBack={onBack}>
        {actions}
      </SettingsTopBar>
      <div className="flex flex-1 overflow-hidden">
        <SettingsSidebar myRole={myRole} activeId={sub} onSelect={setSub} />
        <section className="flex flex-1 flex-col overflow-hidden bg-bg-surface">
          {body}
        </section>
      </div>
    </main>
  );
}

interface SubUi {
  title: string;
  actions: ReactNode;
  body: ReactNode;
}

function pickSubSectionUi(
  sub: SettingsSubSection,
  usersUi: SubUi,
): SubUi {
  switch (sub) {
    case 'users':
      return usersUi;
    case 'language':
      return {
        title: 'Язык',
        actions: null,
        body: <PlaceholderBody hint="Локализация (RU/EN) — скоро." />,
      };
    case 'appearance':
      return {
        title: 'Оформление',
        actions: null,
        body: <PlaceholderBody hint="Тема (тёмная/светлая), плотность — скоро." />,
      };
    case 'google':
      return {
        title: 'Google',
        actions: null,
        body: <GoogleAccountPanel />,
      };
    default:
      return {
        title: String(sub),
        actions: null,
        body: <PlaceholderBody hint="Скоро будет." />,
      };
  }
}

function PlaceholderBody({ hint }: { hint: string }): JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-[12px] text-text-muted">{hint}</p>
    </div>
  );
}
