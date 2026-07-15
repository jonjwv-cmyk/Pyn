import { defaultAvatarIndex, DEFAULT_AVATAR_COUNT } from '@pyn/core';
import { cn } from '@/lib/cn';

type SpriteFn = (props: { size: number }) => JSX.Element;

/** Встроенные лёгкие аватарки (SF-style mascots) — без R2, детерминированно по login. */
const SPRITES: readonly SpriteFn[] = [
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#FDE8D8" />
      <circle cx="32" cy="34" r="18" fill="#F4A261" />
      <circle cx="26" cy="32" r="2.5" fill="#2D2A26" />
      <circle cx="38" cy="32" r="2.5" fill="#2D2A26" />
      <path d="M24 38 Q32 44 40 38" stroke="#2D2A26" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#D8F0F4" />
      <rect x="18" y="20" width="28" height="26" rx="8" fill="#2A9D8F" />
      <rect x="22" y="28" width="8" height="8" rx="2" fill="#E8FFFC" />
      <rect x="34" y="28" width="8" height="8" rx="2" fill="#E8FFFC" />
      <rect x="26" y="40" width="12" height="3" rx="1.5" fill="#1D6F64" />
      <rect x="28" y="14" width="8" height="8" rx="2" fill="#2A9D8F" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#EDE4F7" />
      <circle cx="32" cy="36" r="16" fill="#9B72CF" />
      <polygon points="20,24 26,14 32,24" fill="#9B72CF" />
      <polygon points="32,24 38,14 44,24" fill="#9B72CF" />
      <circle cx="27" cy="35" r="2" fill="#FFF" />
      <circle cx="37" cy="35" r="2" fill="#FFF" />
      <ellipse cx="32" cy="40" rx="3" ry="2" fill="#6B4F99" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#DFF5E4" />
      <ellipse cx="32" cy="38" rx="20" ry="16" fill="#52B788" />
      <circle cx="24" cy="32" r="5" fill="#FFF" opacity="0.35" />
      <circle cx="26" cy="34" r="2.5" fill="#1B4332" />
      <circle cx="38" cy="34" r="2.5" fill="#1B4332" />
      <path d="M28 42 Q32 45 36 42" stroke="#1B4332" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#D8E8F8" />
      <ellipse cx="32" cy="40" rx="18" ry="14" fill="#457B9D" />
      <circle cx="32" cy="28" r="12" fill="#457B9D" />
      <ellipse cx="32" cy="30" rx="8" ry="7" fill="#F1FAFF" />
      <circle cx="28" cy="28" r="2" fill="#1D3557" />
      <circle cx="36" cy="28" r="2" fill="#1D3557" />
      <polygon points="32,18 26,24 38,24" fill="#F4A261" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#FCE8EF" />
      <circle cx="32" cy="36" r="17" fill="#E07A9A" />
      <ellipse cx="20" cy="30" rx="6" ry="10" fill="#E07A9A" />
      <ellipse cx="44" cy="30" rx="6" ry="10" fill="#E07A9A" />
      <circle cx="27" cy="35" r="2" fill="#FFF" />
      <circle cx="37" cy="35" r="2" fill="#FFF" />
      <circle cx="32" cy="40" r="2.5" fill="#9D3D5C" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#FFF5D6" />
      <circle cx="32" cy="36" r="17" fill="#F4D35E" />
      <circle cx="27" cy="34" r="2.5" fill="#3D3A32" />
      <circle cx="37" cy="34" r="2.5" fill="#3D3A32" />
      <polygon points="32,18 24,28 40,28" fill="#E09F3E" />
      <path d="M28 40 Q32 43 36 40" stroke="#3D3A32" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#E8E4F8" />
      <circle cx="32" cy="34" r="18" fill="#6C63FF" />
      <circle cx="26" cy="32" r="6" fill="#FFF" />
      <circle cx="38" cy="32" r="6" fill="#FFF" />
      <circle cx="26" cy="32" r="2.5" fill="#2D2A4A" />
      <circle cx="38" cy="32" r="2.5" fill="#2D2A4A" />
      <polygon points="32,16 28,22 36,22" fill="#6C63FF" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#F8E8DC" />
      <circle cx="32" cy="36" r="17" fill="#C97B63" />
      <circle cx="22" cy="22" r="7" fill="#C97B63" />
      <circle cx="42" cy="22" r="7" fill="#C97B63" />
      <circle cx="27" cy="36" r="2" fill="#FFF" />
      <circle cx="37" cy="36" r="2" fill="#FFF" />
      <ellipse cx="32" cy="41" rx="4" ry="2.5" fill="#7A4E3B" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#D8F2FA" />
      <ellipse cx="32" cy="38" rx="14" ry="16" fill="#48CAE4" />
      <circle cx="32" cy="22" r="10" fill="#48CAE4" />
      <circle cx="28" cy="20" r="3" fill="#023E8A" />
      <circle cx="36" cy="20" r="3" fill="#023E8A" />
      <line x1="32" y1="10" x2="32" y2="4" stroke="#48CAE4" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="4" r="3" fill="#90E0EF" />
    </svg>
  ),
  ({ size }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="32" fill="#E4F2E4" />
      <circle cx="32" cy="36" r="17" fill="#7CB87C" />
      <circle cx="22" cy="28" r="9" fill="#A8D5A8" />
      <circle cx="42" cy="28" r="9" fill="#A8D5A8" />
      <circle cx="27" cy="36" r="2.5" fill="#2D4A2D" />
      <circle cx="37" cy="36" r="2.5" fill="#2D4A2D" />
      <ellipse cx="32" cy="41" rx="5" ry="3" fill="#4A6B4A" />
    </svg>
  ),
];

export function DefaultAvatarSprite({
  login,
  index,
  size,
  className,
}: {
  login?: string;
  index?: number;
  size: number;
  className?: string;
}): JSX.Element {
  const idx = index ?? (login ? defaultAvatarIndex(login) : 0);
  const safe = ((idx % DEFAULT_AVATAR_COUNT) + DEFAULT_AVATAR_COUNT) % DEFAULT_AVATAR_COUNT;
  const Sprite = SPRITES[safe] ?? SPRITES[0]!;
  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-full select-none', className)}
      style={{ width: size, height: size }}
    >
      {Sprite({ size })}
    </span>
  );
}