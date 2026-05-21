import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { runsRoot, runDir, planPath, overviewPath, logsDir, sprintsDir, statePath } from '../state/paths.js';
import { readOrNull } from '../lib/fs.js';
import { parseVerdict } from '../state/artifacts.js';
import { ensureDir } from '../lib/fs.js';
import { computeRunCost } from './cost.js';
import type { EventBus } from './events.js';
import { StateSchema } from '../state/schema.js';

interface FileCursor {
  size: number;
  carry: string;
}

/**
 * Watches ~/.agent-harness/runs for changes and broadcasts events.
 *
 * Transcripts: tailed incrementally (track byte offset, on change read the
 *   tail, parse each new JSON line, broadcast). This keeps memory bounded
 *   even for long-running sessions.
 *
 * State.json: re-read entirely on change; broadcast the new state.
 *
 * overview.md, plan.md, contract.md, output.md, verdict.md: re-read entirely (small).
 */
export class HarnessWatcher {
  private watcher: FSWatcher | null = null;
  private cursors = new Map<string, FileCursor>();

  constructor(private bus: EventBus) {}

  async start(): Promise<void> {
    const root = runsRoot();
    await ensureDir(root);

    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      depth: 5,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 }
    });

    const onPath = (p: string) => this.handleChange(p).catch(() => {});
    this.watcher.on('add', onPath);
    this.watcher.on('change', onPath);
    this.watcher.on('unlink', (p: string) => {
      this.cursors.delete(p);
      void this.handleChange(p);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  private async handleChange(filePath: string): Promise<void> {
    const root = runsRoot();
    if (!filePath.startsWith(root + path.sep) && filePath !== root) return;
    const rel = filePath.slice(root.length + 1);
    const segments = rel.split(path.sep);
    const runId = segments[0];
    if (!runId) return;

    const name = path.basename(filePath);

    if (filePath === statePath(runId)) {
      const raw = await readOrNull(filePath);
      if (raw) {
        try {
          const state = StateSchema.parse(JSON.parse(raw));
          this.bus.publish({ type: 'run_state', runId, state });
          // Cost may have changed because a new transcript landed.
          const cost = await computeRunCost(runId);
          this.bus.publish({ type: 'cost', runId, perRole: cost.perRole, total: cost.totalUsd });
        } catch {
          /* malformed write — wait for next event */
        }
      }
      return;
    }

    if (filePath === planPath(runId)) {
      const planMd = await readOrNull(filePath);
      if (planMd !== null) this.bus.publish({ type: 'plan', runId, planMd });
      return;
    }

    if (filePath === overviewPath(runId)) {
      const overviewMd = await readOrNull(filePath);
      if (overviewMd !== null) this.bus.publish({ type: 'overview', runId, overviewMd });
      return;
    }

    // sprints/<dir>/{contract,output,verdict}.md
    if (segments[1] === 'sprints' && segments.length >= 4) {
      const sprintDir = segments[2];
      const content = await readOrNull(filePath);
      if (content === null) return;
      if (name === 'contract.md') {
        this.bus.publish({ type: 'contract', runId, sprint: sprintDir, contractMd: content });
      } else if (name === 'output.md') {
        this.bus.publish({ type: 'output', runId, sprint: sprintDir, outputMd: content });
      } else if (name === 'verdict.md') {
        const verdict = parseVerdict(content);
        this.bus.publish({ type: 'verdict', runId, sprint: sprintDir, verdictMd: content });
        void verdict;
      }
      return;
    }

    // logs/<role>-s<n>-r<r>.log or planner.log
    if (segments[1] === 'logs' && segments.length >= 3 && name.endsWith('.log')) {
      await this.tailLog(runId, filePath, name);
      return;
    }
  }

  private async tailLog(runId: string, filePath: string, logName: string): Promise<void> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      this.cursors.delete(filePath);
      this.bus.publish({ type: 'transcript_reset', runId, logName });
      return;
    }

    const cursor = this.cursors.get(filePath) ?? { size: 0, carry: '' };
    if (stat.size < cursor.size) {
      // File was truncated; reset.
      cursor.size = 0;
      cursor.carry = '';
      this.bus.publish({ type: 'transcript_reset', runId, logName });
    }
    if (stat.size === cursor.size) return;

    const fd = await fs.open(filePath, 'r');
    try {
      const length = stat.size - cursor.size;
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, cursor.size);
      const text = cursor.carry + buf.toString('utf8');
      const splitIdx = text.lastIndexOf('\n');
      const completePart = splitIdx === -1 ? '' : text.slice(0, splitIdx);
      const carry = splitIdx === -1 ? text : text.slice(splitIdx + 1);

      const newLines: unknown[] = [];
      for (const raw of completePart.split('\n')) {
        if (!raw.trim()) continue;
        try {
          newLines.push(JSON.parse(raw));
        } catch {
          newLines.push({ type: 'raw', text: raw });
        }
      }
      this.cursors.set(filePath, { size: stat.size, carry });
      if (newLines.length > 0) {
        this.bus.publish({ type: 'transcript_append', runId, logName, lines: newLines });
      }
    } finally {
      await fd.close();
    }

    // Once the transcript closes (result line landed), nudge a cost recompute.
    const cost = await computeRunCost(runId);
    this.bus.publish({ type: 'cost', runId, perRole: cost.perRole, total: cost.totalUsd });
  }
}

export function _internalRunDir(runId: string): string {
  return runDir(runId);
}

export { sprintsDir as _internalSprintsDir, logsDir as _internalLogsDir };
