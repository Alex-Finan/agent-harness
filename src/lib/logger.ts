import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir } from './fs.js';

export interface LoggerOptions {
  file?: string;
  stdout?: boolean;
}

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): Promise<void>;
  error(msg: string, extra?: Record<string, unknown>): Promise<void>;
  debug(msg: string, extra?: Record<string, unknown>): Promise<void>;
  flush(): Promise<void>;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const useStdout = opts.stdout !== false;
  const file = opts.file;
  let writes: Promise<void> = Promise.resolve();

  async function emit(level: string, msg: string, extra?: Record<string, unknown>) {
    const record = { ts: new Date().toISOString(), level, msg, ...(extra ?? {}) };
    const line = JSON.stringify(record) + '\n';
    if (useStdout) {
      const human = `[${record.ts}] ${level.toUpperCase()} ${msg}`;
      process.stdout.write(human + '\n');
    }
    if (file) {
      writes = writes.then(async () => {
        await ensureDir(path.dirname(file));
        await fs.appendFile(file, line, 'utf8');
      });
      await writes;
    }
  }

  return {
    info: (m, e) => emit('info', m, e),
    error: (m, e) => emit('error', m, e),
    debug: (m, e) => emit('debug', m, e),
    flush: () => writes,
  };
}
