import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Role } from '@pyn/core';
import {
  SettingsSidebar,
  defaultSettingsSubSection,
  type SettingsSubSection,
} from './SettingsSidebar';
import { SettingsTopBar } from './SettingsTopBar';
import { GoogleAccountPanel } from './GoogleAccountPanel';
import { AppControlPanel } from './AppControlPanel';
import { LanguagePanel } from './LanguagePanel';
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
  const { t } = useTranslation();
  const [sub, setSub] = useState<SettingsSubSection>(() => defaultSettingsSubSection(myRole));

  // Хук всегда вызывается; `active` контролирует polling — выключен когда
  // юзер не на подсекции «Пользователи».
  const usersUi = useUsersPanelState({
    myRole,
    myLogin,
    active: sub === 'users',
  });

  const { title, actions, body } = pickSubSectionUi(sub, usersUi, t);

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
  t: (key: string) => string,
): SubUi {
  switch (sub) {
    case 'users':
      return usersUi;
    case 'language':
      return {
        title: t('settings_sidebar.language'),
        actions: null,
        body: <LanguagePanel />,
      };
    case 'appearance':
      return {
        title: t('settings_sidebar.appearance'),
        actions: null,
        body: <PlaceholderBody hint={t('settings_placeholder.appearance')} />,
      };
    case 'google':
      return {
        title: t('settings_sidebar.google'),
        actions: null,
        body: <GoogleAccountPanel />,
      };
    case 'app-control':
      return {
        title: t('settings_sidebar.app_control'),
        actions: null,
        body: <AppControlPanel />,
      };
    default:
      return {
        title: String(sub),
        actions: null,
        body: <PlaceholderBody hint={t('settings_placeholder.soon')} />,
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
