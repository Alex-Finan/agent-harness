import * as path from 'node:path';
import * as os from 'node:os';

export function harnessHome(): string {
  return process.env.AGENT_HARNESS_HOME ?? path.join(os.homedir(), '.agent-harness');
}

export function runsRoot(): string {
  return path.join(harnessHome(), 'runs');
}

export function runDir(runId: string): string {
  return path.join(runsRoot(), runId);
}

export function statePath(runId: string): string {
  return path.join(runDir(runId), 'state.json');
}

export function taskPath(runId: string): string {
  return path.join(runDir(runId), 'task.md');
}

export function planPath(runId: string): string {
  return path.join(runDir(runId), 'plan.md');
}

export function overviewPath(runId: string): string {
  return path.join(runDir(runId), 'overview.md');
}

export function pendingCommentsPath(runId: string): string {
  return path.join(runDir(runId), 'pending_comments.json');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function sprintsDir(runId: string): string {
  return path.join(runDir(runId), 'sprints');
}

export function sprintDir(runId: string, sprintNum: number, slug: string): string {
  return path.join(sprintsDir(runId), `${pad2(sprintNum)}-${slug}`);
}

export function sprintArtifactPath(
  runId: string,
  sprintNum: number,
  slug: string,
  filename: string
): string {
  return path.join(sprintDir(runId, sprintNum, slug), filename);
}

export function logsDir(runId: string): string {
  return path.join(runDir(runId), 'logs');
}
