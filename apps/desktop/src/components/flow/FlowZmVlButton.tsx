import { useState } from 'react';
import { DatabaseZap } from 'lucide-react';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';

/** Пароль кнопки сверки (ТЗ §5.2) — фиксирован заранее, обработка подключится позже. */
const ZMVL_PASSWORD = '7777';

/**
 * «Полная выгрузка zm_vl (сверка)» — КНОПКА-ЗАГЛУШКА под паролем (ТЗ §5.2:
 * поставить сейчас, парсер прикрутить позже). Полной сверочной выгрузки пока
 * нет — юзер пришлёт запись макроса с выбором формата (полный набор колонок
 * zm_vl), тогда сюда подключится прогон + порт движка сверки на поставки.
 */
export function FlowZmVlButton(): JSX.Element {
  const [pwOpen, setPwOpen] = useState(false);
  const [msg, setMsg] = useState('');

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="no-drag-region max-w-[320px] truncate text-[11px] text-text-muted/80" title={msg}>
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={() => setPwOpen(true)}
        title="Полная сверочная выгрузка zm_vl — подключится после записи макроса (кнопка под паролем)"
        className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong"
      >
        <DatabaseZap size={13} strokeWidth={1.75} />
        Сверка zm_vl
      </button>
      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel="Полная выгрузка zm_vl (сверка)"
        onSubmit={(pw) => {
          setPwOpen(false);
          setMsg(
            pw === ZMVL_PASSWORD
              ? 'Принято. Прогон сверки подключится после записи макроса полной выгрузки.'
              : 'Неверный пароль',
          );
        }}
        onCancel={() => setPwOpen(false)}
      />
    </div>
  );
}
