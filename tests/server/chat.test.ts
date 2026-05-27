import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { jest } from '@jest/globals';

// Don't mock anything — chat REST endpoints touch only the filesystem and the
// SSE bus. The subprocess only spawns on `send`, which we don't exercise here
// (that's the manual smoke).

const { buildServer } = await import('../../src/server/api.js');

describe('chat API', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-chat-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });

  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function withServer<T>(
    fn: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<T>
  ): Promise<T> {
    const built = await buildServer({ logger: false });
    try {
      return await fn(built);
    } finally {
      await built.chat.shutdown();
      await built.watcher.stop();
      await built.app.close();
    }
  }

  test('GET /api/chat returns [] initially', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/api/chat' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ chats: [] });
    });
  });

  test('POST /api/chat creates a chat and persists state.json', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { title: 'Test chat', cwd: tmp, permission_mode: 'acceptEdits' }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.chat.title).toBe('Test chat');
      expect(body.chat.cwd).toBe(tmp);
      expect(body.chat.permission_mode).toBe('acceptEdits');
      expect(body.chat.status).toBe('idle');
      expect(body.chat.turn_count).toBe(0);

      // state.json on disk
      const statePath = path.join(tmp, 'chats', body.chat.chat_id, 'state.json');
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.chat_id).toBe(body.chat.chat_id);
      expect(parsed.session_id).toMatch(/^[0-9a-f]{8}-/);

      // transcript and notes scaffolded empty
      const transcript = await fs.readFile(
        path.join(tmp, 'chats', body.chat.chat_id, 'transcript.jsonl'),
        'utf8'
      );
      const notes = await fs.readFile(
        path.join(tmp, 'chats', body.chat.chat_id, 'notes.md'),
        'utf8'
      );
      expect(transcript).toBe('');
      expect(notes).toBe('');
    });
  });

  test('POST /api/chat returns 400 for non-existent cwd', async () => {
    await withServer(async ({ app }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { cwd: '/this/path/should/not/exist/abc123' }
      });
      expect(res.statusCode).toBe(400);
    });
  });

  test('GET /api/chat/:id returns full detail', async () => {
    await withServer(async ({ app }) => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { cwd: tmp }
      });
      const chatId = create.json().chat.chat_id;

      const detail = await app.inject({ method: 'GET', url: `/api/chat/${chatId}` });
      expect(detail.statusCode).toBe(200);
      const body = detail.json();
      expect(body.state.chat_id).toBe(chatId);
      expect(body.transcript).toEqual([]);
      expect(body.comments).toEqual([]);
      expect(body.notesMd).toBe('');
    });
  });

  test('PUT /api/chat/:id/notes round-trips', async () => {
    await withServer(async ({ app }) => {
      const create = await app.inject({ method: 'POST', url: '/api/chat', payload: { cwd: tmp } });
      const chatId = create.json().chat.chat_id;

      const put = await app.inject({
        method: 'PUT',
        url: `/api/chat/${chatId}/notes`,
        payload: { notesMd: '# scratchpad\n\n- thought 1\n- thought 2\n' }
      });
      expect(put.statusCode).toBe(200);

      const get = await app.inject({ method: 'GET', url: `/api/chat/${chatId}/notes` });
      expect(get.json().notesMd).toBe('# scratchpad\n\n- thought 1\n- thought 2\n');
    });
  });

  test('comment CRUD: add, patch, delete', async () => {
    await withServer(async ({ app }) => {
      const create = await app.inject({ method: 'POST', url: '/api/chat', payload: { cwd: tmp } });
      const chatId = create.json().chat.chat_id;

      const add = await app.inject({
        method: 'POST',
        url: `/api/chat/${chatId}/comments`,
        payload: {
          message_id: 'msg_abc',
          anchor: {
            start_line: 0,
            start_col: 0,
            end_line: 0,
            end_col: 10,
            quoted_text: 'first ten'
          },
          body: 'a thought'
        }
      });
      expect(add.statusCode).toBe(200);
      const cid = add.json().comment.id;

      const list = await app.inject({ method: 'GET', url: `/api/chat/${chatId}/comments` });
      expect(list.json().comments).toHaveLength(1);
      expect(list.json().comments[0].message_id).toBe('msg_abc');

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/chat/${chatId}/comments/${cid}`,
        payload: { body: 'revised thought' }
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().comment.body).toBe('revised thought');
      expect(patch.json().comment.updated_at).toBeDefined();

      const del = await app.inject({ method: 'DELETE', url: `/api/chat/${chatId}/comments/${cid}` });
      expect(del.statusCode).toBe(200);

      const after = await app.inject({ method: 'GET', url: `/api/chat/${chatId}/comments` });
      expect(after.json().comments).toEqual([]);
    });
  });

  test('PATCH on missing comment returns 404', async () => {
    await withServer(async ({ app }) => {
      const create = await app.inject({ method: 'POST', url: '/api/chat', payload: { cwd: tmp } });
      const chatId = create.json().chat.chat_id;
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/${chatId}/comments/does-not-exist`,
        payload: { body: 'x' }
      });
      expect(res.statusCode).toBe(404);
    });
  });

  test('DELETE /api/chat/:id removes the on-disk dir', async () => {
    await withServer(async ({ app }) => {
      const create = await app.inject({ method: 'POST', url: '/api/chat', payload: { cwd: tmp } });
      const chatId = create.json().chat.chat_id;
      const dir = path.join(tmp, 'chats', chatId);
      expect(await fs.stat(dir).then(() => true)).toBe(true);

      const del = await app.inject({ method: 'DELETE', url: `/api/chat/${chatId}` });
      expect(del.statusCode).toBe(200);

      await expect(fs.stat(dir)).rejects.toThrow();

      const list = await app.inject({ method: 'GET', url: '/api/chat' });
      expect(list.json().chats).toEqual([]);
    });
  });

  test('listChats returns newest-first', async () => {
    await withServer(async ({ app }) => {
      const a = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { cwd: tmp, title: 'first' }
      });
      // Ensure different updated_at timestamps even on fast machines.
      await new Promise((r) => setTimeout(r, 5));
      const b = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { cwd: tmp, title: 'second' }
      });
      const list = await app.inject({ method: 'GET', url: '/api/chat' });
      const chats = list.json().chats;
      expect(chats).toHaveLength(2);
      expect(chats[0].chat_id).toBe(b.json().chat.chat_id);
      expect(chats[1].chat_id).toBe(a.json().chat.chat_id);
    });
  });
});
