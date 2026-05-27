import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ensureDir, writeAtomic, readOrNull } from '../lib/fs.js';
import {
  chatDir,
  chatTranscriptPath,
  chatNotesPath,
  chatsRoot,
  chatSubprocessLogPath
} from '../state/paths.js';
import {
  type ChatState,
  type ChatPermissionMode,
  newChatId,
  readChatState,
  writeChatState
} from '../state/chatState.js';
import {
  readChatComments,
  writeChatComments,
  newChatCommentId
} from '../state/chatComments.js';
import type { EventBus } from './events.js';

/**
 * Wire format on stdin: one JSON object per line.
 *   { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '...' }] } }
 *
 * Wire format on stdout (per --output-format stream-json):
 *   { type: 'system', subtype: 'init' | 'status' | 'hook_started' | ... }
 *   { type: 'stream_event', event: {...} }            // when --include-partial-messages
 *   { type: 'assistant', message: { id, role, content: [...] } }
 *   { type: 'user', message: { role: 'user', content: [...] } }  // tool_result echo
 *   { type: 'result', subtype: 'success'|'error_max_turns'|..., total_cost_usd, num_turns }
 */

export interface ChatCreateInput {
  title?: string;
  cwd: string;
  model?: string;
  permission_mode?: ChatPermissionMode;
}

interface RunningSession {
  state: ChatState;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  stderrBuffer: string;
  /** True after we've sent a turn and are awaiting `result`. */
  awaitingResult: boolean;
  /** Resolves when the current `result` event arrives (one per turn). */
  turnSettle?: (result: Record<string, unknown>) => void;
  /** Resolved with the most recent `result` event when the turn completes. */
  turnPromise?: Promise<Record<string, unknown>>;
}

/**
 * Appended to every chat subprocess's system prompt so Claude knows about the
 * harness's artifact surfaces and can write diagrams the operator can actually
 * preview live.
 */
const ARTIFACT_SYSTEM_HINT = `
You're running inside the agent-harness chat UI. Two artifact surfaces are available to you, both shown in a separate "Artifacts" tab next to the chat:

1. **Plans** — Use the ExitPlanMode tool with a complete markdown plan when the operator wants to review a multi-step approach before execution. The plan renders as an annotatable markdown card.

2. **JSX diagrams** — When the operator asks for a visualization, diagram, UI mockup, or interactive widget, write it as a self-contained React component inside a \`\`\`jsx fenced code block. Conventions:
   - React, useState, useEffect, useMemo, useRef, useCallback are pre-imported (no import statements needed).
   - Use inline styles or Tailwind-like className strings; no external CSS/libraries.
   - End the snippet with a top-level expression that mounts your component, e.g. \`<MyDiagram />\`. (If you just declare \`function MyDiagram() { ... }\` the harness will auto-mount it.)
   - Optional first-line metadata: \`// Title: Your Diagram Name\` controls the artifact tab title.
   - The snippet runs in a sandbox; keep it pure-presentational, no network calls, no localStorage.

Use these when they help. For plain conversation, just reply normally.
`.trim();

