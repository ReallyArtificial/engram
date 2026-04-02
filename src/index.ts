// Main class
export { Engram } from './engram.js';

// Types
export type {
  BankConfig,
  Entity,
  Fact,
  Observation,
  EntityRelation,
  ExtractedFact,
  ExtractedEntity,
  ExtractedRelation,
  ExtractionResult,
  SynthesizedObservation,
  EvidenceEvaluation,
  RetainInput,
  RetainDirectInput,
  RetainResult,
  RecallInput,
  RecallResult,
  ReflectInput,
  ReflectResult,
  ScoredMemory,
  EngramConfig,
  EngramStats,
  EngramEvents,
  ForgetInput,
  ForgetResult,
} from './types.js';

// Provider interfaces
export type { EmbeddingProvider, LLMProvider } from './providers/types.js';

// Provider implementations
export {
  AISdkEmbeddingProvider,
  AISdkLLMProvider,
} from './providers/ai-sdk.js';
export { createProviders } from './providers/defaults.js';
export type { ProviderConfig } from './providers/defaults.js';

// Store (advanced usage)
export { MemoryStore } from './store/store.js';

// Utilities
export { contentHash } from './utils/hash.js';
export { parseTemporalFilter } from './utils/temporal.js';
