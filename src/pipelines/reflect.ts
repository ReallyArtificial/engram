import type { MemoryStore } from '../store/store.js';
import type { EmbeddingProvider, LLMProvider } from '../providers/types.js';
import type { ReflectInput, ReflectResult, Fact } from '../types.js';
import { contentHash } from '../utils/hash.js';

const DEFAULT_BANK_ID = 'default';
const DEFAULT_REFLECT_THRESHOLD = 20;
const DEFAULT_REFLECT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_OBSERVATION_CONFIDENCE = 0.5;
const DUPLICATE_CONFIDENCE_BUMP = 0.05;

export class ReflectPipeline {
  private maxClusters: number;

  constructor(
    private store: MemoryStore,
    private embedding: EmbeddingProvider,
    private llm: LLMProvider,
    private threshold: number = DEFAULT_REFLECT_THRESHOLD,
    private intervalMs: number = DEFAULT_REFLECT_INTERVAL_MS,
    maxClusters: number = 0,
  ) {
    this.maxClusters = maxClusters;
  }

  shouldTrigger(bankId: string): { should: boolean; reason: string } {
    const lastReflect = this.store.getLastReflect(bankId);

    if (!lastReflect) {
      // Never reflected — check fact count
      const stats = this.store.getStats();
      if (stats.facts >= this.threshold) {
        return {
          should: true,
          reason: `First reflection: ${stats.facts} facts accumulated`,
        };
      }
      return { should: false, reason: 'Not enough facts yet' };
    }

    // Check fact count since last reflect
    const factCount = this.store.countFactsSince(
      bankId,
      lastReflect.created_at,
    );
    if (factCount >= this.threshold) {
      return {
        should: true,
        reason: `${factCount} new facts since last reflection`,
      };
    }

    // Check time elapsed
    const elapsed =
      Date.now() - new Date(lastReflect.created_at).getTime();
    if (elapsed >= this.intervalMs && factCount > 0) {
      return {
        should: true,
        reason: `${Math.round(elapsed / 3600000)}h since last reflection with ${factCount} new facts`,
      };
    }

    return { should: false, reason: 'Threshold not met' };
  }

  async execute(input: ReflectInput): Promise<ReflectResult> {
    const bankId = input.bankId ?? DEFAULT_BANK_ID;
    this.store.ensureBank(bankId, 'Default');

    const bank = this.store.getBank(bankId);
    const bankContext = bank?.description;

    // 1. Get facts since last reflection
    const lastReflect = this.store.getLastReflect(bankId);
    const since = lastReflect?.created_at ?? '1970-01-01T00:00:00.000Z';

    // 2. Cluster facts by shared entities
    const clusters = this.store.getFactClusters(bankId, since);

    // 3. Optional: filter by focus
    let filteredClusters: Map<string, Fact[]>;
    if (input.focus) {
      const focusLower = input.focus.toLowerCase();
      filteredClusters = new Map();
      for (const [entityId, facts] of clusters) {
        const hasRelevant = facts.some((f) =>
          f.content.toLowerCase().includes(focusLower),
        );
        if (hasRelevant) {
          filteredClusters.set(entityId, facts);
        }
      }
    } else {
      filteredClusters = clusters;
    }

    // 4. Limit clusters if maxClusters is set
    if (this.maxClusters > 0 && filteredClusters.size > this.maxClusters) {
      const sorted = [...filteredClusters.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      );
      filteredClusters = new Map(sorted.slice(0, this.maxClusters));
    }

    let observationsCreated = 0;
    let observationsUpdated = 0;
    let factsProcessed = 0;

    // 5. Get existing observations for context
    const existingObservations = this.store.getActiveObservations(bankId);

    // 6. Per cluster: synthesize observations
    for (const [, facts] of filteredClusters) {
      factsProcessed += facts.length;

      const synthesized = await this.llm.synthesizeObservations(
        facts,
        existingObservations,
        bankContext,
      );

      for (const obs of synthesized) {
        const hash = contentHash(obs.content);

        // Check for duplicate
        const existing = this.store.getObservationByHash(hash, bankId);
        if (existing) {
          // Merge evidence + bump confidence
          const mergedEvidence = [
            ...new Set([
              ...existing.evidenceFactIds,
              ...facts.map((f) => f.id),
            ]),
          ];
          const newConfidence = Math.min(
            1,
            existing.confidence + DUPLICATE_CONFIDENCE_BUMP,
          );
          this.store.updateObservationEvidence(
            existing.id,
            mergedEvidence,
            newConfidence,
          );
          observationsUpdated++;
        } else {
          // Insert new observation
          const obsEmbedding = await this.embedding.embed(obs.content);
          this.store.insertObservation(
            obs.content,
            hash,
            obs.observationType,
            bankId,
            facts.map((f) => f.id),
            INITIAL_OBSERVATION_CONFIDENCE,
            obsEmbedding,
          );
          observationsCreated++;
        }
      }
    }

    // 7. Archive low-confidence observations
    const observationsArchived = this.store.archiveLowConfidence(bankId);

    // 8. Log
    this.store.insertReflectLog(
      bankId,
      factsProcessed,
      observationsCreated,
      observationsUpdated,
      observationsArchived,
      filteredClusters.size,
    );

    return {
      observationsCreated,
      observationsUpdated,
      observationsArchived,
      factsProcessed,
      clusters: filteredClusters.size,
    };
  }
}
