import { writeAtomic, readOrNull } from '../lib/fs.js';
import { chatCommentsPath } from './paths.js';
import type { CommentAnchor } from './pendingComments.js';

/**
 * Persistent annotation attached to a specific assistant message in a chat
 * transcript. Reuses the CommentAnchor shape (line/col within the rendered
 * message text) and adds message_id so highlights survive scrolling /
 * re-renders.
 *
 * Unlike pending_comments on runs (cleared after each planner iteration),
 * chat comments live forever — they're the operator's persistent mental
 * marks on the conversation.
 */
export interface ChatComment {
  id: string;
  message_id: string;
  anchor: CommentAnchor;
  body: string;
  created_at: string;
  updated_at?: string;
}

interface ChatCommentsFile {
  comments: ChatComment[];
}

export async function readChatComments(chatId: string): Promise<ChatComment[]> {
  const raw = await readOrNull(chatCommentsPath(chatId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatCommentsFile;
    if (parsed && Array.isArray(parsed.comments)) return parsed.comments;
  } catch {
    /* corrupt file — treat as empty so we don't wedge the UI */
  }
  return [];
}

export async function writeChatComments(
  chatId: string,
  comments: ChatComment[]
): Promise<void> {
  await writeAtomic(
    chatCommentsPath(chatId),
    JSON.stringify({ comments } satisfies ChatCommentsFile, null, 2)
  );
}

export function newChatCommentId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `cc-${t}-${r}`;
}
