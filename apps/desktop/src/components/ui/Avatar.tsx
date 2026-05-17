import { cn } from '@/lib/cn';
import { useDecryptedBlob } from '@/lib/avatar';

interface AvatarProps {
  /** 1-2 буквы (имя/логин). Авто-uppercase, truncate до 2 символов. */
  initials: string;
  /** Diameter в px. По умолчанию 28. */
  size?: number;
  className?: string;
  /** URL зашифрованной картинки (`/a/<id>?v=...`). Если null — показываем initials. */
  avatarUrl?: string;
  /** Base64 AES-256 key (32 bytes). Без него decrypt'ать нечем. */
  avatarBlobKey?: string;
  /** Base64 12-byte nonce (sanity check vs envelope). */
  avatarBlobNonce?: string;
}

/**
 * Круглый аватар. Если есть `avatarUrl` + `avatarBlobKey` — пытается
 * расшифровать зашифрованный blob и показать `<img>`. Пока грузится или
 * при ошибке — fallback на инициалы.
 *
 * Используется в sidebar, conversation header, chat list rows, news cards и т.п.
 */
export function Avatar({
  initials,
  size = 28,
  className,
  avatarUrl,
  avatarBlobKey,
  avatarBlobNonce,
}: AvatarProps) {
  const blobUrl = useDecryptedBlob(avatarUrl, avatarBlobKey, avatarBlobNonce);

  if (blobUrl) {
    return (
      <img
        src={blobUrl}
        alt={initials}
        className={cn('inline-block shrink-0 rounded-full object-cover select-none', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-accent-clay text-white font-medium select-none',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}
