import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleList } from '../cli/commands/list.js';
import { loadRun, saveState } from '../state/run.js';
import { runDir, planPath, sprintsDir, harnessHome } from '../state/paths.js';
import { writeAtomic, readOrNull } from '../lib/fs.js';
import { VERSION } from '../index.js';
import { parseSprintsFromPlan } from '../state/artifacts.js';
import { readRunSnapshot, readTranscript } from './readers.js';
import { readAllPrompts, writePrompt, isPromptName } from './prompts.js';
import { computeRunCost } from './cost.js';
import { EventBus } from './events.js';
import { HarnessWatcher } from './watcher.js';
import { RunDispatcher } from './dispatch.js';
import { listRepos } from './repos.js';

export interface BuildServerOptions {
  webDist?: string;
  logger?: boolean;
}

const InitBody = z.object({
  repo: z.string().min(1),
  task: z.string().min(1),
  maxRetries: z.number().int().positive().default(3),
  base: z.string().optional(),
  branch: z.string().optional()
});

const PlanBody = z.object({
  planMd: z.string().min(1)
});

const PlanReviseBody = z.object({
  message: z.string().min(1)
});

const ContractBody = z.object({
  contractMd: z.string()
});

const PromptBody = z.object({
  content: z.string()
});

export async function buildServer(opts: BuildServerOptions = {}): Promise<{
  app: FastifyInstance;
  bus: EventBus;
  watcher: HarnessWatcher;
  dispatcher: RunDispatcher;
}> {
  const app = Fastify({ logger: opts.logger ?? false });
  const bus = new EventBus();
  const watcher = new HarnessWatcher(bus);
  const dispatcher = new RunDispatcher(bus);

  await watcher.start();

  // -------------------- Meta --------------------
  app.get('/api/meta', async () => ({
    version: VERSION,
    harnessHome: harnessHome()
  }));

  // -------------------- Runs --------------------
  app.get('/api/runs', async () => {
    const { runs } = await handleList();
    // Attach lightweight cost summary so the sidebar can show $.
    const withCosts = await Promise.all(
      runs.map(async (r) => {
        const cost = await computeRunCost(r.run_id);
        const dispatching = dispatcher.current(r.run_id);
        return {
          ...r,
          cost_total_usd: cost.totalUsd,
          dispatching: dispatching && !dispatching.finished ? dispatching.role : null
        };
      })
    );
    return { runs: withCosts };
  });

  app.post('/api/runs', async (req, reply) => {
    const parsed = InitBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const result = await dispatcher.createRun(parsed.data);
    // Surface a state event right after creation.
    try {
      const run = await loadRun(result.runId);
      bus.publish({ type: 'run_created', runId: result.runId, state: run.state });
    } catch {
      /* ignore */
    }
    return result;
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const run = await loadRun(id);
      const snapshot = await readRunSnapshot(id);
      const sprintsInPlan = snapshot.planMd ? parseSprintsFromPlan(snapshot.planMd) : [];
      const cost = await computeRunCost(id);
      const dispatching = dispatcher.current(id);
      return {
        state: run.state,
        snapshot,
        sprintsInPlan,
        cost,
        dispatching: dispatching
          ? {
              role: dispatching.role,
              startedAt: dispatching.startedAt,
              finished: dispatching.finished,
              error: dispatching.error
            }
          : null
      };
    } catch (err) {
      reply.code(404);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/runs/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (dispatcher.isBusy(id)) {
      reply.code(409);
      return { error: 'run already has an in-flight role' };
    }
    const handle = await dispatcher.startPlan(id);
    return { runId: id, role: handle.role, startedAt: handle.startedAt };
  });

  app.post('/api/runs/:id/next', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (dispatcher.isBusy(id)) {
      reply.code(409);
      return { error: 'run already has an in-flight role' };
    }
    const handle = await dispatcher.startNext(id);
    return { runId: id, role: handle.role, startedAt: handle.startedAt };
  });

  app.post('/api/runs/:id/plan/revise', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PlanReviseBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    if (dispatcher.isBusy(id)) {
      reply.code(409);
      return { error: 'run already has an in-flight role' };
    }
    const handle = await dispatcher.startPlanRevise(id, parsed.data.message);
    return { runId: id, role: handle.role, startedAt: handle.startedAt };
  });

  app.post('/api/runs/:id/auto', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (dispatcher.isBusy(id)) {
      reply.code(409);
      return { error: 'run already has an in-flight role' };
    }
    const handle = await dispatcher.startAutoIterate(id);
    return { runId: id, role: handle.role, startedAt: handle.startedAt };
  });

  app.post('/api/runs/:id/abort', async (req) => {
    const { id } = req.params as { id: string };
    await dispatcher.abort(id);
    return { ok: true };
  });

  // Update plan.md (operator-edited). Re-parses sprint count and updates state.
  app.put('/api/runs/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PlanBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    await writeAtomic(planPath(id), parsed.data.planMd);

    // Best-effort: if the run is still pre-execution (next_role=executor at
    // sprint 1 or planner), update total_sprints to match the edited plan.
    const sprints = parseSprintsFromPlan(parsed.data.planMd);
    try {
      const run = await loadRun(id);
      if (
        run.state.next_role === 'planner' ||
        (run.state.next_role === 'executor' && run.state.current_sprint <= 1)
      ) {
        await saveState({
          ...run.state,
          total_sprints: sprints.length,
          updated_at: new Date().toISOString()
        });
      }
    } catch {
      /* run may not exist */
    }
    return { ok: true, sprints: sprints.length };
  });

  app.put('/api/runs/:id/sprints/:sprint/contract', async (req, reply) => {
    const { id, sprint } = req.params as { id: string; sprint: string };
    const parsed = ContractBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    if (!/^[a-z0-9_\-]+$/i.test(sprint)) {
      reply.code(400);
      return { error: 'invalid sprint dir name' };
    }
    const target = path.join(sprintsDir(id), sprint, 'contract.md');
    await writeAtomic(target, parsed.data.contractMd);
    return { ok: true };
  });

  app.get('/api/runs/:id/transcripts/:log', async (req, reply) => {
    const { id, log } = req.params as { id: string; log: string };
    try {
      const transcript = await readTranscript(id, log);
      return transcript;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/runs/:id/cost', async (req) => {
    const { id } = req.params as { id: string };
    return computeRunCost(id);
  });

  // -------------------- Prompts (global) --------------------
  app.get('/api/prompts', async () => {
    return readAllPrompts();
  });

  app.put('/api/prompts/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isPromptName(name)) {
      reply.code(400);
      return { error: 'invalid prompt name' };
    }
    const parsed = PromptBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    await writePrompt(name, parsed.data.content);
    return { ok: true };
  });

  // -------------------- Repos --------------------
  app.get('/api/repos', async (req) => {
    const { refresh } = (req.query as { refresh?: string }) ?? {};
    return listRepos({ force: refresh === '1' || refresh === 'true' });
  });

  // -------------------- SSE --------------------
  app.get('/api/events', (req, reply) => {
    const { run } = (req.query as { run?: string }) ?? {};
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.write(`: connected\n\n`);
    reply.raw.write(
      `data: ${JSON.stringify({ type: 'hello', serverVersion: VERSION })}\n\n`
    );
    const unsubscribe = bus.subscribe(reply, run);
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        /* ignore */
      }
    }, 25000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    });
  });

  // -------------------- Static frontend --------------------
  if (opts.webDist) {
    const dist = opts.webDist;
    const distExists = await fs.access(dist).then(() => true).catch(() => false);
    if (!distExists) {
      app.get('/', async (_req, reply) => {
        reply.type('text/html').send(placeholderHtml());
      });
    } else {
      app.get('/*', async (req, reply) => {
        const urlPath = (req.params as { '*': string })['*'] || '';
        if (urlPath.startsWith('api')) {
          reply.code(404);
          return { error: 'not found' };
        }
        const candidate = path.join(dist, urlPath);
        const resolved = path.resolve(candidate);
        if (!resolved.startsWith(path.resolve(dist))) {
          reply.code(403);
          return { error: 'forbidden' };
        }
        const stat = await fs.stat(resolved).catch(() => null);
        if (stat && stat.isFile()) {
          reply.type(contentType(resolved));
          return fs.readFile(resolved);
        }
        const indexHtml = path.join(dist, 'index.html');
        const content = await fs.readFile(indexHtml).catch(() => null);
        if (!content) {
          reply.code(404);
          return { error: 'frontend not built' };
        }
        reply.type('text/html');
        return content;
      });
    }
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(placeholderHtml());
    });
  }

  return { app, bus, watcher, dispatcher };
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function placeholderHtml(): string {
  return `<!doctype html><html><head><title>agent-harness</title></head><body>
<h1>agent-harness server</h1>
<p>The web UI bundle was not found. Build it with:</p>
<pre>cd web && npm install && npm run build</pre>
<p>API is available under <code>/api/*</code>. Live event stream at <code>/api/events</code>.</p>
</body></html>`;
}

void runDir;
void readOrNull;
