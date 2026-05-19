import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the SDK before importing the wrapper.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { runSession } from '../../src/sdk/session.js';

const mockedQuery = query as unknown as jest.Mock;

async function* fakeStream(messages: unknown[]): AsyncIterable<unknown> {
  for (const m of messages) yield m;
}

describe('runSession', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sdk-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    mockedQuery.mockReset();
  });

  test('streams messages, writes transcript, returns final text', async () => {
    mockedQuery.mockReturnValue(
      fakeStream([
        { type: 'assistant', content: [{ type: 'text', text: 'thinking...' }] },
        { type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.01 }
      ])
    );

    const transcriptPath = path.join(tmp, 'transcript.log');
    const result = await runSession({
      prompt: 'go',
      systemPrompt: 'you are a tester',
      allowedTools: ['Read'],
      cwd: tmp,
      maxTurns: 10,
      maxBudgetUsd: 1,
      transcriptPath
    });

    expect(result.success).toBe(true);
    expect(result.resultText).toBe('done');
    const transcript = await fs.readFile(transcriptPath, 'utf8');
    expect(transcript).toContain('"type":"assistant"');
    expect(transcript).toContain('"type":"result"');
  });

  test('returns success=false when subtype is not success', async () => {
    mockedQuery.mockReturnValue(
      fakeStream([{ type: 'result', subtype: 'error_max_turns' }])
    );

    const result = await runSession({
      prompt: 'go',
      systemPrompt: 's',
      allowedTools: [],
      cwd: tmp,
      maxTurns: 1,
      maxBudgetUsd: 1,
      transcriptPath: path.join(tmp, 'tr.log')
    });

    expect(result.success).toBe(false);
    expect(result.failureSubtype).toBe('error_max_turns');
  });
});
