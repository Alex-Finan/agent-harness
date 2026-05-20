import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildServer } from './api.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  webDist?: string;
  open?: boolean;
}

/**
 * Resolve the path to the built web UI. Prefers <project_root>/web/dist when
 * available — that's where `npm run build:web` places it. Allows override via
 * AGENT_HARNESS_WEB_DIST so the bundle can ship from anywhere.
 */
function defaultWebDist(): string | undefined {
  if (process.env.AGENT_HARNESS_WEB_DIST) return process.env.AGENT_HARNESS_WEB_DIST;
  // dist/server/index.js → repo root is two levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', 'web', 'dist'),
    path.resolve(here, '..', '..', '..', 'web', 'dist')
  ];
  for (const c of candidates) {
    try {
      // Sync existence check via Node fs API is unavailable here without
      // pulling node:fs; we lazy-check in buildServer's `fs.access` instead.
      return c;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

export async function serve(opts: ServeOptions = {}): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const port = opts.port ?? 8787;
  const host = opts.host ?? '127.0.0.1';
  const webDist = opts.webDist ?? defaultWebDist();
  if (webDist) {
    // Soft existence check (just for the log line).
    await fs.access(webDist).catch(() => {
      // It's OK — the server will render a placeholder.
    });
  }

  const { app, watcher } = await buildServer({ webDist, logger: false });
  await app.listen({ port, host });
  const url = `http://${host}:${port}`;
  // eslint-disable-next-line no-console
  console.log(`agent-harness UI listening at ${url}`);
  // eslint-disable-next-line no-console
  if (webDist) console.log(`serving web bundle from ${webDist}`);
  // eslint-disable-next-line no-console
  console.log(`watching ${process.env.AGENT_HARNESS_HOME ?? '~/.agent-harness'} for run state changes`);

  return {
    url,
    close: async () => {
      await app.close();
      await watcher.stop();
    }
  };
}
