import type { MemoryStore } from '../store/store.js';
import type { EmbeddingProvider } from '../providers/types.js';
import type { RecallInput, RecallResult, ScoredMemory } from '../types.js';
import { parseTemporalFilter } from '../utils/temporal.js';
import {
  fuseScores,
  cosineDistanceToSimilarity,
  fts5RankToScore,
} from '../utils/rank-fusion.js';

const DEFAULT_BANK_ID = 'default';
const DEFAULT_LIMIT = 10;
const OBSERVATION_PRIORITY_MULTIPLIER = 1.2;

interface CandidateScores {
  semantic?: number;
  keyword?: number;
  temporal?: number;
}

export class RecallPipeline {
  constructor(
    private store: MemoryStore,
    private embedding: EmbeddingProvider,
  ) {}

  async execute(input: RecallInput): Promise<RecallResult> {
    const bankId = input.bankId ?? DEFAULT_BANK_ID;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const includeObservations = input.includeObservations ?? true;

    // 1. Embed query
    const queryEmbedding = await this.embedding.embed(input.query);

    // 2. Build FTS5 query — simple tokenization
    const ftsQuery = input.query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => `"${w}"`)
      .join(' OR ');

    // 3. Parallel searches
    const factCandidates = new Map<string, CandidateScores>();
    const observationCandidates = new Map<string, CandidateScores>();

    // Semantic search - facts
    const semanticFacts = this.store.searchFactsBySemantic(
      queryEmbedding,
      bankId,
      limit * 2,
    );
    for (const result of semanticFacts) {
      const scores = factCandidates.get(result.factId) ?? {};
      scores.semantic = cosineDistanceToSimilarity(result.distance);
      factCandidates.set(result.factId, scores);
    }

    // Semantic search - observations
    if (includeObservations) {
      const semanticObs = this.store.searchObservationsBySemantic(
        queryEmbedding,
        bankId,
        limit,
      );
      for (const result of semanticObs) {
        const scores = observationCandidates.get(result.observationId) ?? {};
        scores.semantic = cosineDistanceToSimilarity(result.distance);
        observationCandidates.set(result.observationId, scores);
      }
    }

    // Keyword search - facts
    if (ftsQuery) {
      try {
        const keywordFacts = this.store.searchFactsByKeyword(
          ftsQuery,
          bankId,
          limit * 2,
        );
        const worstRank =
          keywordFacts.length > 0
            ? Math.min(...keywordFacts.map((r) => r.rank))
            : -1;
        for (const result of keywordFacts) {
          const scores = factCandidates.get(result.factId) ?? {};
          scores.keyword = fts5RankToScore(result.rank, worstRank);
          factCandidates.set(result.factId, scores);
        }

        // Keyword search - observations
        if (includeObservations) {
          const keywordObs = this.store.searchObservationsByKeyword(
            ftsQuery,
            bankId,
            limit,
          );
          const worstObsRank =
            keywordObs.length > 0
              ? Math.min(...keywordObs.map((r) => r.rank))
              : -1;
          for (const result of keywordObs) {
            const scores =
              observationCandidates.get(result.observationId) ?? {};
            scores.keyword = fts5RankToScore(result.rank, worstObsRank);
            observationCandidates.set(result.observationId, scores);
          }
        }
      } catch {
        // FTS5 query syntax error — skip keyword results
      }
    }

    // Temporal filter
    let temporalFactIds: Set<string> | undefined;
    if (input.timeFilter) {
      const range = parseTemporalFilter(input.timeFilter);
      const temporalFacts = this.store.getFactsInDateRange(
        bankId,
        range.start,
        range.end,
      );
      temporalFactIds = new Set(temporalFacts.map((f) => f.id));

      // Add temporal scores
      for (const [factId, scores] of factCandidates) {
        scores.temporal = temporalFactIds.has(factId) ? 1 : 0;
      }
    }

    // 4. Fuse scores
    const results: ScoredMemory[] = [];
    const totalCandidates =
      factCandidates.size + observationCandidates.size;

    // Score facts
    for (const [factId, scores] of factCandidates) {
      const fused = fuseScores(scores);
      const fact = this.store.getFact(factId);
      if (!fact) continue;

      results.push({
        type: 'fact',
        id: factId,
        content: fact.content,
        score: fused,
        confidence: fact.confidence,
        source: fact.source,
        entities: fact.entities?.map((e) => e.name),
        occurredAt: fact.occurredAt,
        createdAt: fact.createdAt,
      });
    }

    // Score observations with priority multiplier
    for (const [obsId, scores] of observationCandidates) {
      const fused = fuseScores(scores) * OBSERVATION_PRIORITY_MULTIPLIER;
      const obs = this.store.getObservation(obsId);
      if (!obs) continue;

      results.push({
        type: 'observation',
        id: obsId,
        content: obs.content,
        score: Math.min(fused, 1),
        confidence: obs.confidence,
        observationType: obs.observationType,
        createdAt: obs.createdAt,
      });
    }

    // 5. Sort by score descending, limit
    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, limit);

    return {
      results: limited,
      query: input.query,
      totalCandidates,
    };
  }
}
