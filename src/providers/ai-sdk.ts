import { embed, embedMany, generateObject } from 'ai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { z } from 'zod';
import type { EmbeddingProvider, LLMProvider } from './types.js';
import type {
  ExtractionResult,
  SynthesizedObservation,
  EvidenceEvaluation,
  Fact,
  Observation,
} from '../types.js';
import {
  buildExtractionPrompt,
  buildReflectionPrompt,
  buildEvidencePrompt,
} from '../pipelines/extract.js';

// --- Zod schemas for structured LLM output ---

const extractionSchema = z.object({
  facts: z.array(
    z.object({
      content: z.string().describe('A single atomic fact'),
      occurredAt: z
        .string()
        .optional()
        .describe('When this fact occurred, if mentioned (ISO date string)'),
    }),
  ),
  entities: z.array(
    z.object({
      name: z.string().describe('Entity name'),
      entityType: z
        .string()
        .describe(
          'Entity type: person, organization, location, technology, concept, project, etc.',
        ),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Additional metadata about the entity'),
    }),
  ),
  relations: z.array(
    z.object({
      sourceName: z.string().describe('Source entity name'),
      targetName: z.string().describe('Target entity name'),
      relationType: z
        .string()
        .describe(
          'Relationship type: works_at, uses, knows, created, part_of, etc.',
        ),
    }),
  ),
});

const synthesisSchema = z.object({
  observations: z.array(
    z.object({
      content: z
        .string()
        .describe('A higher-order observation synthesized from the facts'),
      observationType: z
        .enum(['pattern', 'preference', 'insight'])
        .describe(
          'pattern = recurring behavior, preference = stated/implied preference, insight = non-obvious connection',
        ),
    }),
  ),
});

const evidenceSchema = z.object({
  adjustment: z
    .number()
    .min(-0.3)
    .max(0.3)
    .describe(
      'Confidence adjustment: positive confirms, negative contradicts, near-zero is unrelated',
    ),
  reasoning: z
    .string()
    .describe('Brief explanation of why this fact affects the observation'),
});

// --- Embedding Provider ---

export class AISdkEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private model: EmbeddingModel<string>;

  constructor(model: EmbeddingModel<string>, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const result = await embed({ model: this.model, value: text });
    return new Float32Array(result.embedding);
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const result = await embedMany({ model: this.model, values: texts });
    return result.embeddings.map((e) => new Float32Array(e));
  }
}

// --- LLM Provider ---

export class AISdkLLMProvider implements LLMProvider {
  private model: LanguageModel;

  constructor(model: LanguageModel) {
    this.model = model;
  }

  async extractFacts(
    text: string,
    bankContext?: string,
  ): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(text, bankContext);
    const result = await generateObject({
      model: this.model,
      schema: extractionSchema,
      prompt,
    });
    return result.object;
  }

  async synthesizeObservations(
    facts: Fact[],
    existingObservations: Observation[],
    bankContext?: string,
  ): Promise<SynthesizedObservation[]> {
    const prompt = buildReflectionPrompt(
      facts,
      existingObservations,
      bankContext,
    );
    const result = await generateObject({
      model: this.model,
      schema: synthesisSchema,
      prompt,
    });
    return result.object.observations;
  }

  async evaluateEvidence(
    fact: Fact,
    observation: Observation,
  ): Promise<EvidenceEvaluation> {
    const prompt = buildEvidencePrompt(fact, observation);
    const result = await generateObject({
      model: this.model,
      schema: evidenceSchema,
      prompt,
    });
    return result.object;
  }
}
