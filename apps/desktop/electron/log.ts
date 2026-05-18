import { app } from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

/**
 * §v1.2.8 — Main-process логи в файл.
 *
 * В production exe stdout/stderr закрыты, поэтому `console.log` из main
 * процесса юзеру не видны. Без этого диагностика любых проблем main
 * процесса невозможна (network calls, IPC errors, webview events).
 *
 * Файл: `<userData>/logs/main-YYYYMMDD-HHMMSS.log`. По одному файлу на
 * запуск — rotate не нужен, удалять старые юзер может вручную.
 *
 * Перехватывает console.log/warn/error на module-level, ДО любого
 * другого импорта (call в самом начале main.ts).
 */

let stream: WriteStream | null = null;
let logFilePath: string | null = null;

function pad(n: number, width = 2): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function timestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function stringify(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try { return JSON.stringify(arg); }
  catch { return String(arg); }
}

function writeLine(level: string, args: unknown[]): void {
  if (!stream) return;
  try {
    stream.write(`${timestamp()} [${level}] ${args.map(stringify).join(' ')}\n`);
  } catch (_) { /* file system errors — ничего не делаем */ }
}

export function setupMainLog(): void {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const d = new Date();
    const fileName = `main-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.log`;
    logFilePath = path.join(logsDir, fileName);
    stream = createWriteStream(logFilePath, { flags: 'a' });

    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    const origInfo = console.info.bind(console);

    console.log = (...args: unknown[]) => { origLog(...args); writeLine('LOG', args); };
    console.warn = (...args: unknown[]) => { origWarn(...args); writeLine('WARN', args); };
    console.error = (...args: unknown[]) => { origErr(...args); writeLine('ERR', args); };
    console.info = (...args: unknown[]) => { origInfo(...args); writeLine('INFO', args); };

    console.log(`[main-log] started → ${logFilePath}`);
  } catch (e) {
    // Файл-логи не критичны. Если стрим не открылся — продолжаем без них.
    try { console.error('[main-log] setup failed:', e); } catch (_) { /* */ }
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}
