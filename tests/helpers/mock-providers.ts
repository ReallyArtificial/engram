import { createHash } from 'node:crypto';
import type { EmbeddingProvider, LLMProvider } from '../../src/providers/types.js';
import type {
  ExtractionResult,
  SynthesizedObservation,
  EvidenceEvaluation,
  Fact,
  Observation,
} from '../../src/types.js';

const MOCK_DIMENSIONS = 4;

/**
 * Deterministic mock embedding provider.
 * Creates 4-dimensional vectors from content hash.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = MOCK_DIMENSIONS;

  async embed(text: string): Promise<Float32Array> {
    return hashToVector(text);
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => hashToVector(t));
  }
}

function hashToVector(text: string): Float32Array {
  const hash = createHash('md5').update(text.toLowerCase()).digest();
  const vec = new Float32Array(MOCK_DIMENSIONS);
  for (let i = 0; i < MOCK_DIMENSIONS; i++) {
    // Map byte value to [-1, 1]
    vec[i] = (hash[i] - 128) / 128;
  }
  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < MOCK_DIMENSIONS; i++) {
      vec[i] /= magnitude;
    }
  }
  return vec;
}

export type ExtractFn = (
  text: string,
  bankContext?: string,
) => ExtractionResult;

/**
 * Mock LLM provider with configurable extraction.
 * Default: splits sentences into facts, extracts capitalized words as entities.
 */
export class MockLLMProvider implements LLMProvider {
  private extractFn: ExtractFn;

  constructor(extractFn?: ExtractFn) {
    this.extractFn = extractFn ?? defaultExtract;
  }

  async extractFacts(
    text: string,
    bankContext?: string,
  ): Promise<ExtractionResult> {
    return this.extractFn(text, bankContext);
  }

  async synthesizeObservations(
    facts: Fact[],
    _existingObservations: Observation[],
    _bankContext?: string,
  ): Promise<SynthesizedObservation[]> {
    // Simple synthesis: group facts and create observations
    if (facts.length < 2) return [];

    return [
      {
        content: `Observation from ${facts.length} facts: ${facts
          .map((f) => f.content)
          .join('; ')}`,
        observationType: 'pattern',
      },
    ];
  }

  async evaluateEvidence(
    fact: Fact,
    observation: Observation,
  ): Promise<EvidenceEvaluation> {
    // Simple: if fact content overlaps with observation, slight positive
    const overlap = fact.content
      .toLowerCase()
      .split(' ')
      .some((w) => w.length > 3 && observation.content.toLowerCase().includes(w));

    return {
      adjustment: overlap ? 0.05 : 0,
      reasoning: overlap ? 'Content overlap detected' : 'No clear relationship',
    };
  }
}

function defaultExtract(text: string): ExtractionResult {
  // Split into sentences
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const facts = sentences.map((s) => ({ content: s }));

  // Extract capitalized words as entities (simple heuristic)
  const entitySet = new Set<string>();
  const entityRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  let match;
  while ((match = entityRegex.exec(text)) !== null) {
    const name = match[0];
    // Skip common sentence starters
    if (
      !['The', 'This', 'That', 'These', 'Those', 'It', 'He', 'She', 'We', 'They', 'I'].includes(
        name,
      )
    ) {
      entitySet.add(name);
    }
  }

  const entities = [...entitySet].map((name) => ({
    name,
    entityType: 'concept',
  }));

  return { facts, entities, relations: [] };
}
