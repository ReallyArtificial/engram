#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createProviders } from '../src/providers/defaults.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

async function main() {
  const dbPath =
    process.env.ENGRAM_DB_PATH ??
    join(homedir(), '.engram', 'memory.sqlite');

  // Ensure directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });

  const providerName = (process.env.ENGRAM_PROVIDER ?? 'openai') as
    | 'openai'
    | 'anthropic'
    | 'ollama';

  const { embedding, llm } = await createProviders({
    provider: providerName,
    embeddingModel: process.env.ENGRAM_EMBEDDING_MODEL,
    languageModel: process.env.ENGRAM_LANGUAGE_MODEL,
  });

  const reflectMaxClusters = process.env.ENGRAM_REFLECT_MAX_CLUSTERS
    ? parseInt(process.env.ENGRAM_REFLECT_MAX_CLUSTERS, 10)
    : undefined;

  const server = createMcpServer(
    {
      dbPath,
      defaultBankId: process.env.ENGRAM_DEFAULT_BANK ?? 'default',
      defaultBankName: process.env.ENGRAM_DEFAULT_BANK_NAME ?? 'Default',
      autoReflect: process.env.ENGRAM_AUTO_REFLECT !== 'false',
      skipEvidenceEvaluation: process.env.ENGRAM_SKIP_EVIDENCE_EVAL === 'true',
      reflectMaxClusters,
    },
    embedding,
    llm,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Engram MCP server failed to start:', err);
  process.exit(1);
});
