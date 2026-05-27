import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleList } from '../cli/commands/list.js';
import { loadRun, saveState } from '../state/run.js';
import { runDir, planPath, overviewPath, sprintsDir, harnessHome, trialsDir } from '../state/paths.js';
import { writeAtomic, readOrNull } from '../lib/fs.js';
import { VERSION } from '../index.js';
import { parseSprintsFromPlan } from '../state/artifacts.js';
import { readRunSnapshot, readTranscript, readSprintPips } from './readers.js';
import {
  readPendingComments,
  writePendingComments,
  newCommentId,
  isValidCommentFile,
  type PendingComment
} from '../state/pendingComments.js';
import { readStack, writeStack, type Stack, type StackEntry } from '../state/stack.js';
import { handleInit } from '../cli/commands/init.js';
import { readAllPrompts, writePrompt, isPromptName } from './prompts.js';
import { getApiKeyStatus, setApiKey, clearApiKey } from '../state/config.js';
import { computeRunCost } from './cost.js';
import { EventBus } from './events.js';
import { HarnessWatcher } from './watcher.js';
import { RunDispatcher } from './dispatch.js';
import { listRepos } from './repos.js';
import { ChatManager } from './chat.js';
import {
  readChatComments,
  writeChatComments,
  newChatCommentId,
  type ChatComment
} from '../state/chatComments.js';
import { chatNotesPath } from '../state/paths.js';
import { ChatPermissionModeEnum } from '../state/chatState.js';

export interface BuildServerOptions {
  webDist?: string;
  logger?: boolean;
}

// -------------------- Chat-session request bodies --------------------

const ChatCreateBody = z.object({
  title: z.string().optional(),
  cwd: z.string().min(1),
  model: z.string().optional(),
  permission_mode: ChatPermissionModeEnum.optional()
});

const ChatSendBody = z.object({
  text: z.string().min(1)
});

const ChatNotesBody = z.object({
  notesMd: z.string()
});

const ChatCommentAnchor = z.object({
  start_line: z.number().int().nonnegative(),
  start_col: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  end_col: z.number().int().nonnegative(),
  quoted_text: z.string()
});

const ChatNewCommentBody = z.object({
  message_id: z.string().min(1),
  anchor: ChatCommentAnchor,
  body: z.string().min(1)
});

const ChatPatchCommentBody = z.object({
  body: z.string().min(1)
});

const InitBody = z.object({
  repo: z.string().min(1),
  task: z.string().min(1),
  maxRetries: z.number().int().positive().default(3),
  base: z.string().optional(),
  branch: z.string().optional(),
  // Auto-research fields
  runType: z.enum(['standard', 'auto_research']).optional(),
  experimentDir: z.string().optional(),
  objective: z.string().optional(),
  evaluationCmd: z.string().optional(),
  maxTrials: z.number().int().positive().optional(),
  budgetMinutesPerTrial: z.number().int().positive().optional()
});

const PlanBody = z.object({
  planMd: z.string().min(1)
});

const OverviewBody = z.object({
  overviewMd: z.string().min(1)
});

const PlanReviseBody = z.object({
  // Free-text portion may be empty when the operator is sending only inline
  // comments. The endpoint enforces that comments OR text must be present.
  message: z.string().default('')
});

const ContractBody = z.object({
  contractMd: z.string()
});

const PromptBody = z.object({
  content: z.string()
});

const ConfigBody = z.object({
  anthropic_api_key: z.string().min(1)
});

const CommentAnchor = z.object({
  start_line: z.number().int().nonnegative(),
  start_col: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  end_col: z.number().int().nonnegative(),
  quoted_text: z.string()
});

const NewCommentBody = z.object({
  file: z.string().min(1),
  anchor: CommentAnchor,
  body: z.string().min(1)
});

const PatchCommentBody = z.object({
  body: z.string().min(1)
});

const PatchStackEntryBody = z.object({
  slug: z.string().min(1).optional(),
  base: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  task: z.string().min(1).optional()
});

