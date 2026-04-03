import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface OllamaModel {
  name: string;
}

export interface DetectionResult {
  openaiKey: string | null;
  anthropicKey: string | null;
  ollamaRunning: boolean;
  ollamaModels: OllamaModel[];
  claudeCliVersion: string | null;
  existingRegistration: boolean;
  existingDbPath: string | null;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 7) + '...' + key.slice(-4);
}

export { maskKey };

async function detectOllama(): Promise<{
  running: boolean;
  models: OllamaModel[];
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { running: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => ({ name: m.name }));
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

function detectClaudeCli(): string | null {
  try {
    const version = execSync('claude --version', {
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return version || null;
  } catch {
    return null;
  }
}

function detectExistingRegistration(): boolean {
  try {
    execSync('claude mcp get engram', {
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function detectExistingDb(): string | null {
  const defaultPath = join(homedir(), '.engram', 'memory.sqlite');
  return existsSync(defaultPath) ? defaultPath : null;
}

export async function detectEnvironment(): Promise<DetectionResult> {
  const openaiKey = process.env.OPENAI_API_KEY ?? null;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null;

  const [ollamaResult, claudeVersion, registration, existingDb] =
    await Promise.all([
      detectOllama(),
      Promise.resolve(detectClaudeCli()),
      Promise.resolve(detectExistingRegistration()),
      Promise.resolve(detectExistingDb()),
    ]);

  return {
    openaiKey,
    anthropicKey,
    ollamaRunning: ollamaResult.running,
    ollamaModels: ollamaResult.models,
    claudeCliVersion: claudeVersion,
    existingRegistration: registration,
    existingDbPath: existingDb,
  };
}
