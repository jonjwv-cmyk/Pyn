import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

// StrictMode намеренно НЕ подключаем: его dev-only double-mount триггерит
// двойные useEffect'ы → server возвращает `replay_detected` на дублирующий
// API call → лента то появляется то исчезает. В production StrictMode не
// влияет, но dev-experience становится непредсказуемым. Без него — один fetch
// per mount, как в production.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
