import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AppWindow,
  Camera,
  ChevronRight,
  Crop,
  FileText,
  ImagePlus,
  Monitor,
  ScanLine,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { AttachmentKind } from '@/types/chat';

interface ChatAttachmentMenuProps {
  onSelect: (kind: AttachmentKind) => void;
  /** Trigger — обычно paperclip-кнопка из composer'a. */
  children: ReactNode;
}

/**
 * Меню вариантов прикрепления, раскрывается над paperclip-кнопкой.
 *
 *   • Прикрепить файл
 *   • Фото или видео
 *   • Сделать снимок (с камеры устройства)
 *   ─── divider ───
 *   • Скриншот › (sub-menu)
 *        • Экран
 *        • Окно приложения
 *        • Область
 *
 * После выбора любого пункта Composer сам создаёт PendingAttachment-чип
 * (real OS capture подключится при интеграции с Electron preload bridge).
 */
export function ChatAttachmentMenu({ onSelect, children }: ChatAttachmentMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            'z-50 w-[232px] rounded-xl',
            'border border-border-default bg-bg-elevated',
            'p-1.5 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        >
          <Item icon={FileText} label={t('chat_attachments.attach_file')} onSelect={() => onSelect('file')} />
          <Item icon={ImagePlus} label={t('chat_attachments.photo_or_video')} onSelect={() => onSelect('media')} />
          <Item icon={Camera} label={t('chat_attachments.screenshot_capture')} onSelect={() => onSelect('photo')} />

          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger
              className={cn(
                'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 outline-none transition-colors',
                'text-[13px] text-text-primary',
                'data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
                'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
              )}
            >
              <ScanLine className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span className="flex-1 truncate">{t('chat_attachments.screenshot')}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                sideOffset={6}
                className={cn(
                  'z-50 w-[208px] rounded-xl',
                  'border border-border-default bg-bg-elevated',
                  'p-1.5 shadow-xl',
                  'data-[state=open]:animate-in data-[state=closed]:animate-out',
                  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
                )}
              >
                <Item icon={Monitor} label={t('chat_attachments.screenshot_screen')} onSelect={() => onSelect('screenshot-screen')} />
                <Item icon={AppWindow} label={t('chat_attachments.screenshot_window')} onSelect={() => onSelect('screenshot-window')} />
                <Item icon={Crop} label={t('chat_attachments.screenshot_area')} onSelect={() => onSelect('screenshot-area')} />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface ItemProps {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

function Item({ icon: Icon, label, onSelect }: ItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 outline-none transition-colors',
        'text-[13px] text-text-primary',
        'data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
    </DropdownMenu.Item>
  );
}
