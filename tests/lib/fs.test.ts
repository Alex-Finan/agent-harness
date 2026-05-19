import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeAtomic, readOrNull, ensureDir } from '../../src/lib/fs.js';

describe('lib/fs', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writeAtomic creates parent dirs and writes file', async () => {
    const target = path.join(tmp, 'nested/dir/file.txt');
    await writeAtomic(target, 'hello');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello');
  });

  test('writeAtomic overwrites existing file', async () => {
    const target = path.join(tmp, 'file.txt');
    await writeAtomic(target, 'first');
    await writeAtomic(target, 'second');
    expect(await fs.readFile(target, 'utf8')).toBe('second');
  });

  test('readOrNull returns null for missing file', async () => {
    expect(await readOrNull(path.join(tmp, 'nope'))).toBeNull();
  });

  test('readOrNull returns contents when file exists', async () => {
    const target = path.join(tmp, 'a.txt');
    await fs.writeFile(target, 'hi');
    expect(await readOrNull(target)).toBe('hi');
  });

  test('ensureDir is idempotent', async () => {
    const d = path.join(tmp, 'a/b/c');
    await ensureDir(d);
    await ensureDir(d);
    const stat = await fs.stat(d);
    expect(stat.isDirectory()).toBe(true);
  });
});
