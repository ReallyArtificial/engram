import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Engram } from '../engram.js';
import type { EmbeddingProvider, LLMProvider } from '../providers/types.js';
import type { EngramConfig } from '../types.js';

export function createMcpServer(
  config: EngramConfig,
  embedding: EmbeddingProvider,
  llm: LLMProvider,
): McpServer {
  const engram = new Engram(config, embedding, llm);

  const server = new McpServer({
    name: 'engram',
    version: '0.1.0',
  });

  // --- retain tool ---
  server.tool(
    'retain',
    'Store new information in memory. Extracts facts, entities, and relationships from text.',
    {
      text: z.string().describe('The text content to remember'),
      source: z
        .string()
        .optional()
        .describe('Source of the information (e.g., "user conversation", "document")'),
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID (defaults to "default")'),
      max_age_ms: z
        .number()
        .optional()
        .describe('TTL in milliseconds — facts expire after this duration'),
    },
    async ({ text, source, bank, max_age_ms }) => {
      const result = await engram.retain({
        text,
        source,
        bankId: bank,
        maxAge: max_age_ms,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                factsStored: result.factsStored,
                factsSkipped: result.factsSkipped,
                entitiesResolved: result.entitiesResolved,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- retain_direct tool ---
  server.tool(
    'retain_direct',
    'Store pre-extracted facts directly, skipping LLM extraction. Use when you already have structured facts.',
    {
      facts: z.array(
        z.object({
          content: z.string().describe('The fact content'),
          occurredAt: z.string().optional().describe('ISO date when the fact occurred'),
        }),
      ).describe('Array of pre-extracted facts'),
      entities: z.array(
        z.object({
          name: z.string().describe('Entity name'),
          entityType: z.string().describe('Entity type (person, organization, technology, etc.)'),
          metadata: z.record(z.unknown()).optional().describe('Optional metadata'),
        }),
      ).optional().describe('Array of entities to associate'),
      relations: z.array(
        z.object({
          sourceName: z.string().describe('Source entity name'),
          targetName: z.string().describe('Target entity name'),
          relationType: z.string().describe('Type of relationship'),
        }),
      ).optional().describe('Array of entity relations'),
      source: z
        .string()
        .optional()
        .describe('Source of the information'),
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID (defaults to "default")'),
      max_age_ms: z
        .number()
        .optional()
        .describe('TTL in milliseconds — facts expire after this duration'),
    },
    async ({ facts, entities, relations, source, bank, max_age_ms }) => {
      const result = await engram.retainDirect({
        facts,
        entities,
        relations,
        source,
        bankId: bank,
        maxAge: max_age_ms,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                factsStored: result.factsStored,
                factsSkipped: result.factsSkipped,
                entitiesResolved: result.entitiesResolved,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- recall tool ---
  server.tool(
    'recall',
    'Search memory for relevant facts and observations. Uses semantic + keyword + temporal search with rank fusion.',
    {
      query: z.string().describe('What to search for'),
      limit: z
        .number()
        .optional()
        .describe('Max results to return (default: 10)'),
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID (defaults to "default")'),
      include_observations: z
        .boolean()
        .optional()
        .describe('Include synthesized observations (default: true)'),
      time_filter: z
        .string()
        .optional()
        .describe('Natural language time filter, e.g., "last week", "yesterday"'),
    },
    async ({ query, limit, bank, include_observations, time_filter }) => {
      const result = await engram.recall({
        query,
        limit,
        bankId: bank,
        includeObservations: include_observations,
        timeFilter: time_filter,
      });

      const formatted = result.results.map((r) => ({
        type: r.type,
        content: r.content,
        score: Math.round(r.score * 1000) / 1000,
        confidence: Math.round(r.confidence * 100) / 100,
        ...(r.source && { source: r.source }),
        ...(r.entities?.length && { entities: r.entities }),
        ...(r.observationType && { observationType: r.observationType }),
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                results: formatted,
                totalCandidates: result.totalCandidates,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- reflect tool ---
  server.tool(
    'reflect',
    'Synthesize higher-order observations from accumulated facts. Groups facts by shared entities and generates patterns, preferences, and insights.',
    {
      focus: z
        .string()
        .optional()
        .describe('Optional focus area to filter reflection'),
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID (defaults to "default")'),
    },
    async ({ focus, bank }) => {
      const result = await engram.reflect({
        focus,
        bankId: bank,
        force: true,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // --- inspect tool ---
  server.tool(
    'inspect',
    'View memory stats, look up a specific entity, or list all banks.',
    {
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID to inspect'),
      entity: z
        .string()
        .optional()
        .describe('Entity name to look up'),
      list_banks: z
        .boolean()
        .optional()
        .describe('Set to true to list all memory banks'),
    },
    async ({ bank, entity, list_banks }) => {
      if (list_banks) {
        const banks = engram.listBanks();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ banks }, null, 2),
            },
          ],
        };
      }

      if (entity) {
        // Entity lookup across the bank
        const store = engram.getStore();
        const bankId = bank ?? 'default';

        // Search for entities matching the name
        const stmt = store.db.prepare(
          `SELECT e.*, GROUP_CONCAT(f.content, '|||') as fact_contents
           FROM entities e
           LEFT JOIN entity_facts ef ON e.id = ef.entity_id
           LEFT JOIN facts f ON ef.fact_id = f.id
           WHERE e.name LIKE ? AND e.bank_id = ?
           GROUP BY e.id`,
        );
        const rows = stmt.all(`%${entity}%`, bankId) as Array<
          Record<string, unknown> & { fact_contents: string | null }
        >;

        const results = rows.map((r) => ({
          name: r.name,
          type: r.entity_type,
          facts: r.fact_contents
            ? (r.fact_contents as string).split('|||')
            : [],
          metadata: r.metadata ? JSON.parse(r.metadata as string) : null,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ entities: results }, null, 2),
            },
          ],
        };
      }

      // General stats
      const stats = engram.getStats();
      const bankInfo = bank ? engram.getBank(bank) : undefined;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                stats,
                ...(bankInfo && { bank: bankInfo }),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- forget tool ---
  server.tool(
    'forget',
    'Remove facts from memory. Can target a specific fact, facts older than a date, or facts older than N days.',
    {
      fact_id: z
        .string()
        .optional()
        .describe('Specific fact ID to remove'),
      before: z
        .string()
        .optional()
        .describe('ISO date — remove facts created before this date'),
      older_than_days: z
        .number()
        .optional()
        .describe('Remove facts older than this many days'),
      bank: z
        .string()
        .optional()
        .describe('Memory bank ID (defaults to "default")'),
    },
    async ({ fact_id, before, older_than_days, bank }) => {
      const result = engram.forget({
        factId: fact_id,
        before: before ? new Date(before) : undefined,
        olderThan: older_than_days
          ? older_than_days * 24 * 60 * 60 * 1000
          : undefined,
        bankId: bank,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // --- resource: bank config ---
  server.resource(
    'bank-config',
    'engram://bank/{bankId}',
    async (uri) => {
      const bankId = uri.pathname.split('/').pop() ?? 'default';
      const bank = engram.getBank(bankId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(bank ?? { error: 'Bank not found' }),
          },
        ],
      };
    },
  );

  return server;
}
