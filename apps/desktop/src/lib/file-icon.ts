import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FileType2,
  Folder,
  Mail,
  Send,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon + цветовая палитра chip-стиль для файлового проводника.
 * Figma-vibe: маленький rounded-square background (color/15 fill) с
 * тёмным glyph внутри (color text). Папки — без bg, нейтральный fold icon.
 */
export interface FileIconSpec {
  Icon: LucideIcon;
  /** Tailwind класс для цвета иконки (text-...). */
  iconColor: string;
  /** Tailwind для фона chip (bg-.../15). */
  bgColor: string;
}

const SPEC_FOLDER: FileIconSpec = {
  Icon: Folder,
  iconColor: 'text-accent-clay',
  bgColor: 'bg-accent-clay-bg',
};

const SPEC_DEFAULT: FileIconSpec = {
  Icon: File,
  iconColor: 'text-text-secondary',
  bgColor: 'bg-bg-pressed',
};

/**
 * §pyn-1.2.21 — hint позволяет переопределить визуал для контекстных секций:
 *   - `mailing`: .msg/.eml превращаются в Send (отправляемое письмо)
 *     amber-цветом — это рассылка ПО дням недели, не входящая корреспонденция
 *     (а Согласование — стандартный Mail blue, входящие на согласование).
 */
export function fileIconSpec(
  name: string,
  isDirectory: boolean,
  hint?: 'mailing' | 'consent',
): FileIconSpec {
  if (isDirectory) return SPEC_FOLDER;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'ods'].includes(ext)) {
    return { Icon: FileSpreadsheet, iconColor: 'text-emerald-400', bgColor: 'bg-emerald-500/15' };
  }
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) {
    return { Icon: FileText, iconColor: 'text-sky-400', bgColor: 'bg-sky-500/15' };
  }
  if (ext === 'pdf') {
    return { Icon: FileType2, iconColor: 'text-accent-clay', bgColor: 'bg-accent-clay-bg' };
  }
  if (['msg', 'eml', 'mbox', 'oft'].includes(ext)) {
    if (hint === 'mailing') {
      return { Icon: Send, iconColor: 'text-amber-400', bgColor: 'bg-amber-500/15' };
    }
    return { Icon: Mail, iconColor: 'text-blue-400', bgColor: 'bg-blue-500/15' };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic'].includes(ext)) {
    return { Icon: FileImage, iconColor: 'text-violet-400', bgColor: 'bg-violet-500/15' };
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
    return { Icon: FileAudio, iconColor: 'text-teal-400', bgColor: 'bg-teal-500/15' };
  }
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return { Icon: FileVideo, iconColor: 'text-rose-400', bgColor: 'bg-rose-500/15' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
    return { Icon: FileArchive, iconColor: 'text-amber-400', bgColor: 'bg-amber-500/15' };
  }
  return SPEC_DEFAULT;
}
