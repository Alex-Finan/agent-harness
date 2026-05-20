import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLogger } from '../../src/lib/logger.js';

describe('logger', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-log-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writes JSON lines to file', async () => {
    const logFile = path.join(tmp, 'h.log');
    const log = createLogger({ file: logFile, stdout: false });
    await log.info('hello', { a: 1 });
    await log.flush();
    const content = await fs.readFile(logFile, 'utf8');
    const line = JSON.parse(content.trim());
    expect(line.level).toBe('info');
    expect(line.msg).toBe('hello');
    expect(line.a).toBe(1);
    expect(typeof line.ts).toBe('string');
  });

  test('appends multiple lines', async () => {
    const logFile = path.join(tmp, 'h.log');
    const log = createLogger({ file: logFile, stdout: false });
    await log.info('a');
    await log.error('b');
    await log.flush();
    const lines = (await fs.readFile(logFile, 'utf8')).trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).msg).toBe('a');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });
});
