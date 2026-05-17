import { avatarColorForLogin } from '@pyn/core';
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
  /**
   * Login юзера — используется как seed для детерминированного цвета фона
   * (когда аватарка не загружена). Один и тот же login всегда даёт один и
   * тот же цвет, 1:1 c Kotlin `AvatarColors` палитрой. Если не передан —
   * fallback на accent-clay.
   */
  login?: string;
}

/**
 * Круглый аватар. Если есть `avatarUrl` + `avatarBlobKey` — пытается
 * расшифровать зашифрованный blob и показать `<img>`. Пока грузится или
 * при ошибке — fallback на инициалы на фоне детерминированного цвета
 * (по `login`) — как в Kotlin-клиенте OTLHelper2.
 */
export function Avatar({
  initials,
  size = 28,
  className,
  avatarUrl,
  avatarBlobKey,
  avatarBlobNonce,
  login,
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

  // Цвет фона — детерминированный по login (Kotlin parity). Без login'a
  // используем `accent-clay` как нейтральный fallback.
  const bgColor = login ? avatarColorForLogin(login) : undefined;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'text-white font-medium select-none',
        bgColor ? '' : 'bg-accent-clay',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ...(bgColor ? { backgroundColor: bgColor } : {}),
      }}
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}
