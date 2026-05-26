import { cn } from '@/lib/cn';

interface PynLoaderProps {
  /**
   * Размер loader'a:
   * - sm: 16px (inline в кнопках/pills)
   * - md: 24px (inline labels, indicators)
   * - lg: 40px (dialogs, content placeholders)
   * - xl: 56px (центральные fullscreen loading screens)
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * §pyn-1.2.54 — Pyn-mark loader. 3 полоски залетают с краёв, складываются
 * в логотип, расходятся обратно — infinite loop. Универсальный loading
 * indicator для всего приложения, заменяет spinners (`Loader2 animate-spin`),
 * progress bars и `...` dots.
 *
 * CSS keyframes — `.pyn-loader-*` в `index.css`.
 */
export function PynLoader({ size = 'md', className }: PynLoaderProps): JSX.Element {
  return (
    <div
      className={cn(
        'pyn-loader',
        size === 'sm' && 'pyn-loader-sm',
        size === 'md' && 'pyn-loader-md',
        size === 'lg' && 'pyn-loader-lg',
        size === 'xl' && 'pyn-loader-xl',
        className,
      )}
      role="status"
      aria-label="Loading"
    >
      <div className="pyn-loader-stem" />
      <div className="pyn-loader-top-bow" />
      <div className="pyn-loader-mid-bow" />
    </div>
  );
}
