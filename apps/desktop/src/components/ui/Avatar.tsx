import { cn } from '@/lib/cn';
import { useDecryptedBlob } from '@/lib/avatar';
import { DefaultAvatarSprite } from './DefaultAvatarSprite';

interface AvatarProps {
  /** 1-2 буквы (имя/логин). Fallback если нет login для дефолтной картинки. */
  initials: string;
  /** Diameter в px. По умолчанию 28. */
  size?: number;
  className?: string;
  /** URL зашифрованной картинки (`/a/<id>?v=...`). Только с blobKey. */
  avatarUrl?: string;
  /** Base64 AES-256 key (32 bytes). Без него — встроенная дефолтная аватарка. */
  avatarBlobKey?: string;
  /** Base64 12-byte nonce (sanity check vs envelope). */
  avatarBlobNonce?: string;
  /** Login — seed для детерминированной встроенной аватарки (без своего фото). */
  login?: string;
}

/**
 * Круглый аватар. Своя картинка (url + blobKey) → расшифровка и `<img>`.
 * Без своего фото → одна из 12 встроенных mascots по login (всегда одинаково).
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
  const hasCustomAvatar = !!(avatarUrl?.trim() && avatarBlobKey?.trim());
  const blobUrl = useDecryptedBlob(
    hasCustomAvatar ? avatarUrl : undefined,
    hasCustomAvatar ? avatarBlobKey : undefined,
    hasCustomAvatar ? avatarBlobNonce : undefined,
  );

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

  if (login) {
    return <DefaultAvatarSprite login={login} size={size} className={className} />;
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-clay',
        'font-medium text-white select-none',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}