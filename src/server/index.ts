import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildServer } from './api.js';
import type { RunDispatcher } from './dispatch.js';
import { runsRoot, statePath } from '../state/paths.js';
import { StateSchema } from '../state/schema.js';
import { applyConfigToEnv } from '../state/config.js';

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

/**
 * Scan all runs at server boot and restart any auto-iterate loop that was
 * in-flight when the server last stopped. Fires and forgets each restart so
 * the server is never delayed from accepting HTTP requests.
 */
export async function resumeAutoIterates(dispatcher: RunDispatcher): Promise<void> {
  const entries = await fs.readdir(runsRoot(), { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    // runsRoot doesn't exist yet — nothing to resume
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;

    let raw: string;
    try {
      raw = await fs.readFile(statePath(runId), 'utf8');
    } catch {
      continue;
    }

    let parseResult: ReturnType<typeof StateSchema.safeParse>;
    try {
      parseResult = StateSchema.safeParse(JSON.parse(raw));
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[resume] skipping ${runId}: could not parse state.json`);
      continue;
    }

    if (!parseResult.success) {
      // eslint-disable-next-line no-console
      console.warn(`[resume] skipping ${runId}: state.json does not match schema`);
      continue;
    }

    const s = parseResult.data;
    if (s.auto_iterate && s.status === 'in_progress' && s.next_role !== 'done') {
      // eslint-disable-next-line no-console
      console.log(
        `[resume] run ${runId} resuming auto-iterate at sprint ${s.current_sprint}, next=${s.next_role}`
      );
      dispatcher.startAutoIterate(runId).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(`[resume] auto-iterate for ${runId} failed:`, err);
      });
    }
  }
}

export async function serve(opts: ServeOptions = {}): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const port = opts.port ?? 8787;
  const host = opts.host ?? '127.0.0.1';
  // Hydrate ANTHROPIC_API_KEY from ~/.agent-harness/config.json before the
  // server (and any SDK call it makes) starts. The env var always wins.
  await applyConfigToEnv();
  const webDist = opts.webDist ?? defaultWebDist();
  if (webDist) {
    // Soft existence check (just for the log line).
    await fs.access(webDist).catch(() => {
      // It's OK — the server will render a placeholder.
    });
  }

  const { app, watcher, dispatcher } = await buildServer({ webDist, logger: false });
  await app.listen({ port, host });
  void resumeAutoIterates(dispatcher);
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
