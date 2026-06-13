import ReactDOM from 'react-dom/client';
import i18next from 'i18next';
import { App } from './App';
import { TrayMenu } from './components/system/TrayMenu';
import { initI18n } from './lib/i18n';
import { installGlobalErrorReporting } from './lib/error-report';
import './index.css';
import './lib/fonts';

// StrictMode намеренно НЕ подключаем: его dev-only double-mount триггерит
// двойные useEffect'ы → server возвращает `replay_detected` на дублирующий
// API call → лента то появляется то исчезает. В production StrictMode не
// влияет, но dev-experience становится непредсказуемым.

// §pyn-1.2.15 — tray menu live в том же renderer'е что main app, но в отдельном
// BrowserWindow. Determinant — hash `#tray` в URL (main.ts создаёт tray window
// с `loadURL(...#tray)`).
const isTrayMenu = window.location.hash === '#tray';

// §pyn-1.2.25 — AWAIT i18n init до первого render. Раньше `void init` давал
// флэш: TrayMenu рендерил raw keys ('tray_menu.open') и иногда успевал
// blur+hide до того как async init завершится → юзер видел keys. Также
// format-time.ts читал `i18next.language` на первом cadre и кэшировал
// formatter под 'ru' → даты «16 мая» в EN UI.
//
// localStorage cache язык пишется changeLanguage()/initI18n() — здесь
// читаем синхронно, чтобы tray window знал актуальный выбор без electron
// safeStorage IPC (ui-state-store hydrate slow).
async function bootstrap(): Promise<void> {
  const savedLang = (() => {
    try { return localStorage.getItem('pyn:i18n:lang'); } catch { return null; }
  })();
  await initI18n(savedLang);

  // §pyn-1.2.27 — sync tray window c main window при смене языка. localStorage
  // 'storage' event fires в ДРУГИХ окнах того же origin (file:// + index.html
  // с другим hash — same origin). Юзер меняет язык в Settings → changeLanguage
  // пишет в localStorage → main window fires storage event → tray window ловит
  // и обновляет i18next без re-mount окна.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'pyn:i18n:lang' || !e.newValue) return;
    if (e.newValue === i18next.language) return;
    void i18next.changeLanguage(e.newValue);
  });

  // Глобальный репорт необработанных ошибок на сервер (мониторинг) — только основное окно.
  if (!isTrayMenu) installGlobalErrorReporting();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    isTrayMenu ? <TrayMenu /> : <App />,
  );
}
void bootstrap();