function resolveClaudeCli(): string {
  const home = process.env.HOME ?? '';
  const candidates = [
    process.env.CLAUDE_HARNESS_CLAUDE_BIN,
    path.join(home, '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude'
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH lookup at spawn time.
  return 'claude';
}

export class ChatManager {
  private sessions = new Map<string, RunningSession>();
  constructor(private readonly bus: EventBus) {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async listChats(): Promise<ChatState[]> {
    const root = chatsRoot();
    await ensureDir(root);
    const entries = await fs.readdir(root, { withFileTypes: true });
    const result: ChatState[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const state = await readChatState(ent.name);
      if (state) result.push(state);
    }
    result.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return result;
  }

  async getChat(chatId: string): Promise<ChatState | null> {
    return readChatState(chatId);
  }

  async createChat(input: ChatCreateInput): Promise<ChatState> {
    if (!input.cwd || !existsSync(input.cwd)) {
      throw new Error(`cwd does not exist: ${input.cwd}`);
    }
    const chat_id = newChatId();
    const session_id = randomUUID();
    const now = new Date().toISOString();
    const state: ChatState = {
      chat_id,
      title: (input.title?.trim() || `Chat ${new Date().toLocaleString()}`).slice(0, 200),
      cwd: input.cwd,
      session_id,
      model: input.model,
      permission_mode: input.permission_mode ?? 'acceptEdits',
      status: 'idle',
      created_at: now,
      updated_at: now,
      cost_usd: 0,
      turn_count: 0
    };
    await ensureDir(chatDir(chat_id));
    await writeAtomic(chatTranscriptPath(chat_id), '');
    // notes.md starts empty but present so the editor doesn't show "missing"
    await writeAtomic(chatNotesPath(chat_id), '');
    await writeChatState(state);
    this.bus.publish({ type: 'chat_created', chatId: chat_id, state });
    return state;
  }

  /**
   * Spawn (or return the existing) claude subprocess for a chat. Idempotent —
   * if the subprocess is already alive we just return.
   */
  private ensureRunning(chatId: string, state: ChatState): RunningSession {
    const existing = this.sessions.get(chatId);
    if (existing && existing.child.exitCode === null && !existing.child.killed) {
      return existing;
    }

    const env = { ...process.env };
    // Force OAuth (Pro account). The CLI prefers ANTHROPIC_API_KEY when set;
    // unsetting it means the keychain-stored OAuth credentials are used.
    delete env.ANTHROPIC_API_KEY;

    // First spawn for this chat (no turns yet) → create the session with our
    // chosen UUID. Any subsequent respawn → resume the existing session.
    // `--print --session-id <existing>` errors with "already in use"; --resume
    // is the right verb for re-attaching to a saved conversation.
    const isFirstSpawn = state.turn_count === 0;
    const sessionFlag = isFirstSpawn
      ? ['--session-id', state.session_id]
      : ['--resume', state.session_id];

    const args: string[] = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...sessionFlag,
      '--permission-mode', state.permission_mode,
      // AskUserQuestion is a client-side interactive tool; in --print mode the
      // CLI auto-cancels it before the harness can route the question to the
      // operator. Disallow it so Claude asks clarifying questions in plain
      // text inside its reply instead.
      '--disallowedTools', 'AskUserQuestion',
      // Skills add ceremony (brainstorming, planning, etc.) that's not useful
      // in a free-form chat — operator wants to drive directly. Plans the
      // operator does want come through the ExitPlanMode tool, which is
      // surfaced as an Artifacts panel in the UI.
      '--disable-slash-commands',
      // Tell Claude about the harness's artifact conventions (plans + jsx
      // diagrams). The harness scans for ```jsx fences and renders them
      // live in the Artifacts tab.
      '--append-system-prompt', ARTIFACT_SYSTEM_HINT
    ];
    if (state.model) args.push('--model', state.model);

    const cli = resolveClaudeCli();
    const child = spawn(cli, args, {
      env,
      cwd: state.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams;

    const session: RunningSession = {
      state,
      child,
      stdoutBuffer: '',
      stderrBuffer: '',
      awaitingResult: false
    };
    this.sessions.set(chatId, session);

    // Stamp a header marking the spawn so post-mortem stderr inspection can
    // tell which subprocess produced which lines.
    void fs
      .appendFile(
        chatSubprocessLogPath(chatId),
        `\n--- spawn pid=${child.pid} at=${new Date().toISOString()} args=${JSON.stringify(args)} ---\n`,
        'utf8'
      )
      .catch(() => {});

    child.stdout.on('data', (chunk: Buffer) => this.onStdout(session, chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      session.stderrBuffer += chunk.toString();
      // Keep in-memory buffer bounded for `last_error`; only the last 8KB is
      // useful for the error message. Full text streams to subprocess.log.
      if (session.stderrBuffer.length > 8192) {
        session.stderrBuffer = session.stderrBuffer.slice(-8192);
      }
      void fs.appendFile(chatSubprocessLogPath(chatId), chunk, 'utf8').catch(() => {});
    });
    child.on('exit', (code, signal) => this.onExit(chatId, session, code, signal));
    child.on('error', (err) => {
      void this.markError(chatId, session, `subprocess error: ${err.message}`);
    });
    return session;
  }

  // -----------------------------------------------------------------------
  // Turns
  // -----------------------------------------------------------------------

  async sendTurn(chatId: string, text: string): Promise<void> {
    await this.sendTurnAndAwait(chatId, text);
  }

  /**
   * Send a user turn and return a promise that resolves with the CLI's
   * `result` event when the assistant's turn settles. Powers /compact, which
   * needs to capture the summary text before clearing.
   */
  async sendTurnAndAwait(chatId: string, text: string): Promise<Record<string, unknown> | null> {
    const state = await readChatState(chatId);
    if (!state) throw new Error('chat not found');
    if (state.status === 'ended') throw new Error('chat has ended');

    const session = this.ensureRunning(chatId, state);
    if (session.awaitingResult) {
      throw new Error('a turn is already in flight; wait for the assistant to finish');
    }

    // Apply pending seed (from /compact) once and clear it.
    let effectiveText = text;
    if (state.pending_seed) {
      effectiveText = `${state.pending_seed}\n\n---\n\n${text}`;
      session.state.pending_seed = undefined;
    }

    // Persist the user turn to the transcript immediately so the UI can render
    // it on the next watcher tick even before the assistant starts streaming.
    const userMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }]
      },
      // Carry a synthetic id so the frontend can address user messages too.
      uuid: randomUUID(),
      session_id: state.session_id,
      // Append-only timestamp on the harness side; not part of the CLI schema.
      _harness_at: new Date().toISOString()
    };
    await fs.appendFile(chatTranscriptPath(chatId), JSON.stringify(userMsg) + '\n', 'utf8');
    this.bus.publish({
      type: 'chat_message',
      chatId,
      message: userMsg
    });

    session.awaitingResult = true;
    session.state.status = 'thinking';
    session.state.turn_count += 1;
    session.state.updated_at = new Date().toISOString();
    session.state.last_error = undefined;
    await writeChatState(session.state);
    this.bus.publish({ type: 'chat_state', chatId, state: session.state });

    // Build the promise that resolves on the next `result` event.
    let resolveSettle!: (r: Record<string, unknown>) => void;
    const turnPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettle = resolve;
    });
    session.turnSettle = (r?: Record<string, unknown>) =>
      resolveSettle(r ?? { type: 'result', subtype: 'unknown' });
    session.turnPromise = turnPromise;

    // Write the CLI-wire user turn (no _harness_at; that's our metadata).
    const wireTurn = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: effectiveText }] }
    };
    session.child.stdin.write(JSON.stringify(wireTurn) + '\n');

    return turnPromise;
  }

  // -----------------------------------------------------------------------
  // /clear and /compact
  // -----------------------------------------------------------------------

  /**
   * Wipe the chat's transcript and start fresh with a new session_id. The
   * subprocess is killed; the next user turn spawns a new one. Notes and
   * comments are kept (they're operator data, not subprocess state). If
   * `seed` is provided it's prepended to the next user turn — used by
   * /compact to carry a summary into the new session.
   */
  async clearChat(chatId: string, seed?: string): Promise<ChatState> {
    const state = await readChatState(chatId);
    if (!state) throw new Error('chat not found');

    // Kill any in-flight subprocess so it can't write to the new transcript.
    const session = this.sessions.get(chatId);
    if (session) {
      try {
        session.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.sessions.delete(chatId);
    }

    // Truncate transcript on disk.
    await fs.writeFile(chatTranscriptPath(chatId), '', 'utf8');

    // Mint a fresh session id and reset state.
    state.session_id = randomUUID();
    state.turn_count = 0;
    state.status = 'idle';
    state.last_error = undefined;
    state.updated_at = new Date().toISOString();
    if (seed) state.pending_seed = seed;
    else state.pending_seed = undefined;
    await writeChatState(state);

    this.bus.publish({ type: 'chat_state', chatId, state });
    this.bus.publish({ type: 'chat_reset', chatId });
    return state;
  }

  /**
   * Ask Claude for a summary of the conversation so far, then clear and seed
   * the next turn with it. The new session starts with a recap baked in.
   */
  async compactChat(chatId: string): Promise<{ summary: string }> {
    const summarizePrompt =
      'Summarize our conversation so far in 2-4 short paragraphs. Focus on: ' +
      '(a) the current task and what we are trying to accomplish, ' +
      '(b) key decisions and constraints we have agreed on, ' +
      '(c) any open questions or next steps. ' +
      'Write the summary as if it were context for a future session — direct, no preamble. ' +
      'Do NOT respond conversationally; output only the summary.';

    const result = await this.sendTurnAndAwait(chatId, summarizePrompt);
    if (!result || result.subtype !== 'success') {
      throw new Error('summarize turn failed; not compacting');
    }
    const text = typeof result.result === 'string' ? (result.result as string) : '';
    const summary = text.trim();
    if (!summary) throw new Error('summarize turn returned empty text; not compacting');

    const seed = `Prior conversation summary (compacted by /compact):\n\n${summary}`;
    await this.clearChat(chatId, seed);
    return { summary };
  }

  /**
   * Branch a chat: create a sibling that resumes from the parent's exact
   * conversation state but evolves independently. Useful for "what if I had
   * asked X instead?" without losing the original thread.
   *
   * Mechanics: the claude CLI stores each session's transcript at
   * `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`. We copy that file
   * under a fresh session UUID (rewriting the `sessionId` field on every
   * line), then mint a new harness chat record pointing at it with the same
   * `turn_count` as the parent — that flips the next spawn down the
   * `--resume` path so Claude picks up the prior context. The harness-side
   * transcript, notes, and comments are copied too so the UI matches.
   *
   * The parent chat is untouched. Refuses to fork while the parent has a
   * turn in flight (the CLI session file could be mid-write).
   */
  async forkChat(parentId: string): Promise<ChatState> {
    const parent = await readChatState(parentId);
    if (!parent) throw new Error('chat not found');

    const running = this.sessions.get(parentId);
    if (running?.awaitingResult || parent.status === 'thinking') {
      throw new Error('cannot fork while a turn is in flight; wait for the assistant to finish');
    }

    const new_chat_id = newChatId();
    const new_session_id = randomUUID();
    const now = new Date().toISOString();

    // Copy the claude CLI's per-session jsonl. cwd `/Users/foo` →
    // `-Users-foo` is the CLI's own encoding. If the parent never ran a
    // turn there's no file to copy — the fork starts empty.
    if (parent.turn_count > 0) {
      const encoded = parent.cwd.replace(/\//g, '-');
      const cliRoot = path.join(os.homedir(), '.claude', 'projects', encoded);
      const src = path.join(cliRoot, `${parent.session_id}.jsonl`);
      const dst = path.join(cliRoot, `${new_session_id}.jsonl`);
      const raw = await readOrNull(src);
      if (raw) {
        const out: string[] = [];
        for (const line of raw.split('\n')) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (typeof obj.sessionId === 'string') {
              obj.sessionId = new_session_id;
            }
            out.push(JSON.stringify(obj));
          } catch {
            // Preserve unparseable lines verbatim — the CLI may use them.
            out.push(line);
          }
        }
        await ensureDir(cliRoot);
        await fs.writeFile(dst, out.join('\n') + '\n', 'utf8');
      }
    }

    // Set up the new harness chat directory with copies of the parent's
    // operator-visible state.
    await ensureDir(chatDir(new_chat_id));
    const transcript = (await readOrNull(chatTranscriptPath(parentId))) ?? '';
    await writeAtomic(chatTranscriptPath(new_chat_id), transcript);
    const notes = (await readOrNull(chatNotesPath(parentId))) ?? '';
    await writeAtomic(chatNotesPath(new_chat_id), notes);
    const parentComments = await readChatComments(parentId);
    if (parentComments.length > 0) {
      // Fresh comment ids so future edits/deletes on the fork don't shadow
      // the parent's annotations (or vice versa).
      const cloned = parentComments.map((c) => ({ ...c, id: newChatCommentId() }));
      await writeChatComments(new_chat_id, cloned);
    }

    const state: ChatState = {
      chat_id: new_chat_id,
      title: `${parent.title} (fork)`.slice(0, 200),
      cwd: parent.cwd,
      session_id: new_session_id,
      model: parent.model,
      permission_mode: parent.permission_mode,
      status: 'idle',
      created_at: now,
      updated_at: now,
      cost_usd: 0,
      // Carry the parent's turn count so ensureRunning() takes the
      // --resume branch on first spawn instead of --session-id (which would
      // try to create a session that already exists on disk).
      turn_count: parent.turn_count
    };
    await writeChatState(state);
    this.bus.publish({ type: 'chat_created', chatId: new_chat_id, state });
    return state;
  }

  async stopChat(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (session) {
      try {
        session.child.stdin.end();
      } catch {
        /* already closed */
      }
      session.child.kill('SIGTERM');
      this.sessions.delete(chatId);
    }
    const state = await readChatState(chatId);
    if (state) {
      state.status = 'ended';
      state.updated_at = new Date().toISOString();
      await writeChatState(state);
      this.bus.publish({ type: 'chat_state', chatId, state });
    }
  }

  /** Delete a chat session and all its on-disk state. Kills the subprocess. */
  async deleteChat(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (session) {
      try {
        session.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      this.sessions.delete(chatId);
    }
    await fs.rm(chatDir(chatId), { recursive: true, force: true });
    this.bus.publish({ type: 'chat_deleted', chatId });
  }

  // -----------------------------------------------------------------------
  // Stdout parsing
  // -----------------------------------------------------------------------

  private onStdout(session: RunningSession, chunk: Buffer): void {
    session.stdoutBuffer += chunk.toString();
    const lines = session.stdoutBuffer.split('\n');
    session.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        // Malformed line — ignore; CLI sometimes prints info lines we can't parse.
        continue;
      }
      void this.handleMessage(session, obj);
    }
  }

  private async handleMessage(
    session: RunningSession,
    obj: Record<string, unknown>
  ): Promise<void> {
    const chatId = session.state.chat_id;
    const t = obj.type as string | undefined;

    // Append every CLI message to the transcript. The frontend filters; we
    // keep the full record on disk for replay / debugging.
    await fs.appendFile(
      chatTranscriptPath(chatId),
      JSON.stringify(obj) + '\n',
      'utf8'
    );

    // High-frequency stream_event deltas → publish as a tight event so the
    // frontend can render partial tokens.
    if (t === 'stream_event') {
      this.bus.publish({ type: 'chat_stream', chatId, event: obj });
      return;
    }

    // Full assistant / tool-result messages.
    if (t === 'assistant' || t === 'user') {
      this.bus.publish({ type: 'chat_message', chatId, message: obj });
      return;
    }

    // System events (init, status, hook lifecycle) — useful but not required
    // for the chat UI; publish so the left-rail can show "thinking…" etc.
    if (t === 'system') {
      this.bus.publish({ type: 'chat_system', chatId, event: obj });
      return;
    }

    // Result marks turn completion.
    if (t === 'result') {
      session.awaitingResult = false;
      session.state.status = 'idle';
      session.state.updated_at = new Date().toISOString();
      const cost = obj.total_cost_usd;
      if (typeof cost === 'number') {
        session.state.cost_usd += cost;
      }
      if (obj.subtype !== 'success') {
        session.state.last_error =
          typeof obj.subtype === 'string' ? obj.subtype : 'unknown_error';
      }
      await writeChatState(session.state);
      this.bus.publish({ type: 'chat_state', chatId, state: session.state });
      this.bus.publish({ type: 'chat_result', chatId, result: obj });
      (session.turnSettle as ((r: Record<string, unknown>) => void) | undefined)?.(obj);
      session.turnSettle = undefined;
      return;
    }
  }

  private async onExit(
    chatId: string,
    session: RunningSession,
    code: number | null,
    signal: NodeJS.Signals | null
  ): Promise<void> {
    this.sessions.delete(chatId);
    const state = session.state;
    // If we weren't already ending and the exit was abnormal, mark error.
    if (state.status !== 'ended') {
      const wasError = code !== 0 && !signal;
      state.status = wasError ? 'error' : 'idle';
      state.updated_at = new Date().toISOString();
      if (wasError) {
        const tail = session.stderrBuffer.trim().slice(-512);
        state.last_error = `subprocess exited code=${code}${tail ? ` :: ${tail}` : ''}`;
      }
      await writeChatState(state);
      this.bus.publish({ type: 'chat_state', chatId, state });
    }
  }

  private async markError(
    chatId: string,
    session: RunningSession,
    msg: string
  ): Promise<void> {
    session.state.status = 'error';
    session.state.last_error = msg;
    session.state.updated_at = new Date().toISOString();
    await writeChatState(session.state);
    this.bus.publish({ type: 'chat_state', chatId, state: session.state });
  }

  // -----------------------------------------------------------------------
  // Transcript replay (for GET /api/chat/:id)
  // -----------------------------------------------------------------------

  async readTranscript(chatId: string): Promise<unknown[]> {
    const raw = await readOrNull(chatTranscriptPath(chatId));
    if (!raw) return [];
    const out: unknown[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  /** Gracefully shut down all running subprocesses (used on server stop). */
  async shutdown(): Promise<void> {
    for (const [, session] of this.sessions) {
      try {
        session.child.stdin.end();
        session.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }
}
