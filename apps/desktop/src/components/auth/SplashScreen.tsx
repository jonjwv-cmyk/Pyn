import type { CSSProperties } from 'react';

interface SplashScreenProps {
  /**
   * Target Y-offset для lift анимации (px от центра viewport). Высчитан в
   * App.tsx из getBoundingClientRect PynMarkIcon — точная позиция, куда
   * должна приземлиться иконка. Если null — fallback в CSS keyframe.
   */
  targetY: number | null;
  /**
   * Абсолютная Y-позиция центра иконки от верха viewport (px). Передаётся
   * как CSS var `--splash-icon-y` на splash-root (cascade ко всем детям) —
   * используется в clip-path keyframes для pattern-reveal и card-reveal.
   */
  iconCenterY: number | null;
}

/**
 * §pyn-1.2.54 — splash на запуск приложения.
 *
 * Анимация (~5.4s total):
 *   1. 0-0.85s   — три полоски Pyn-mark залетают и собираются (200×200 mark).
 *   2. 0.85-1.20s — hold.
 *   3. 1.20-1.70s — shrink В ЦЕНТРЕ (200→56px).
 *   4. 1.70-2.65s — lift иконки вверх к позиции PynMarkIcon.
 *   5. 2.65-3.00s — hold (юзер видит icon на месте).
 *   6. 3.00-4.20s — pattern-reveal: подложка LoginScreen «рассеивается»
 *                   из-за рамок иконки наружу через clip-path expansion.
 *   7. 4.20-5.40s — card reveal: окно входа «вытекает» из иконки.
 */
export function SplashScreen({
  targetY,
  iconCenterY,
}: SplashScreenProps): JSX.Element {
  // §pyn-1.2.54 — fallback -170px если measurement ещё не готов; mark
  // рендерится всегда чтобы юзер видел анимацию даже на edge cases.
  const effectiveY = targetY ?? -170;
  const markStyle = {
    ['--splash-target-y' as never]: `${effectiveY}px`,
  } as CSSProperties;
  // §pyn-1.2.54 — --splash-icon-y на splash-root → cascade ко всем детям
  // (splash-pattern-reveal использует в clip-path keyframes для расчёта
  // icon-area inset'ов).
  const rootStyle: CSSProperties =
    iconCenterY !== null
      ? ({ ['--splash-icon-y' as never]: `${iconCenterY}px` } as CSSProperties)
      : {};

  return (
    <div className="splash-root" style={rootStyle}>
      {/* §pyn-1.2.54 — однотонный тёмный фон #161611 на всё время splash'a
          (и в LoginScreen тот же color через .login-pattern-bg override).
          Никаких pattern shapes, чтобы splash и LoginScreen визуально были
          одним dark canvas. Splash-mark — иконка поверх фона, после её
          сборки рисуется outline orange по часовой стрелке, отделяющий
          иконку от bg. */}
      <div className="splash-bg" />
      <div className="splash-mark" style={markStyle}>
        <div className="splash-stem" />
        <div className="splash-top-bow" />
        <div className="splash-mid-bow" />
        {/* §pyn-1.2.54 — outline отрисовывается по часовой стрелке (SVG path
            stroke с animated dashoffset 100→0). Стартует когда mark уже на
            icon position, orange #D97757 — accent цвет приложения. Отделяет
            рамку иконки от фона того же цвета. После завершения отрисовки
            outline затухает, поскольку pattern-bg fades-in и mark становится
            visible через color difference уже без необходимости в outline. */}
        <svg
          className="splash-mark-outline"
          viewBox="0 0 56 56"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {/* §pyn-1.2.54 — ДВЕ линии стартуют с диагонально ПРОТИВОПОЛОЖНЫХ
              углов (top-left и bottom-right) и идут по часовой стрелке,
              каждая covering половину периметра. Смыкаются в других двух
              углах (top-right ↔ bottom-left). pathLength=100 на каждой
              для синхронизации. */}
          {/* Половина 1: from top-left (16, 0) → top → right side → bottom-right (40, 56) */}
          <path
            d="M 16 0 L 40 0 A 16 16 0 0 1 56 16 L 56 40 A 16 16 0 0 1 40 56"
            pathLength={100}
          />
          {/* Половина 2: from bottom-right (40, 56) → bottom → left side → top-left (16, 0) */}
          <path
            d="M 40 56 L 16 56 A 16 16 0 0 1 0 40 L 0 16 A 16 16 0 0 1 16 0"
            pathLength={100}
          />
        </svg>
      </div>
    </div>
  );
}
