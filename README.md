# engram

A learning agent memory system with reflect loop. Engram stores facts extracted from text, links them to entities and relationships, and periodically synthesizes higher-order observations (patterns, preferences, insights).

Engram is two things:

1. **A TypeScript library** — import `Engram` and call `retain()`, `recall()`, `reflect()` directly.
2. **An MCP server** — run `engram-mcp` and connect any MCP client (Claude Desktop, Claude Code, etc.) over stdio.

Both use the same SQLite-backed engine. No external database required.

## How It Works

```
            text
              |
              v
    +---------+---------+
    |      retain()     |   Extract facts, entities, relations via LLM
    |  (or retainDirect)|   Store with embeddings + FTS index
    +---------+---------+
              |
              v
    +---------+---------+
    |      recall()     |   Hybrid search: semantic + keyword + temporal
    |                   |   Rank fusion with configurable weights
    +---------+---------+
              |
              v
    +---------+---------+
    |     reflect()     |   Cluster facts by shared entities
    |                   |   Synthesize observations (patterns/preferences/insights)
    +---------+---------+
```

**retain** — Ingests text, extracts atomic facts and entities via an LLM, embeds them, and stores everything in SQLite. Duplicate facts are skipped via content-hash deduplication. Optionally evaluates new facts against existing observations to adjust confidence.

**retainDirect** — Same as retain but accepts pre-extracted facts/entities/relations, skipping the LLM extraction call entirely. Useful when you already have structured data.

**recall** — Hybrid retrieval combining semantic similarity (sqlite-vec), keyword matching (FTS5), and temporal filtering (chrono-node). Scores are fused with configurable weights and observations get a priority boost.

**reflect** — Groups facts by shared entities into clusters, then synthesizes higher-order observations using an LLM. Duplicate observations merge evidence and bump confidence. Low-confidence observations are archived.

**forget** — Removes facts by ID, age, or TTL expiry. FTS5 and entity links are cleaned up automatically.

## Quick Start

### Programmatic (TypeScript library)

```typescript
import { Engram, createProviders } from 'engram';

const { embedding, llm } = await createProviders({ provider: 'openai' });

const engram = new Engram(
  { dbPath: './memory.sqlite' },
  embedding,
  llm,
);

// Store information (LLM extracts facts automatically)
await engram.retain({
  text: 'Alice prefers TypeScript over JavaScript. She works at Acme Corp.',
  source: 'conversation',
});

// Store pre-extracted facts (no LLM call)
await engram.retainDirect({
  facts: [{ content: 'Bob uses vim keybindings' }],
  entities: [{ name: 'Bob', entityType: 'person' }],
});

// Search memory
const results = await engram.recall({
  query: 'What does Alice prefer?',
  limit: 5,
});

// Synthesize observations
await engram.reflect({ force: true });

// Remove a fact
engram.forget({ factId: 'some-fact-id' });

// Remove old facts
engram.forget({ olderThan: 30 * 24 * 60 * 60 * 1000 }); // 30 days

// List all memory banks
const banks = engram.listBanks();

engram.close();
```

