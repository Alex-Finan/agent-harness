import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { harnessHome } from './paths.js';
import { ensureDir, readOrNull } from '../lib/fs.js';

export interface HarnessConfig {
  anthropic_api_key?: string;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  masked: string | null;
  source: 'env' | 'config' | 'none';
}

export function configPath(): string {
  return path.join(harnessHome(), 'config.json');
}

export async function loadConfig(): Promise<HarnessConfig> {
  const raw = await readOrNull(configPath());
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as HarnessConfig;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

export async function saveConfig(config: HarnessConfig): Promise<void> {
  const target = configPath();
  await ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, target);
  try {
    await fs.chmod(target, 0o600);
  } catch {
    /* best-effort on non-POSIX */
  }
}

/**
 * Snapshot of whether ANTHROPIC_API_KEY was set in the *real* environment
 * before applyConfigToEnv() ran. Captured at module load so we can tell the
 * difference between "user exported the key" and "we hydrated it from the
 * config file" — both look identical in process.env afterward.
 */
const envKeyAtBoot: string | undefined =
  process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0
    ? process.env.ANTHROPIC_API_KEY
    : undefined;

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '****';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * Read the API key status without ever returning the raw key to the caller.
 * Env wins over config so users with existing setups aren't surprised.
 */
export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  if (envKeyAtBoot) {
    return { hasKey: true, masked: maskKey(envKeyAtBoot), source: 'env' };
  }
  const cfg = await loadConfig();
  if (cfg.anthropic_api_key && cfg.anthropic_api_key.trim().length > 0) {
    return { hasKey: true, masked: maskKey(cfg.anthropic_api_key), source: 'config' };
  }
  return { hasKey: false, masked: null, source: 'none' };
}

/**
 * Inject the persisted API key into process.env if one isn't already set.
 * Called at server boot so subsequent SDK calls pick it up. The env var
 * always wins — a user who exported ANTHROPIC_API_KEY keeps that key.
 */
export async function applyConfigToEnv(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0) return;
  const cfg = await loadConfig();
  if (cfg.anthropic_api_key && cfg.anthropic_api_key.trim().length > 0) {
    process.env.ANTHROPIC_API_KEY = cfg.anthropic_api_key;
  }
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('api key cannot be empty');
  const cfg = await loadConfig();
  cfg.anthropic_api_key = trimmed;
  await saveConfig(cfg);
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = trimmed;
  }
}

export async function clearApiKey(): Promise<void> {
  const cfg = await loadConfig();
  delete cfg.anthropic_api_key;
  await saveConfig(cfg);
}
