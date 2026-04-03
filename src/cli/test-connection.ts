import { createProviders } from '../providers/defaults.js';
import type { ProviderConfig } from '../providers/defaults.js';

export interface ConnectionTestResult {
  embedding: {
    ok: boolean;
    latencyMs: number;
    error?: string;
  };
  llm: {
    ok: boolean;
    latencyMs: number;
    error?: string;
  };
}

export async function testConnection(
  config: ProviderConfig,
): Promise<ConnectionTestResult> {
  const result: ConnectionTestResult = {
    embedding: { ok: false, latencyMs: 0 },
    llm: { ok: false, latencyMs: 0 },
  };

  let embedding;
  let llm;

  try {
    const providers = await createProviders(config);
    embedding = providers.embedding;
    llm = providers.llm;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.embedding.error = msg;
    result.llm.error = msg;
    return result;
  }

  // Test embedding
  try {
    const start = performance.now();
    await embedding.embed('test connection');
    result.embedding.latencyMs = Math.round(performance.now() - start);
    result.embedding.ok = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.embedding.error = msg;
  }

  // Test LLM
  try {
    const start = performance.now();
    await llm.extractFacts('Alice likes TypeScript.');
    result.llm.latencyMs = Math.round(performance.now() - start);
    result.llm.ok = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.llm.error = msg;
  }

  return result;
}