const SpawnStackBody = z.object({
  autoIterate: z.boolean().default(false)
});

export async function buildServer(opts: BuildServerOptions = {}): Promise<{
  app: FastifyInstance;
  bus: EventBus;
  watcher: HarnessWatcher;
  dispatcher: RunDispatcher;
  chat: ChatManager;
}> {
  const app = Fastify({ logger: opts.logger ?? false });
  const bus = new EventBus();
  const watcher = new HarnessWatcher(bus);
  const dispatcher = new RunDispatcher(bus);
  const chat = new ChatManager(bus);

  await watcher.start();

  // -------------------- Meta --------------------
  app.get('/api/meta', async () => ({
    version: VERSION,
    harnessHome: harnessHome()
  }));

  // -------------------- Runs --------------------
  app.get('/api/runs', async () => {
    const { runs } = await handleList();
    // Attach lightweight cost summary + sprint pips so the sidebar can render
    // per-sprint phase dots without a second round-trip.
    const enriched = await Promise.all(
      runs.map(async (r) => {
        const [cost, sprintPips] = await Promise.all([
          computeRunCost(r.run_id),
          readSprintPips(r.run_id)
        ]);
        const dispatching = dispatcher.current(r.run_id);
        return {
          ...r,
          cost_total_usd: cost.totalUsd,
          dispatching: dispatching && !dispatching.finished ? dispatching.role : null,
          sprint_pips: sprintPips
        };
      })
    );
    return { runs: enriched };
  });

  app.post('/api/runs', async (req, reply) => {
    const parsed = InitBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const { runType, experimentDir, objective, evaluationCmd, maxTrials, budgetMinutesPerTrial, ...baseArgs } = parsed.data;
    const result = await dispatcher.createRun({
      ...baseArgs,
      ...(runType !== undefined && { runType }),
      ...(experimentDir !== undefined && { experimentDir }),
      ...(objective !== undefined && { objective }),
      ...(evaluationCmd !== undefined && { evaluationCmd }),
      ...(maxTrials !== undefined && { maxTrials }),
      ...(budgetMinutesPerTrial !== undefined && { budgetMinutesPerTrial })
    });
    // Surface a state event right after creation.
    try {
      const run = await loadRun(result.runId);
      bus.publish({ type: 'run_created', runId: result.runId, state: run.state });
    } catch {
      /* ignore */
    }
    // Auto-start the sweep when creating an auto_research run.
    if (runType === 'auto_research') {
      try {
        await dispatcher.startAutoResearch(result.runId);
      } catch {
        /* non-fatal: the run is created; sweep can be started via the endpoint */
      }
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
    // Require either free-text or at least one pending comment so we never
    // dispatch the planner with literally nothing to revise.
    const pending = await readPendingComments(id);
    if (parsed.data.message.trim().length === 0 && pending.length === 0) {
      reply.code(400);
      return { error: 'revision needs either a message or at least one pending comment' };
    }
    const handle = await dispatcher.startPlanRevise(id, parsed.data.message, pending.length);
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

  app.post('/api/runs/:id/auto-research', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (dispatcher.isBusy(id)) {
      reply.code(409);
      return { error: 'run already has an in-flight role' };
    }
    try {
      const handle = await dispatcher.startAutoResearch(id);
      return { runId: id, role: handle.role, startedAt: handle.startedAt };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/runs/:id/abort', async (req) => {
    const { id } = req.params as { id: string };
    await dispatcher.abort(id);
    return { ok: true };
  });

  // Recovery for halted runs: clears the halted status and zeros retry_count
  // so the operator can fix the underlying issue (edit contract / revise plan)
  // and then click "next" to retry with a fresh retry budget.
  app.post('/api/runs/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await dispatcher.resume(id);
      return { ok: true };
    } catch (e) {
      reply.code(409);
      return { error: (e as Error).message };
    }
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

  // Update overview.md (operator-edited). Bypasses sprint parsing — the
  // overview never gates execution; it's the authoritative narrative layer.
  app.put('/api/runs/:id/overview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = OverviewBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    await writeAtomic(overviewPath(id), parsed.data.overviewMd);
    return { ok: true };
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

  // -------------------- Pending comments (one-shot review notes) --------------------
  // These get bundled into the planner's revisionMessage on the next iterate
  // and cleared. Persistence is intentionally minimal — comments only live as
  // long as the operator hasn't sent them yet.
  app.get('/api/runs/:id/pending-comments', async (req) => {
    const { id } = req.params as { id: string };
    return { comments: await readPendingComments(id) };
  });

  app.post('/api/runs/:id/pending-comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = NewCommentBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    if (!isValidCommentFile(parsed.data.file)) {
      reply.code(400);
      return { error: 'file must be overview.md, plan.md, or sprints/NN-slug/contract.md' };
    }
    const existing = await readPendingComments(id);
    const comment: PendingComment = {
      id: newCommentId(),
      file: parsed.data.file,
      anchor: parsed.data.anchor,
      body: parsed.data.body,
      created_at: new Date().toISOString()
    };
    await writePendingComments(id, [...existing, comment]);
    return { comment };
  });

  app.patch('/api/runs/:id/pending-comments/:cid', async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const parsed = PatchCommentBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const existing = await readPendingComments(id);
    const next = existing.map((c) => (c.id === cid ? { ...c, body: parsed.data.body } : c));
    if (next.length === existing.length && !existing.some((c) => c.id === cid)) {
      reply.code(404);
      return { error: 'comment not found' };
    }
    await writePendingComments(id, next);
    return { ok: true };
  });

  app.delete('/api/runs/:id/pending-comments/:cid', async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const existing = await readPendingComments(id);
    const next = existing.filter((c) => c.id !== cid);
    if (next.length === existing.length) {
      reply.code(404);
      return { error: 'comment not found' };
    }
    await writePendingComments(id, next);
    return { ok: true };
  });

  // -------------------- Stack (multi-PR plan, written by the planner) --------------------
  // The planner writes stack.json at the run root when it decides the task
  // spans multiple PRs. Operator can edit unspawned entries here, then POST
  // /spawn to materialize the follow-up runs as worktrees stacked on each
  // other. With autoIterate=true the chain orchestrator also auto-iterates
  // each follow-up as its predecessor reaches status=completed.
  app.get('/api/runs/:id/stack', async (req, reply) => {
    const { id } = req.params as { id: string };
    const stack = await readStack(id);
    if (stack === null) {
      reply.code(404);
      return { error: 'no stack.json for this run' };
    }
    return stack;
  });

  app.patch('/api/runs/:id/stack/:index', async (req, reply) => {
    const { id, index: rawIndex } = req.params as { id: string; index: string };
    const index = parseInt(rawIndex, 10);
    if (!Number.isFinite(index) || index < 0) {
      reply.code(400);
      return { error: 'index must be a non-negative integer' };
    }
    const parsed = PatchStackEntryBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const stack = await readStack(id);
    if (stack === null) {
      reply.code(404);
      return { error: 'no stack.json for this run' };
    }
    const entry = stack.ordered[index];
    if (!entry) {
      reply.code(404);
      return { error: 'index out of range' };
    }
    if (entry.runId) {
      reply.code(409);
      return { error: 'entry already spawned; edit the spawned run directly' };
    }
    stack.ordered[index] = { ...entry, ...parsed.data };
    await writeStack(id, stack);
    return { ok: true, entry: stack.ordered[index] };
  });

  app.post('/api/runs/:id/stack/spawn', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SpawnStackBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const stack = await readStack(id);
    if (stack === null) {
      reply.code(404);
      return { error: 'no stack.json for this run' };
    }
    const root = await loadRun(id);
    // Spawned runs init off the operator's *origin* repo (the canonical
    // checkout). If the root run was itself a worktree, its origin_repo is
    // already the canonical checkout; otherwise we fall back to target_repo.
    const originRepo = root.state.origin_repo ?? root.state.target_repo;

    const spawned: { index: number; runId: string; branch: string }[] = [];
    for (let i = 1; i < stack.ordered.length; i++) {
      const entry = stack.ordered[i];
      if (entry.runId) continue; // idempotent re-run
      try {
        const result = await handleInit({
          repo: originRepo,
          task: entry.task,
          maxRetries: 3,
          base: entry.base,
          branch: entry.branch
        });
        stack.ordered[i] = { ...entry, runId: result.runId };
        spawned.push({ index: i, runId: result.runId, branch: result.branch ?? entry.branch });
        // Persist after each successful spawn so a mid-loop failure doesn't
        // lose track of what we already created.
        await writeStack(id, stack);
      } catch (e) {
        reply.code(500);
        return {
          error: `spawn failed at index ${i}: ${(e as Error).message}`,
          spawnedBeforeFailure: spawned
        };
      }
    }

    if (parsed.data.autoIterate) {
      stack.auto_iterate_chain = true;
      stack.halted_at = undefined;
      await writeStack(id, stack);
      // If the root run is already completed, prime the first follow-up
      // immediately. Otherwise the orchestrator fires it when root finishes.
      const rootStatus = (await loadRun(id)).state.status;
      const nextEntry = stack.ordered[stack.current_index + 1];
      if (rootStatus === 'completed' && nextEntry?.runId && !dispatcher.isBusy(nextEntry.runId)) {
        await dispatcher.startAutoIterate(nextEntry.runId);
      }
    }

    return {
      spawned: spawned.length,
      entries: spawned,
      autoIterateChain: !!stack.auto_iterate_chain
    };
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

  // -------------------- Auto-research trials --------------------

  app.get('/api/runs/:id/trials', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = trialsDir(id);
    try {
      const entries = await fs.readdir(dir);
      const results: unknown[] = [];
      for (const entry of entries.sort()) {
        const resultFile = path.join(dir, entry, 'result.json');
        try {
          const raw = await fs.readFile(resultFile, 'utf8');
          results.push(JSON.parse(raw));
        } catch {
          // trial dir exists but no result yet — skip
        }
      }
      return { trials: results };
    } catch {
      // trials directory doesn't exist yet — return empty
      return { trials: [] };
    }
  });

  app.get('/api/runs/:id/notes', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const run = await loadRun(id);
      const experimentDir = run.state.experiment_dir;
      if (!experimentDir) {
        reply.code(404);
        return { error: 'no experiment_dir configured for this run' };
      }
      const notesPath = path.join(experimentDir, 'notes.md');
      try {
        const content = await fs.readFile(notesPath, 'utf8');
        return { content };
      } catch {
        return { content: '' };
      }
    } catch (err) {
      reply.code(404);
      return { error: (err as Error).message };
    }
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

  // -------------------- Config --------------------
  // GET returns whether a key is configured + a masked preview + which source
  // it came from (env vs config file). The raw key is NEVER returned.
  app.get('/api/config', async () => {
    return getApiKeyStatus();
  });

  app.put('/api/config', async (req, reply) => {
    const parsed = ConfigBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    try {
      await setApiKey(parsed.data.anthropic_api_key);
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
    return getApiKeyStatus();
  });

  app.delete('/api/config', async () => {
    await clearApiKey();
    return getApiKeyStatus();
  });

  // -------------------- Repos --------------------
  app.get('/api/repos', async (req) => {
    const { refresh } = (req.query as { refresh?: string }) ?? {};
    return listRepos({ force: refresh === '1' || refresh === 'true' });
  });

  // -------------------- Chat sessions --------------------
  // A "chat" is an interactive `claude` CLI subprocess owned by the harness,
  // distinct from the planner/executor pipeline ("runs"). Each chat persists
  // to ~/.agent-harness/chats/<chatId>/ with its own transcript, notes, and
  // comments. Authentication uses the system `claude login` OAuth; we never
  // pass an API key.

  app.get('/api/chat', async () => {
    const chats = await chat.listChats();
    return { chats };
  });

  app.post('/api/chat', async (req, reply) => {
    const parsed = ChatCreateBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    try {
      const state = await chat.createChat({
        title: parsed.data.title,
        cwd: parsed.data.cwd,
        model: parsed.data.model,
        permission_mode: parsed.data.permission_mode
      });
      return { chat: state };
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
  });

  app.get('/api/chat/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const state = await chat.getChat(id);
    if (!state) {
      reply.code(404);
      return { error: 'chat not found' };
    }
    const [transcript, comments, notesMd] = await Promise.all([
      chat.readTranscript(id),
      readChatComments(id),
      readOrNull(chatNotesPath(id))
    ]);
    return { state, transcript, comments, notesMd: notesMd ?? '' };
  });

  app.post('/api/chat/:id/send', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ChatSendBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    try {
      await chat.sendTurn(id, parsed.data.text);
      return { ok: true };
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
  });

  app.post('/api/chat/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    await chat.stopChat(id);
    return { ok: true };
  });

  app.post('/api/chat/:id/clear', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const state = await chat.clearChat(id);
      return { ok: true, state };
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
  });

  app.post('/api/chat/:id/compact', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await chat.compactChat(id);
      return { ok: true, summary: result.summary };
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
  });

  app.post('/api/chat/:id/fork', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const state = await chat.forkChat(id);
      return { ok: true, chat: state };
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
  });

  app.delete('/api/chat/:id', async (req) => {
    const { id } = req.params as { id: string };
    await chat.deleteChat(id);
    return { ok: true };
  });

  // ---- Notes (free-form personal scratchpad, never sent to Claude) ----
  app.get('/api/chat/:id/notes', async (req) => {
    const { id } = req.params as { id: string };
    const notesMd = (await readOrNull(chatNotesPath(id))) ?? '';
    return { notesMd };
  });

  app.put('/api/chat/:id/notes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ChatNotesBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    await writeAtomic(chatNotesPath(id), parsed.data.notesMd);
    bus.publish({ type: 'chat_notes', chatId: id, notesMd: parsed.data.notesMd });
    return { ok: true };
  });

  // ---- Persistent comments (annotations on assistant messages) ----
  app.get('/api/chat/:id/comments', async (req) => {
    const { id } = req.params as { id: string };
    return { comments: await readChatComments(id) };
  });

  app.post('/api/chat/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ChatNewCommentBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const existing = await readChatComments(id);
    const comment: ChatComment = {
      id: newChatCommentId(),
      message_id: parsed.data.message_id,
      anchor: parsed.data.anchor,
      body: parsed.data.body,
      created_at: new Date().toISOString()
    };
    const next = [...existing, comment];
    await writeChatComments(id, next);
    bus.publish({ type: 'chat_comments', chatId: id, comments: next });
    return { comment };
  });

  app.patch('/api/chat/:id/comments/:cid', async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const parsed = ChatPatchCommentBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const existing = await readChatComments(id);
    const idx = existing.findIndex((c) => c.id === cid);
    if (idx < 0) {
      reply.code(404);
      return { error: 'comment not found' };
    }
    const next = [...existing];
    next[idx] = {
      ...next[idx],
      body: parsed.data.body,
      updated_at: new Date().toISOString()
    };
    await writeChatComments(id, next);
    bus.publish({ type: 'chat_comments', chatId: id, comments: next });
    return { comment: next[idx] };
  });

  app.delete('/api/chat/:id/comments/:cid', async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const existing = await readChatComments(id);
    const next = existing.filter((c) => c.id !== cid);
    if (next.length === existing.length) {
      reply.code(404);
      return { error: 'comment not found' };
    }
    await writeChatComments(id, next);
    bus.publish({ type: 'chat_comments', chatId: id, comments: next });
    return { ok: true };
  });

  // -------------------- SSE --------------------
  app.get('/api/events', (req, reply) => {
    const { run, chat } = (req.query as { run?: string; chat?: string }) ?? {};
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
    const unsubscribe = bus.subscribe(reply, { runId: run, chatId: chat });
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

  return { app, bus, watcher, dispatcher, chat };
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
