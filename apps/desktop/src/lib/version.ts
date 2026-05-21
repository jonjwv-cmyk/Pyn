/**
 * Сравнение semver-like версий `MAJOR.MINOR.PATCH`. Возвращает 1 если a>b,
 * -1 если a<b, 0 если равны. Pre-release / build-metadata игнорируются
 * (сервер их не использует).
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

/**
 * Server-side error codes, означающие что сохранённый токен больше не
 * принимается → надо чистить store и просить relogin. Прочие коды (network,
 * replay_detected, invalid_envelope, etc) — transient, сессию не трогаем.
 */
const AUTH_FAILURE_CODES = new Set<string>([
  'unauthorized',
  'token_revoked',
  'token_expired',
  'session_not_found',
  'session_expired_window',
  'desktop_kicked',
  'user_inactive',
  'user_suspended',
]);

export function isAuthFailure(code: string): boolean {
  return AUTH_FAILURE_CODES.has(code);
}

/**
 * desktop-win / desktop-mac в зависимости от платформы process.
 */
export function getDesktopScope(): 'desktop-win' | 'desktop-mac' {
  return window.pyn?.platform === 'win32' ? 'desktop-win' : 'desktop-mac';
}
