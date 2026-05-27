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

export function stackPath(runId: string): string {
  return path.join(runDir(runId), 'stack.json');
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

export function plannerLogPath(runId: string): string {
  return path.join(runDir(runId), 'planner-log.jsonl');
}

/**
 * Conversational reply scratchpad — the planner writes its chat-style answer
 * here when the user's revise message is a question / clarification rather
 * than an instruction to change the plan. Overwritten each dispatch.
 */
export function plannerReplyPath(runId: string): string {
  return path.join(runDir(runId), 'planner-reply.md');
}

// ---------------------------------------------------------------------------
// Auto-research trial paths
// ---------------------------------------------------------------------------

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

/** Root directory that holds all trial sub-directories for a run. */
export function trialsDir(runId: string): string {
  return path.join(runDir(runId), 'trials');
}

/** Directory for a single trial (zero-padded 3-digit number). */
export function trialDir(runId: string, trialNum: number): string {
  return path.join(trialsDir(runId), pad3(trialNum));
}

/** Path to the result JSON file for a single trial. */
export function trialResultPath(runId: string, trialNum: number): string {
  return path.join(trialDir(runId, trialNum), 'result.json');
}

// ---------------------------------------------------------------------------
// Chat session paths — a chat is an interactive `claude` CLI conversation
// owned by the harness, distinct from the planner/executor "runs" pipeline.
// Each session lives in its own directory; comments and notes persist forever
// (unlike pending_comments on runs which are short-lived).
// ---------------------------------------------------------------------------

export function chatsRoot(): string {
  return path.join(harnessHome(), 'chats');
}

export function chatDir(chatId: string): string {
  return path.join(chatsRoot(), chatId);
}

export function chatStatePath(chatId: string): string {
  return path.join(chatDir(chatId), 'state.json');
}

export function chatTranscriptPath(chatId: string): string {
  return path.join(chatDir(chatId), 'transcript.jsonl');
}

export function chatNotesPath(chatId: string): string {
  return path.join(chatDir(chatId), 'notes.md');
}

export function chatCommentsPath(chatId: string): string {
  return path.join(chatDir(chatId), 'comments.json');
}

/** Per-chat subprocess stderr log (appended across spawns for diagnostics). */
export function chatSubprocessLogPath(chatId: string): string {
  return path.join(chatDir(chatId), 'subprocess.log');
}
