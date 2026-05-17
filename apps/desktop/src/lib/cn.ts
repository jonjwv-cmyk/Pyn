import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Утилита для конкатенации className. Сначала clsx собирает массив, затем
 * tailwind-merge убирает конфликты (например `px-4 px-6` → `px-6`).
 *
 * Использование:
 *   <div className={cn('text-text-strong', isActive && 'bg-accent-clay')} />
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
