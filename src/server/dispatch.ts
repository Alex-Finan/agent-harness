import { handlePlan, handlePlanRevise } from '../cli/commands/plan.js';
import { handleNext } from '../cli/commands/next.js';
import { handleInit, type InitArgs, type InitResult } from '../cli/commands/init.js';
import { handleAbort } from '../cli/commands/abort.js';
import { loadRun, saveState } from '../state/run.js';
import { EventBus } from './events.js';

export interface DispatchHandle {
  runId: string;
  role: 'planner' | 'next';
  startedAt: string;
  promise: Promise<void>;
  error?: string;
  finished: boolean;
}

/**
 * Per-run mutex + tracking. Within a single run only one role session may be
 * in flight at a time. Across different runs sessions execute concurrently —
 * each role invocation is an `await` against the SDK, so node's event loop
 * naturally interleaves them.
 */
export class RunDispatcher {
  private inflight = new Map<string, DispatchHandle>();

  constructor(private bus: EventBus) {}

  isBusy(runId: string): boolean {
    return this.inflight.has(runId) && !this.inflight.get(runId)!.finished;
  }

  current(runId: string): DispatchHandle | null {
    return this.inflight.get(runId) ?? null;
  }

  async startPlan(runId: string): Promise<DispatchHandle> {
    return this.start(runId, 'planner', () => handlePlan({ runId }));
  }

  async startNext(runId: string): Promise<DispatchHandle> {
    return this.start(runId, 'next', () => handleNext({ runId }));
  }

  async startPlanRevise(runId: string, revisionMessage: string): Promise<DispatchHandle> {
    return this.start(runId, 'planner', () => handlePlanRevise({ runId, revisionMessage }));
  }

  /**
   * Auto-iterate: planner if needed, then alternating executor/evaluator
   * until completed/halted/aborted. Sequential within the run; multiple runs
   * may auto-iterate concurrently.
   */
  async startAutoIterate(runId: string): Promise<DispatchHandle> {
    return this.start(runId, 'next', async () => {
      // Persist intent so a server restart can resume this loop.
      const preLoop = await loadRun(runId);
      await saveState({
        ...preLoop.state,
        auto_iterate: true,
        updated_at: new Date().toISOString()
      });

      try {
        // Bounded ceiling so a misbehaving planner can't pin a CPU forever.
        for (let i = 0; i < 200; i++) {
          const run = await loadRun(runId);
          const s = run.state;
          if (s.status !== 'in_progress') return;
          if (s.next_role === 'planner') {
            await handlePlan({ runId });
            continue;
          }
          if (s.next_role === 'done') return;
          await handleNext({ runId });
        }
      } finally {
        // Clear the flag on every exit path: normal completion, status change,
        // ceiling hit, or unexpected exception.
        try {
          const run = await loadRun(runId);
          await saveState({
            ...run.state,
            auto_iterate: false,
            updated_at: new Date().toISOString()
          });
        } catch {
          /* best-effort: if the run was purged we can't clear the flag */
        }
      }
    });
  }

  private async start(
    runId: string,
    role: 'planner' | 'next',
    fn: () => Promise<void>
  ): Promise<DispatchHandle> {
    if (this.isBusy(runId)) {
      throw new Error(`run ${runId} already has an in-flight role`);
    }
    const startedAt = new Date().toISOString();
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const handle: DispatchHandle = { runId, role, startedAt, promise, finished: false };
    this.inflight.set(runId, handle);
    this.bus.publish({ type: 'dispatch', runId, role, status: 'started' });

    fn()
      .then(() => {
        handle.finished = true;
        this.bus.publish({ type: 'dispatch', runId, role, status: 'finished' });
        resolve();
      })
      .catch((err: unknown) => {
        handle.finished = true;
        handle.error = err instanceof Error ? err.message : String(err);
        this.bus.publish({ type: 'dispatch', runId, role, status: 'error', error: handle.error });
        reject(err);
      });

    return handle;
  }

  async createRun(args: InitArgs): Promise<InitResult> {
    return handleInit(args);
  }

  async abort(runId: string): Promise<{ purged: boolean }> {
    // Clear auto_iterate flag before delegating. This prevents a race where
    // the server is killed after abort() writes status:aborted but the loop's
    // finally block never ran.
    try {
      const run = await loadRun(runId);
      if (run.state.auto_iterate) {
        await saveState({
          ...run.state,
          auto_iterate: false,
          updated_at: new Date().toISOString()
        });
      }
    } catch {
      /* run may not exist — handleAbort will surface the error */
    }
    return handleAbort({ runId });
  }
}
