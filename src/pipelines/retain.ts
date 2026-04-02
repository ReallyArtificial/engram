import type { MemoryStore, InsertFactParams } from '../store/store.js';
import type { EmbeddingProvider, LLMProvider } from '../providers/types.js';
import type {
  RetainInput,
  RetainDirectInput,
  RetainResult,
  ExtractionResult,
  ExtractedEntity,
} from '../types.js';
import { contentHash } from '../utils/hash.js';
import { resolveEntity } from '../utils/entity-resolver.js';

const DEFAULT_BANK_ID = 'default';
const DEFAULT_BANK_NAME = 'Default';

export interface RetainPipelineConfig {
  skipEvidenceEvaluation?: boolean;
}

export class RetainPipeline {
  private skipEvidenceEvaluation: boolean;

  constructor(
    private store: MemoryStore,
    private embedding: EmbeddingProvider,
    private llm: LLMProvider,
    config?: RetainPipelineConfig,
  ) {
    this.skipEvidenceEvaluation = config?.skipEvidenceEvaluation ?? false;
  }

  async execute(input: RetainInput): Promise<RetainResult> {
    const bankId = input.bankId ?? DEFAULT_BANK_ID;
    this.store.ensureBank(bankId, DEFAULT_BANK_NAME);

    const bank = this.store.getBank(bankId);
    const bankContext = bank?.description;

    // 1. LLM extracts facts + entities + relations
    const extraction = await this.llm.extractFacts(input.text, bankContext);

    // 2. Store via shared path
    return this._storeExtraction(extraction, bankId, input.source, input.maxAge);
  }

  async executeDirect(input: RetainDirectInput): Promise<RetainResult> {
    const bankId = input.bankId ?? DEFAULT_BANK_ID;
    this.store.ensureBank(bankId, DEFAULT_BANK_NAME);

    const extraction: ExtractionResult = {
      facts: input.facts,
      entities: input.entities ?? [],
      relations: input.relations ?? [],
    };

    return this._storeExtraction(extraction, bankId, input.source, input.maxAge);
  }

  private async _storeExtraction(
    extraction: ExtractionResult,
    bankId: string,
    source?: string,
    maxAge?: number,
  ): Promise<RetainResult> {
    // 1. Resolve entities (dedup by name+type+bank)
    const entityMap = new Map<string, string>(); // name -> entityId
    let entitiesResolved = 0;

    for (const ext of extraction.entities) {
      const resolved = resolveEntity(this.store, ext, bankId);
      entityMap.set(ext.name, resolved.entityId);
      entitiesResolved++;
    }

    // 2. Batch embed all fact contents (one API call)
    const factContents = extraction.facts.map((f) => f.content);
    const embeddings =
      factContents.length > 0
        ? await this.embedding.embedMany(factContents)
        : [];

    // 3. Compute expiresAt from maxAge
    const expiresAt = maxAge ? new Date(Date.now() + maxAge) : undefined;

    // 4. Store each fact atomically
    const factIds: string[] = [];
    let factsSkipped = 0;

    for (let i = 0; i < extraction.facts.length; i++) {
      const fact = extraction.facts[i];
      const hash = contentHash(fact.content);

      // Find entity IDs for this fact by checking which entities are mentioned
      const linkedEntityIds: string[] = [];
      for (const entity of extraction.entities) {
        if (
          fact.content.toLowerCase().includes(entity.name.toLowerCase()) &&
          entityMap.has(entity.name)
        ) {
          linkedEntityIds.push(entityMap.get(entity.name)!);
        }
      }

      const factId = this.store.insertFactAtomic({
        content: fact.content,
        contentHash: hash,
        source,
        bankId,
        occurredAt: fact.occurredAt ? new Date(fact.occurredAt) : undefined,
        entityIds: linkedEntityIds,
        embedding: embeddings[i],
        expiresAt,
      });

      if (factId) {
        factIds.push(factId);
      } else {
        factsSkipped++;
      }
    }

    // 5. Upsert entity relations
    for (const rel of extraction.relations) {
      const sourceId = entityMap.get(rel.sourceName);
      const targetId = entityMap.get(rel.targetName);
      if (sourceId && targetId) {
        this.store.upsertRelation(sourceId, targetId, rel.relationType, bankId);
      }
    }

    // 6. Fire-and-forget: evaluate new facts against existing observations
    if (!this.skipEvidenceEvaluation) {
      this.evaluateEvidenceAsync(factIds, bankId).catch(() => {
        // Silently ignore — this is best-effort
      });
    }

    return {
      factsStored: factIds.length,
      factsSkipped,
      entitiesResolved,
      factIds,
    };
  }

  private async evaluateEvidenceAsync(
    factIds: string[],
    bankId: string,
  ): Promise<void> {
    const observations = this.store.getActiveObservations(bankId);
    if (observations.length === 0) return;

    for (const factId of factIds) {
      const fact = this.store.getFact(factId);
      if (!fact) continue;

      for (const observation of observations) {
        try {
          const evaluation = await this.llm.evaluateEvidence(
            fact,
            observation,
          );

          // Only apply non-trivial adjustments
          if (Math.abs(evaluation.adjustment) > 0.005) {
            const newConfidence = Math.max(
              0,
              Math.min(1, observation.confidence + evaluation.adjustment),
            );
            const existingEvidence = [...observation.evidenceFactIds, factId];
            this.store.updateObservationEvidence(
              observation.id,
              existingEvidence,
              newConfidence,
            );
            // Update local copy for subsequent evaluations
            observation.confidence = newConfidence;
            observation.evidenceFactIds = existingEvidence;
          }
        } catch {
          // Ignore individual evaluation failures
        }
      }
    }
  }
}
