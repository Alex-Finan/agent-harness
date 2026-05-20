import * as path from 'node:path';
import * as os from 'node:os';
import { harnessHome, runDir, sprintDir, sprintArtifactPath } from '../../src/state/paths.js';

describe('paths', () => {
  test('harnessHome defaults to ~/.agent-harness', () => {
    expect(harnessHome()).toBe(path.join(os.homedir(), '.agent-harness'));
  });

  test('harnessHome honors AGENT_HARNESS_HOME env override', () => {
    const prev = process.env.AGENT_HARNESS_HOME;
    process.env.AGENT_HARNESS_HOME = '/tmp/foo';
    expect(harnessHome()).toBe('/tmp/foo');
    if (prev === undefined) delete process.env.AGENT_HARNESS_HOME;
    else process.env.AGENT_HARNESS_HOME = prev;
  });

  test('runDir composes correctly', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(runDir('run-abc')).toBe('/tmp/h/runs/run-abc');
    delete process.env.AGENT_HARNESS_HOME;
  });

  test('sprintDir uses 2-digit zero-padded numbers', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(sprintDir('run-abc', 3, 'add-graph-features'))
      .toBe('/tmp/h/runs/run-abc/sprints/03-add-graph-features');
    delete process.env.AGENT_HARNESS_HOME;
  });

  test('sprintArtifactPath builds expected file paths', () => {
    process.env.AGENT_HARNESS_HOME = '/tmp/h';
    expect(sprintArtifactPath('run-abc', 1, 'init', 'contract.md'))
      .toBe('/tmp/h/runs/run-abc/sprints/01-init/contract.md');
    delete process.env.AGENT_HARNESS_HOME;
  });
});
