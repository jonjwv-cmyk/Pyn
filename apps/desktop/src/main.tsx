import ReactDOM from 'react-dom/client';
import { App } from './App';
import { TrayMenu } from './components/system/TrayMenu';
import './index.css';

// StrictMode намеренно НЕ подключаем: его dev-only double-mount триггерит
// двойные useEffect'ы → server возвращает `replay_detected` на дублирующий
// API call → лента то появляется то исчезает. В production StrictMode не
// влияет, но dev-experience становится непредсказуемым. Без него — один fetch
// per mount, как в production.

// §pyn-1.2.15 — tray menu live в том же renderer'е что main app, но в отдельном
// BrowserWindow. Determinant — hash `#tray` в URL (main.ts создаёт tray window
// с `loadURL(...#tray)`). Это позволяет переиспользовать Tailwind + lucide + i18n
// без extra Vite entry point.
const isTrayMenu = window.location.hash === '#tray';

ReactDOM.createRoot(document.getElementById('root')!).render(
  isTrayMenu ? <TrayMenu /> : <App />,
);
