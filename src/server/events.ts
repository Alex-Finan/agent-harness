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
  | { type: 'hello'; serverVersion: string };

interface Subscriber {
  id: number;
  reply: FastifyReply;
  filterRunId?: string;
}

export class EventBus {
  private subs: Subscriber[] = [];
  private nextId = 1;

  subscribe(reply: FastifyReply, filterRunId?: string): () => void {
    const sub: Subscriber = { id: this.nextId++, reply, filterRunId };
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((s) => s.id !== sub.id);
    };
  }

  publish(event: ServerEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of this.subs) {
      if (sub.filterRunId && 'runId' in event && event.runId !== sub.filterRunId) continue;
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
