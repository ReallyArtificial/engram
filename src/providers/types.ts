import type {
  ExtractionResult,
  SynthesizedObservation,
  EvidenceEvaluation,
  Fact,
  Observation,
} from '../types.js';

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
  embedMany(texts: string[]): Promise<Float32Array[]>;
}

export interface LLMProvider {
  extractFacts(text: string, bankContext?: string): Promise<ExtractionResult>;
  synthesizeObservations(
    facts: Fact[],
    existingObservations: Observation[],
    bankContext?: string,
  ): Promise<SynthesizedObservation[]>;
  evaluateEvidence(
    fact: Fact,
    observation: Observation,
  ): Promise<EvidenceEvaluation>;
}