### MCP Server

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Start the MCP server
npx engram-mcp
```

Add to your MCP client configuration (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["engram-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## MCP Tools Reference

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `retain` | Store text, extracting facts via LLM | `text`, `source?`, `bank?`, `max_age_ms?` |
| `retain_direct` | Store pre-extracted facts (no LLM) | `facts[]`, `entities?[]`, `relations?[]`, `bank?`, `max_age_ms?` |
| `recall` | Search memory with hybrid retrieval | `query`, `limit?`, `bank?`, `include_observations?`, `time_filter?` |
| `reflect` | Synthesize observations from facts | `focus?`, `bank?` |
| `inspect` | View stats, look up entities, or list banks | `bank?`, `entity?`, `list_banks?` |
| `forget` | Remove facts from memory | `fact_id?`, `before?`, `older_than_days?`, `bank?` |

## Concepts

### Banks

Memory banks provide isolated namespaces. Every fact, entity, and observation is scoped to a bank. Use banks to separate contexts (e.g. "work" vs "personal", or per-user).

```typescript
engram.createBank('work', 'Work', 'Professional context');
await engram.retain({ text: '...', bankId: 'work' });
const banks = engram.listBanks(); // discover all banks
```

### Facts vs Observations

- **Facts** are atomic pieces of information extracted from input text. Each has a content hash for deduplication, a confidence score, and optional entity links.
- **Observations** are higher-order insights synthesized by the reflect loop. Types: `pattern`, `preference`, `insight`. They track confidence that adjusts as new evidence arrives.

### Confidence

- Facts start at confidence 1.0.
- Observations start at 0.5 and adjust based on supporting/contradicting evidence.
- Observations below 0.1 confidence are archived during reflect.

### Entity Resolution

Entities are deduplicated by `(name, type, bank)`. When the same entity name appears again, metadata is merged rather than creating a duplicate.

## Configuration

```typescript
interface EngramConfig {
  dbPath: string;                    // SQLite database path (default: ':memory:')
  defaultBankId?: string;            // Default bank ID (default: 'default')
  defaultBankName?: string;          // Default bank name (default: 'Default')
  reflectThreshold?: number;         // Facts before auto-reflect triggers (default: 20)
  reflectInterval?: number;          // Min ms between reflects (default: 86400000 / 24h)
  autoReflect?: boolean;             // Enable auto-reflect after retain (default: true)
  skipEvidenceEvaluation?: boolean;  // Skip LLM evidence eval on retain (default: false)
  reflectMaxClusters?: number;       // Max clusters to process per reflect (default: 0 = unlimited)
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENGRAM_DB_PATH` | SQLite database file path | `~/.engram/memory.sqlite` |
| `ENGRAM_PROVIDER` | AI provider: `openai`, `anthropic`, `ollama` | `openai` |
| `ENGRAM_EMBEDDING_MODEL` | Override embedding model name | Provider default |
| `ENGRAM_LANGUAGE_MODEL` | Override language model name | Provider default |
| `ENGRAM_DEFAULT_BANK` | Default bank ID | `default` |
| `ENGRAM_DEFAULT_BANK_NAME` | Default bank name | `Default` |
| `ENGRAM_AUTO_REFLECT` | Set to `false` to disable auto-reflect | `true` |
| `ENGRAM_SKIP_EVIDENCE_EVAL` | Set to `true` to skip evidence evaluation | `false` |
| `ENGRAM_REFLECT_MAX_CLUSTERS` | Max clusters per reflect cycle | unlimited |

## Provider Support

### OpenAI (default)

```bash
export OPENAI_API_KEY=sk-...
export ENGRAM_PROVIDER=openai
```

- Embedding: `text-embedding-3-small` (1536 dimensions)
- Language: `gpt-4o-mini`

### Anthropic

```bash
export OPENAI_API_KEY=sk-...        # Still needed for embeddings
export ANTHROPIC_API_KEY=sk-ant-...
export ENGRAM_PROVIDER=anthropic
```

- Embedding: OpenAI `text-embedding-3-small` (1536 dimensions)
- Language: `claude-sonnet-4-5-20250929`

### Ollama (fully local, no API key)

Run everything locally with no API keys or cloud calls:

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
ENGRAM_PROVIDER=ollama npm run mcp
```

- Embedding: `nomic-embed-text` (768 dimensions)
- Language: `llama3.2`

### Custom Providers

Implement the `EmbeddingProvider` and `LLMProvider` interfaces:

```typescript
import type { EmbeddingProvider, LLMProvider } from 'engram';

class MyEmbedding implements EmbeddingProvider {
  readonly dimensions = 1536;
  async embed(text: string): Promise<Float32Array> { /* ... */ }
  async embedMany(texts: string[]): Promise<Float32Array[]> { /* ... */ }
}

class MyLLM implements LLMProvider {
  async extractFacts(text: string, bankContext?: string) { /* ... */ }
  async synthesizeObservations(facts, existing, bankContext?) { /* ... */ }
  async evaluateEvidence(fact, observation) { /* ... */ }
}

const engram = new Engram(config, new MyEmbedding(), new MyLLM());
```

## Cost Controls

The reflect loop and evidence evaluation make LLM calls that can add up. Two config options help control costs:

**`skipEvidenceEvaluation: true`** — Skips the fire-and-forget LLM call that evaluates each new fact against every active observation. This removes `O(facts * observations)` LLM calls per retain. Observation confidence will only change during reflect.

**`reflectMaxClusters: N`** — Limits reflect to the N largest entity clusters (by fact count). This caps the number of synthesis LLM calls per reflect cycle.

```typescript
const engram = new Engram({
  dbPath: './memory.sqlite',
  skipEvidenceEvaluation: true,  // No evidence eval LLM calls
  reflectMaxClusters: 5,         // Max 5 clusters per reflect
}, embedding, llm);
```

## Multi-Context via Banks

Banks are isolated memory namespaces. Use them for multi-user, multi-project, or multi-domain scenarios:

```typescript
// Create isolated banks
engram.createBank('user-alice', 'Alice', 'Alice personal memory');
engram.createBank('user-bob', 'Bob', 'Bob personal memory');

// Store to specific banks
await engram.retain({ text: '...', bankId: 'user-alice' });

// Search within a bank
await engram.recall({ query: '...', bankId: 'user-alice' });

// Discover all banks
const banks = engram.listBanks();
```

## TTL and Forgetting

Facts can be given a time-to-live (TTL) so they expire automatically:

```typescript
// Facts expire after 1 hour
await engram.retain({ text: '...', maxAge: 3600000 });

// Pre-extracted facts with TTL
await engram.retainDirect({ facts: [...], maxAge: 86400000 }); // 24h

// Manually prune expired facts
engram.pruneExpired();

// Forget specific fact
engram.forget({ factId: 'abc-123' });

// Forget facts older than 30 days
engram.forget({ olderThan: 30 * 24 * 60 * 60 * 1000 });

// Forget facts before a date
engram.forget({ before: new Date('2024-01-01') });
```

Expired facts are also opportunistically pruned at the start of each `retain()` and `retainDirect()` call.

## Testing and Development

**Requirements:** Node >= 20

### Project Structure

```
src/
  engram.ts              Main orchestrator (Engram class)
  types.ts               All domain interfaces
  index.ts               Public API exports
  store/
    schema.ts            SQLite DDL (tables, FTS5, triggers, vec0)
    migrations.ts        Forward-only schema migrations
    store.ts             MemoryStore — SQLite persistence layer
  pipelines/
    retain.ts            Ingestion: extract → embed → store
    recall.ts            Retrieval: hybrid search + rank fusion
    reflect.ts           Synthesis: cluster → synthesize → archive
    extract.ts           LLM prompt builders
  providers/
    types.ts             EmbeddingProvider + LLMProvider interfaces
    ai-sdk.ts            Vercel AI SDK implementation
    defaults.ts          Provider factory (openai/anthropic/ollama)
  mcp/
    server.ts            MCP server (6 tools + 1 resource)
  utils/
    hash.ts              SHA-256 content hashing
    temporal.ts          Natural language date parsing
    entity-resolver.ts   Entity dedup/merge
    rank-fusion.ts       Weighted score fusion
bin/
  engram-mcp.ts          CLI entry point for MCP server
tests/
  helpers/
    mock-providers.ts    Deterministic 4D mock embedding + mock LLM
  unit/                  Store, hash, temporal, rank-fusion, entity-resolver
  integration/           Full retain → recall → reflect cycles
```

### Running Tests

Tests use **mock providers** — deterministic 4-dimensional embeddings (MD5-based) and a mock LLM that does simple sentence splitting. No API key or network calls needed.

```bash
# Run all tests (57 tests, ~1s)
npm test

# Watch mode
npm run test:watch
```

### Building

```bash
npm run build           # TypeScript → dist/
npm run dev             # TypeScript watch mode
```

### Testing the MCP Server Locally

**Option 1: With the MCP Inspector** (interactive web UI)

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/bin/engram-mcp.js
```

This opens a browser UI where you can call `retain`, `recall`, `reflect`, `forget`, etc. interactively.

**Option 2: With a real provider**

```bash
export OPENAI_API_KEY=sk-...
npm run mcp
```

This starts the stdio MCP server. Connect any MCP client to it.

**Option 3: Fully local with Ollama** (no API key)

```bash
ollama pull nomic-embed-text && ollama pull llama3.2
ENGRAM_PROVIDER=ollama npm run mcp
```

### Writing Tests

Tests follow existing patterns in `tests/`. Use the mock providers from `tests/helpers/mock-providers.ts`:

```typescript
import { Engram } from '../../src/engram.js';
import { MockEmbeddingProvider, MockLLMProvider } from '../helpers/mock-providers.js';

const embedding = new MockEmbeddingProvider();  // 4D deterministic vectors
const llm = new MockLLMProvider();              // Sentence splitting, no network
const engram = new Engram({ dbPath: ':memory:' }, embedding, llm);
```

The `MockLLMProvider` accepts a custom `extractFn` if you need to control extraction behavior for a specific test.
