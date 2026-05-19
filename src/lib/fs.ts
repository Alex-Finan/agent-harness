import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeAtomic(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

export async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
