import type { FastifyReply } from 'fastify';

export type ServerEvent =
  | { type: 'run_state'; runId: string; state: unknown }
  | { type: 'run_created'; runId: string; state: unknown }
  | { type: 'plan'; runId: string; planMd: string }
  | { type: 'overview'; runId: string; overviewMd: string }
  | { type: 'pending_comments'; runId: string; comments: unknown[] }
  | { type: 'stack'; runId: string; stack: unknown | null }
  | { type: 'contract'; runId: string; sprint: string; contractMd: string }
  | { type: 'output'; runId: string; sprint: string; outputMd: string }
  | { type: 'verdict'; runId: string; sprint: string; verdictMd: string }
  | { type: 'transcript_append'; runId: string; logName: string; lines: unknown[] }
  | { type: 'transcript_reset'; runId: string; logName: string }
  | { type: 'dispatch'; runId: string; role: 'planner' | 'next' | 'auto_research'; status: 'started' | 'finished' | 'error'; error?: string }
  | { type: 'cost'; runId: string; perRole: Record<string, number>; total: number }
  | { type: 'hello'; serverVersion: string }
  // -------------------- Chat-session events --------------------
  | { type: 'chat_created'; chatId: string; state: unknown }
  | { type: 'chat_state'; chatId: string; state: unknown }
  | { type: 'chat_deleted'; chatId: string }
  | { type: 'chat_message'; chatId: string; message: unknown }
  | { type: 'chat_stream'; chatId: string; event: unknown }
  | { type: 'chat_system'; chatId: string; event: unknown }
  | { type: 'chat_result'; chatId: string; result: unknown }
  | { type: 'chat_notes'; chatId: string; notesMd: string }
  | { type: 'chat_comments'; chatId: string; comments: unknown[] }
  | { type: 'chat_reset'; chatId: string };

interface Subscriber {
  id: number;
  reply: FastifyReply;
  filterRunId?: string;
  filterChatId?: string;
}

export interface SubscribeOptions {
  runId?: string;
  chatId?: string;
}

export class EventBus {
  private subs: Subscriber[] = [];
  private nextId = 1;

  subscribe(reply: FastifyReply, opts: SubscribeOptions = {}): () => void {
    const sub: Subscriber = {
      id: this.nextId++,
      reply,
      filterRunId: opts.runId,
      filterChatId: opts.chatId
    };
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((s) => s.id !== sub.id);
    };
  }

  publish(event: ServerEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of this.subs) {
      // A subscriber that filters on a specific runId only wants events
      // tagged with that runId — chat events (no runId) are dropped.
      if (sub.filterRunId) {
        if (!('runId' in event)) continue;
        if (event.runId !== sub.filterRunId) continue;
      }
      // Same for chatId filtering — drops everything that isn't this chat.
      if (sub.filterChatId) {
        if (!('chatId' in event)) continue;
        if (event.chatId !== sub.filterChatId) continue;
      }
      try {
        sub.reply.raw.write(payload);
      } catch {
        // socket likely closed; cleanup happens on close event
      }
    }
  }

  size(): number {
    return this.subs.length;
  }
}
