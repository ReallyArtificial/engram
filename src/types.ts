export interface BankConfig {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
}

export interface Entity {
  id: string;
  name: string;
  entityType: string;
  bankId: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Fact {
  id: string;
  content: string;
  contentHash: string;
  source?: string;
  bankId: string;
  confidence: number;
  occurredAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  entities?: Entity[];
}

export interface EntityRelation {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  bankId: string;
  createdAt: Date;
}

export interface Observation {
  id: string;
  content: string;
  contentHash: string;
  observationType: 'pattern' | 'preference' | 'insight';
  bankId: string;
  confidence: number;
  evidenceFactIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedFact {
  content: string;
  occurredAt?: string;
}

export interface ExtractedEntity {
  name: string;
  entityType: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedRelation {
  sourceName: string;
  targetName: string;
  relationType: string;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface SynthesizedObservation {
  content: string;
  observationType: 'pattern' | 'preference' | 'insight';
}

export interface EvidenceEvaluation {
  adjustment: number;
  reasoning: string;
}

export interface RetainInput {
  text: string;
  source?: string;
  bankId?: string;
  maxAge?: number;
}

export interface RetainDirectInput {
  facts: ExtractedFact[];
  entities?: ExtractedEntity[];
  relations?: ExtractedRelation[];
  source?: string;
  bankId?: string;
  maxAge?: number;
}

export interface RetainResult {
  factsStored: number;
  factsSkipped: number;
  entitiesResolved: number;
  factIds: string[];
}

export interface RecallInput {
  query: string;
  limit?: number;
  bankId?: string;
  includeObservations?: boolean;
  timeFilter?: string;
}

export interface RecallResult {
  results: ScoredMemory[];
  query: string;
  totalCandidates: number;
}

export interface ScoredMemory {
  type: 'fact' | 'observation';
  id: string;
  content: string;
  score: number;
  confidence: number;
  source?: string;
  entities?: string[];
  observationType?: 'pattern' | 'preference' | 'insight';
  occurredAt?: Date;
  createdAt: Date;
}

export interface ReflectInput {
  bankId?: string;
  focus?: string;
  force?: boolean;
}

export interface ReflectResult {
  observationsCreated: number;
  observationsUpdated: number;
  observationsArchived: number;
  factsProcessed: number;
  clusters: number;
}

export interface EngramConfig {
  dbPath: string;
  defaultBankId?: string;
  defaultBankName?: string;
  reflectThreshold?: number;
  reflectInterval?: number;
  autoReflect?: boolean;
  skipEvidenceEvaluation?: boolean;
  reflectMaxClusters?: number;
}

export interface EngramStats {
  banks: number;
  facts: number;
  entities: number;
  observations: number;
  relations: number;
}

export interface ForgetInput {
  factId?: string;
  before?: Date;
  olderThan?: number;
  bankId?: string;
}

export interface ForgetResult {
  factsRemoved: number;
  observationsAffected: number;
}

export interface EngramEvents {
  'retain:start': [input: RetainInput];
  'retain:complete': [result: RetainResult];
  'retain:error': [error: Error];
  'retain-direct:start': [input: RetainDirectInput];
  'retain-direct:complete': [result: RetainResult];
  'retain-direct:error': [error: Error];
  'recall:start': [input: RecallInput];
  'recall:complete': [result: RecallResult];
  'recall:error': [error: Error];
  'reflect:start': [input: ReflectInput];
  'reflect:complete': [result: ReflectResult];
  'reflect:error': [error: Error];
  'reflect:trigger': [bankId: string, reason: string];
  'forget:start': [input: ForgetInput];
  'forget:complete': [result: ForgetResult];
}
