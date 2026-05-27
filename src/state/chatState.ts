import { z } from 'zod';
import { writeAtomic, readOrNull } from '../lib/fs.js';
import { chatStatePath } from './paths.js';

export const ChatStatusEnum = z.enum(['idle', 'thinking', 'ended', 'error']);
export type ChatStatus = z.infer<typeof ChatStatusEnum>;

export const ChatPermissionModeEnum = z.enum([
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan'
]);
export type ChatPermissionMode = z.infer<typeof ChatPermissionModeEnum>;

export const ChatStateSchema = z.object({
  chat_id: z.string(),
  title: z.string(),
  // Absolute cwd the claude subprocess runs in.
  cwd: z.string(),
  // The claude CLI's own session UUID (mirrors --session-id). We pass it on
  // spawn so the operator can `claude --resume <id>` from a terminal too.
  session_id: z.string(),
  model: z.string().optional(),
  permission_mode: ChatPermissionModeEnum.default('acceptEdits'),
  status: ChatStatusEnum.default('idle'),
  created_at: z.string(),
  updated_at: z.string(),
  // Last error string (set when status='error'). Cleared on recovery / next send.
  last_error: z.string().optional(),
  // Rough running cost, accumulated from result events.
  cost_usd: z.number().default(0),
  // Total user turns sent since session creation.
  turn_count: z.number().int().nonnegative().default(0),
  // Seed text prepended to the next user turn (used after /compact to carry
  // a summary of the prior conversation into the fresh session). Cleared
  // after one use.
  pending_seed: z.string().optional(),
  // When this chat was forked with --worktree, the original repo where
  // `git worktree add` ran (so we can find the right repo to run
  // `git worktree remove` against on cleanup) and the branch name that was
  // created. Absent on regular chats and same-cwd forks.
  worktree_origin: z.string().optional(),
  worktree_branch: z.string().optional()
});

export type ChatState = z.infer<typeof ChatStateSchema>;

export async function readChatState(chatId: string): Promise<ChatState | null> {
  const raw = await readOrNull(chatStatePath(chatId));
  if (!raw) return null;
  try {
    return ChatStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeChatState(state: ChatState): Promise<void> {
  await writeAtomic(chatStatePath(state.chat_id), JSON.stringify(state, null, 2));
}

export function newChatId(): string {
  // Sortable + collision-resistant for single-operator use.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `chat-${t}-${r}`;
}
