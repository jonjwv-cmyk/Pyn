import { Factory } from 'lucide-react';

/**
 * Вкладка «Цеха» базы. Пока заглушка: счётчики цехов/складов показываются в
 * шапке (MolTopBar), а оформление списка цехов добавим позже по ТЗ юзера.
 * Готовится под будущее серверное обновление базы складов/цехов.
 */
export function ShopsTab() {
  return (
    <div className="mol-pattern-bg flex flex-1 items-center justify-center">
      <Factory className="h-10 w-10 text-text-muted/25" strokeWidth={1.2} />
    </div>
  );
}
