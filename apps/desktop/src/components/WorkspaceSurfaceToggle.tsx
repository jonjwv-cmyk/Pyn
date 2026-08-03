import { SunMedium, Moon } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  toggleWorkspaceSurface,
  useWorkspaceSurface,
  type WorkspaceSurfaceSection,
} from '@/lib/workspace-surface';

/**
 * Переключатель «темнее / светлее» для одного раздела.
 * Выбор в localStorage: pyn.workspace-surface.<section>.v1
 */
export function WorkspaceSurfaceToggle({
  section,
  className,
}: {
  section: WorkspaceSurfaceSection;
  className?: string;
}): JSX.Element {
  const surface = useWorkspaceSurface(section);
  const paper = surface === 'paper';
  return (
    <button
      type="button"
      title={paper ? 'Тёмнее' : 'Светлее — тёмный текст на тёплом фоне'}
      aria-label={paper ? 'Тёмнее' : 'Светлее'}
      aria-pressed={paper}
      onClick={() => toggleWorkspaceSurface(section)}
      className={cn(
        'no-drag-region flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors',
        paper
          ? 'border-black/20 bg-black/[0.05] text-[#2e2a24] hover:bg-black/[0.09]'
          : 'border-white/10 bg-white/[0.04] text-text-muted hover:border-white/16 hover:bg-white/[0.07] hover:text-text-strong',
        className,
      )}
    >
      {paper ? (
        <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <SunMedium className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      <span className="hidden sm:inline">{paper ? 'Тёмнее' : 'Светлее'}</span>
    </button>
  );
}
