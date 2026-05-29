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
 * Layout (зеркало main shell — bg-deep rail + плавающая карточка):
 *   ┌ rail bg-deep ─┬ gutter p-2 → card bg-surface (rounded) ─────┐
 *   │ [traffic-lts] │ ┌ SettingsTopBar h-12: Title · actions ───┐ │
 *   │ ← Назад       │ ├─────────────────────────────────────────┤ │
 *   │ Пользователи  │ │ content body                            │ │
 *   │ Язык …        │ └─────────────────────────────────────────┘ │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * Back-кнопка живёт в rail (над nav-пунктами). Title + actions topbar'a
 * меняются в зависимости от активной подсекции.
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
    <div className="flex h-full w-full bg-bg-deep">
      <SettingsSidebar myRole={myRole} activeId={sub} onSelect={setSub} onBack={onBack} />
      <div className="relative flex min-w-0 flex-1 p-2">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
          <SettingsTopBar title={title}>{actions}</SettingsTopBar>
          <section className="flex flex-1 flex-col overflow-hidden bg-bg-surface">
            {body}
          </section>
        </div>
      </div>
    </div>
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
