import * as Dialog from '@radix-ui/react-dialog';
import { Phone, Mail } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export type ContactActionKind = 'call' | 'mail' | 'callWarehouse';

export interface ContactActionRequest {
  kind: ContactActionKind;
  /** Сырой target: digits для звонка (для tel:) или email-адрес для mailto:. */
  target: string;
  /** Отображаемая форма: «8 901 438 8831», «49 02 82» или email. */
  display: string;
  /** Кому: «Иванов И.И.», «Склад 8024», «Иванов И.И. (рабочий)». */
  contactName: string;
}

interface ContactActionDialogProps {
  request: ContactActionRequest | null;
  onClose: () => void;
}

/**
 * Подтверждение перед запуском tel:/mailto: link.
 *
 * Контекстные сценарии:
 *   • call — клик по сотовому в строке таблицы:
 *       «Позвонить Иванову И.И. на 8 901 438 8831?»
 *   • mail — клик по email в строке таблицы:
 *       «Отправить письмо Иванову И.И. на login@evraz.com?»
 *   • callWarehouse — клик по телефону в карточке склада:
 *       «Позвонить на склад 8024 (49 02 82)?»
 *
 * При подтверждении → `window.location.href = tel:/mailto:`. Это вызовет
 * стандартный handler ОС (телефония / Mail.app / etc).
 */
export function ContactActionDialog({ request, onClose }: ContactActionDialogProps) {
  const { t } = useTranslation();
  const open = request !== null;

  const handleConfirm = () => {
    if (!request) return;
    const href =
      request.kind === 'mail'
        ? `mailto:${request.target}`
        : `tel:${request.target.replace(/\D/g, '')}`;
    window.location.href = href;
    onClose();
  };

  const title =
    request?.kind === 'mail'
      ? t('mol.contact_email')
      : request?.kind === 'callWarehouse'
        ? t('mol.contact_warehouse_call')
        : t('mol.contact_call');

  const Icon = request?.kind === 'mail' ? Mail : Phone;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-clay-bg">
              <Icon className="h-4 w-4 text-accent-clay" strokeWidth={1.75} />
            </span>
            <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
              {title}
            </Dialog.Title>
          </div>

          <Dialog.Description asChild>
            <div className="text-[13px] leading-snug text-text-secondary">
              {request && <BodyTrans request={request} />}
            </div>
          </Dialog.Description>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              {t('common.no')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {t('common.yes')}
            </button>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Локализованное тело подтверждения. Через `<Trans>` сохраняем подсветку
 * имени и target'а (телефон / email) — `<b>` chunk styled, остальные слова
 * следуют грамматике языка.
 */
function BodyTrans({ request }: { request: ContactActionRequest }): JSX.Element {
  const key =
    request.kind === 'mail'
      ? 'mol.confirm_mail_body'
      : request.kind === 'callWarehouse'
        ? 'mol.confirm_call_warehouse_body'
        : 'mol.confirm_call_body';
  return (
    <p>
      <Trans
        i18nKey={key}
        values={{ name: request.contactName, target: request.display }}
        components={{ b: <span className="whitespace-nowrap font-medium text-text-strong tabular-nums" /> }}
      />
    </p>
  );
}
