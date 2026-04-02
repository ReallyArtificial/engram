import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { randomUUID } from 'node:crypto';
import { getSchema, CURRENT_SCHEMA_VERSION } from './schema.js';
import { runMigrations, setInitialVersion } from './migrations.js';
import type {
  BankConfig,
  Entity,
  Fact,
  Observation,
  EntityRelation,
  EngramStats,
} from '../types.js';

export interface InsertFactParams {
  content: string;
  contentHash: string;
  source?: string;
  bankId: string;
  confidence?: number;
  occurredAt?: Date;
  expiresAt?: Date;
  entityIds: string[];
  embedding: Float32Array;
}

export interface SemanticSearchResult {
  factId: string;
  distance: number;
}

export interface KeywordSearchResult {
  factId: string;
  rank: number;
}

export class MemoryStore {
  readonly db: Database.Database;
  private stmts!: ReturnType<typeof this.prepareStatements>;

  constructor(dbPath: string, dimensions: number) {
    this.db = new Database(dbPath);

    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Initialize schema
    const schema = getSchema(dimensions);
    for (const sql of schema) {
      this.db.exec(sql);
    }

    // Run migrations and set version
    runMigrations(this.db);
    setInitialVersion(this.db);

    // Prepare cached statements
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      // Banks
      insertBank: this.db.prepare(
        'INSERT INTO banks (id, name, description) VALUES (?, ?, ?)',
      ),
      getBank: this.db.prepare('SELECT * FROM banks WHERE id = ?'),
      listBanks: this.db.prepare('SELECT * FROM banks ORDER BY created_at'),

      // Entities
      insertEntity: this.db.prepare(
        'INSERT INTO entities (id, name, entity_type, bank_id, metadata) VALUES (?, ?, ?, ?, ?)',
      ),
      getEntityByNameTypeBank: this.db.prepare(
        'SELECT * FROM entities WHERE name = ? AND entity_type = ? AND bank_id = ?',
      ),
      updateEntityMetadata: this.db.prepare(
        'UPDATE entities SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ),
      getEntitiesForFact: this.db.prepare(
        `SELECT e.* FROM entities e
         JOIN entity_facts ef ON e.id = ef.entity_id
         WHERE ef.fact_id = ?`,
      ),

      // Facts
      insertFact: this.db.prepare(
        'INSERT INTO facts (id, content, content_hash, source, bank_id, confidence, occurred_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      getFactByHash: this.db.prepare(
        'SELECT * FROM facts WHERE content_hash = ? AND bank_id = ?',
      ),
      getFact: this.db.prepare('SELECT * FROM facts WHERE id = ?'),
      getFactsByBank: this.db.prepare(
        'SELECT * FROM facts WHERE bank_id = ? ORDER BY created_at DESC',
      ),
      getFactsSinceDate: this.db.prepare(
        'SELECT * FROM facts WHERE bank_id = ? AND created_at > ? ORDER BY created_at DESC',
      ),
      getFactsInDateRange: this.db.prepare(
        'SELECT * FROM facts WHERE bank_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at DESC',
      ),
      countFactsSince: this.db.prepare(
        'SELECT COUNT(*) as count FROM facts WHERE bank_id = ? AND created_at > ?',
      ),

      // Entity-Fact links
      insertEntityFact: this.db.prepare(
        'INSERT OR IGNORE INTO entity_facts (entity_id, fact_id) VALUES (?, ?)',
      ),

      // Entity relations
      upsertRelation: this.db.prepare(
        `INSERT INTO entity_relations (id, source_entity_id, target_entity_id, relation_type, bank_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source_entity_id, target_entity_id, relation_type, bank_id) DO NOTHING`,
      ),

      // Observations
      insertObservation: this.db.prepare(
        `INSERT INTO observations (id, content, content_hash, observation_type, bank_id, confidence, evidence_fact_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      getObservationByHash: this.db.prepare(
        'SELECT * FROM observations WHERE content_hash = ? AND bank_id = ? AND archived = 0',
      ),
      getObservation: this.db.prepare(
        'SELECT * FROM observations WHERE id = ?',
      ),
      getActiveObservations: this.db.prepare(
        'SELECT * FROM observations WHERE bank_id = ? AND archived = 0 ORDER BY confidence DESC',
      ),
      updateObservationConfidence: this.db.prepare(
        'UPDATE observations SET confidence = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ),
      updateObservationEvidence: this.db.prepare(
        'UPDATE observations SET evidence_fact_ids = ?, confidence = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ),
      archiveLowConfidence: this.db.prepare(
        'UPDATE observations SET archived = 1, updated_at = datetime(\'now\') WHERE bank_id = ? AND confidence < 0.1 AND archived = 0',
      ),

      // Reflect log
      insertReflectLog: this.db.prepare(
        `INSERT INTO reflect_log (bank_id, facts_processed, observations_created, observations_updated, observations_archived, clusters)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      getLastReflect: this.db.prepare(
        'SELECT * FROM reflect_log WHERE bank_id = ? ORDER BY created_at DESC LIMIT 1',
      ),

      // Embeddings
      insertFactEmbedding: this.db.prepare(
        'INSERT INTO fact_embeddings (fact_id, embedding) VALUES (?, ?)',
      ),
      insertObservationEmbedding: this.db.prepare(
        'INSERT INTO observation_embeddings (observation_id, embedding) VALUES (?, ?)',
      ),

      // Stats
      countFacts: this.db.prepare('SELECT COUNT(*) as count FROM facts'),
      countEntities: this.db.prepare('SELECT COUNT(*) as count FROM entities'),
      countObservations: this.db.prepare(
        'SELECT COUNT(*) as count FROM observations WHERE archived = 0',
      ),
      countRelations: this.db.prepare(
        'SELECT COUNT(*) as count FROM entity_relations',
      ),
      countBanks: this.db.prepare('SELECT COUNT(*) as count FROM banks'),

      // Forgetting
      deleteFact: this.db.prepare('DELETE FROM facts WHERE id = ?'),
      deleteEntityFact: this.db.prepare('DELETE FROM entity_facts WHERE fact_id = ?'),
      deleteFactEmbedding: this.db.prepare('DELETE FROM fact_embeddings WHERE fact_id = ?'),
      getExpiredFacts: this.db.prepare(
        "SELECT id FROM facts WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') AND bank_id = ?",
      ),
      getExpiredFactsAll: this.db.prepare(
        "SELECT id FROM facts WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
      ),
      getFactsCreatedBefore: this.db.prepare(
        'SELECT id FROM facts WHERE created_at < ? AND bank_id = ?',
      ),
    };
  }

  // --- Banks ---

  createBank(id: string, name: string, description?: string): BankConfig {
    this.stmts.insertBank.run(id, name, description ?? null);
    return this.getBank(id)!;
  }

  getBank(id: string): BankConfig | undefined {
    const row = this.stmts.getBank.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      createdAt: new Date(row.created_at as string),
    };
  }

  ensureBank(id: string, name: string): BankConfig {
    const existing = this.getBank(id);
    if (existing) return existing;
    return this.createBank(id, name);
  }

  listBanks(): BankConfig[] {
    const rows = this.stmts.listBanks.all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      createdAt: new Date(row.created_at as string),
    }));
  }

  // --- Entities ---

  getEntityByNameTypeBank(
    name: string,
    entityType: string,
    bankId: string,
  ): Entity | undefined {
    const row = this.stmts.getEntityByNameTypeBank.get(
      name,
      entityType,
      bankId,
    ) as Record<string, unknown> | undefined;
    return row ? this.rowToEntity(row) : undefined;
  }

  insertEntity(
    name: string,
    entityType: string,
    bankId: string,
    metadata?: Record<string, unknown>,
  ): Entity {
    const id = randomUUID();
    this.stmts.insertEntity.run(
      id,
      name,
      entityType,
      bankId,
      metadata ? JSON.stringify(metadata) : null,
    );
    return this.rowToEntity(
      this.stmts.getEntityByNameTypeBank.get(name, entityType, bankId) as Record<string, unknown>,
    );
  }

  updateEntityMetadata(entityId: string, metadata: Record<string, unknown>): void {
    this.stmts.updateEntityMetadata.run(JSON.stringify(metadata), entityId);
  }

  getEntitiesForFact(factId: string): Entity[] {
    const rows = this.stmts.getEntitiesForFact.all(factId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntity(r));
  }

  // --- Facts ---

  insertFactAtomic(params: InsertFactParams): string | null {
    const existing = this.stmts.getFactByHash.get(
      params.contentHash,
      params.bankId,
    );
    if (existing) return null; // Idempotent: skip on hash collision

    const factId = randomUUID();
    const run = this.db.transaction(() => {
      this.stmts.insertFact.run(
        factId,
        params.content,
        params.contentHash,
        params.source ?? null,
        params.bankId,
        params.confidence ?? 1.0,
        params.occurredAt?.toISOString() ?? null,
        params.expiresAt
          ? params.expiresAt.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}$/, '')
          : null,
      );

      // Link entities
      for (const entityId of params.entityIds) {
        this.stmts.insertEntityFact.run(entityId, factId);
      }

      // Store embedding
      this.stmts.insertFactEmbedding.run(factId, params.embedding);
    });

    run();
    return factId;
  }

  getFact(id: string): Fact | undefined {
    const row = this.stmts.getFact.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const fact = this.rowToFact(row);
    fact.entities = this.getEntitiesForFact(id);
    return fact;
  }

  getFactsSinceDate(bankId: string, since: string): Fact[] {
    const rows = this.stmts.getFactsSinceDate.all(bankId, since) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFact(r));
  }

  getFactsInDateRange(bankId: string, start: Date, end: Date): Fact[] {
    const rows = this.stmts.getFactsInDateRange.all(
      bankId,
      start.toISOString(),
      end.toISOString(),
    ) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFact(r));
  }

  countFactsSince(bankId: string, since: string): number {
    const row = this.stmts.countFactsSince.get(bankId, since) as { count: number };
    return row.count;
  }

  // --- Semantic search ---

  searchFactsBySemantic(
    embedding: Float32Array,
    bankId: string,
    limit: number,
  ): SemanticSearchResult[] {
    // Over-fetch 3x to survive bank filter
    const fetchLimit = limit * 3;
    const stmt = this.db.prepare(`
      WITH knn AS (
        SELECT fact_id, distance
        FROM fact_embeddings
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      )
      SELECT knn.fact_id as factId, knn.distance
      FROM knn
      JOIN facts f ON f.id = knn.fact_id
      WHERE f.bank_id = ?
      LIMIT ?
    `);
    return stmt.all(embedding, fetchLimit, bankId, limit) as SemanticSearchResult[];
  }

  searchObservationsBySemantic(
    embedding: Float32Array,
    bankId: string,
    limit: number,
  ): { observationId: string; distance: number }[] {
    const fetchLimit = limit * 3;
    const stmt = this.db.prepare(`
      WITH knn AS (
        SELECT observation_id, distance
        FROM observation_embeddings
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      )
      SELECT knn.observation_id as observationId, knn.distance
      FROM knn
      JOIN observations o ON o.id = knn.observation_id
      WHERE o.bank_id = ? AND o.archived = 0
      LIMIT ?
    `);
    return stmt.all(embedding, fetchLimit, bankId, limit) as {
      observationId: string;
      distance: number;
    }[];
  }

  // --- Keyword search ---

  searchFactsByKeyword(
    query: string,
    bankId: string,
    limit: number,
  ): KeywordSearchResult[] {
    const fetchLimit = limit * 3;
    const stmt = this.db.prepare(`
      SELECT f.id as factId, fts.rank
      FROM facts_fts fts
      JOIN facts f ON f.rowid = fts.rowid
      WHERE facts_fts MATCH ?
        AND f.bank_id = ?
      ORDER BY fts.rank
      LIMIT ?
    `);
    return stmt.all(query, bankId, fetchLimit) as KeywordSearchResult[];
  }

  searchObservationsByKeyword(
    query: string,
    bankId: string,
    limit: number,
  ): { observationId: string; rank: number }[] {
    const fetchLimit = limit * 3;
    const stmt = this.db.prepare(`
      SELECT o.id as observationId, fts.rank
      FROM observations_fts fts
      JOIN observations o ON o.rowid = fts.rowid
      WHERE observations_fts MATCH ?
        AND o.bank_id = ? AND o.archived = 0
      ORDER BY fts.rank
      LIMIT ?
    `);
    return stmt.all(query, bankId, fetchLimit) as {
      observationId: string;
      rank: number;
    }[];
  }

  // --- Fact clusters for reflection ---

  getFactClusters(
    bankId: string,
    since?: string,
  ): Map<string, Fact[]> {
    // Get facts with their entity associations
    let factsQuery = `
      SELECT f.*, ef.entity_id
      FROM facts f
      JOIN entity_facts ef ON f.id = ef.fact_id
      WHERE f.bank_id = ?
    `;
    const params: unknown[] = [bankId];

    if (since) {
      factsQuery += ' AND f.created_at > ?';
      params.push(since);
    }

    factsQuery += ' ORDER BY f.created_at DESC';

    const rows = this.db.prepare(factsQuery).all(...params) as Array<
      Record<string, unknown> & { entity_id: string }
    >;

    // Group facts by entity
    const entityFacts = new Map<string, Set<string>>();
    const factMap = new Map<string, Fact>();

    for (const row of rows) {
      const factId = row.id as string;
      const entityId = row.entity_id;

      if (!factMap.has(factId)) {
        factMap.set(factId, this.rowToFact(row));
      }

      if (!entityFacts.has(entityId)) {
        entityFacts.set(entityId, new Set());
      }
      entityFacts.get(entityId)!.add(factId);
    }

    // Build clusters: group facts that share entities
    const clusters = new Map<string, Fact[]>();
    for (const [entityId, factIds] of entityFacts) {
      if (factIds.size < 2) continue; // Only clusters with 2+ facts
      const facts = [...factIds].map((id) => factMap.get(id)!);
      clusters.set(entityId, facts);
    }

    return clusters;
  }

  // --- Observations ---

  insertObservation(
    content: string,
    contentHash: string,
    observationType: 'pattern' | 'preference' | 'insight',
    bankId: string,
    evidenceFactIds: string[],
    confidence: number,
    embedding: Float32Array,
  ): string {
    const id = randomUUID();
    const run = this.db.transaction(() => {
      this.stmts.insertObservation.run(
        id,
        content,
        contentHash,
        observationType,
        bankId,
        confidence,
        JSON.stringify(evidenceFactIds),
      );
      this.stmts.insertObservationEmbedding.run(id, embedding);
    });
    run();
    return id;
  }

  getObservationByHash(
    contentHash: string,
    bankId: string,
  ): Observation | undefined {
    const row = this.stmts.getObservationByHash.get(
      contentHash,
      bankId,
    ) as Record<string, unknown> | undefined;
    return row ? this.rowToObservation(row) : undefined;
  }

  getObservation(id: string): Observation | undefined {
    const row = this.stmts.getObservation.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToObservation(row) : undefined;
  }

  getActiveObservations(bankId: string): Observation[] {
    const rows = this.stmts.getActiveObservations.all(bankId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToObservation(r));
  }

  updateObservationConfidence(id: string, confidence: number): void {
    this.stmts.updateObservationConfidence.run(confidence, id);
  }

  updateObservationEvidence(
    id: string,
    evidenceFactIds: string[],
    confidence: number,
  ): void {
    this.stmts.updateObservationEvidence.run(
      JSON.stringify(evidenceFactIds),
      confidence,
      id,
    );
  }

  archiveLowConfidence(bankId: string): number {
    const info = this.stmts.archiveLowConfidence.run(bankId);
    return info.changes;
  }

  // --- Entity relations ---

  upsertRelation(
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
    bankId: string,
  ): void {
    this.stmts.upsertRelation.run(
      randomUUID(),
      sourceEntityId,
      targetEntityId,
      relationType,
      bankId,
    );
  }

  // --- Reflect log ---

  insertReflectLog(
    bankId: string,
    factsProcessed: number,
    observationsCreated: number,
    observationsUpdated: number,
    observationsArchived: number,
    clusters: number,
  ): void {
    this.stmts.insertReflectLog.run(
      bankId,
      factsProcessed,
      observationsCreated,
      observationsUpdated,
      observationsArchived,
      clusters,
    );
  }

  getLastReflect(bankId: string): { created_at: string } | undefined {
    return this.stmts.getLastReflect.get(bankId) as
      | { created_at: string }
      | undefined;
  }

  // --- Stats ---

  getStats(): EngramStats {
    return {
      banks: (this.stmts.countBanks.get() as { count: number }).count,
      facts: (this.stmts.countFacts.get() as { count: number }).count,
      entities: (this.stmts.countEntities.get() as { count: number }).count,
      observations: (this.stmts.countObservations.get() as { count: number }).count,
      relations: (this.stmts.countRelations.get() as { count: number }).count,
    };
  }

  // --- Forgetting ---

  deleteFact(factId: string): void {
    const run = this.db.transaction(() => {
      this.stmts.deleteEntityFact.run(factId);
      this.stmts.deleteFactEmbedding.run(factId);
      this.stmts.deleteFact.run(factId);
    });
    run();
  }

  deleteFactsBatch(factIds: string[]): number {
    let deleted = 0;
    const run = this.db.transaction(() => {
      for (const factId of factIds) {
        this.stmts.deleteEntityFact.run(factId);
        this.stmts.deleteFactEmbedding.run(factId);
        const info = this.stmts.deleteFact.run(factId);
        deleted += info.changes;
      }
    });
    run();
    return deleted;
  }

  getExpiredFactIds(bankId?: string): string[] {
    if (bankId) {
      const rows = this.stmts.getExpiredFacts.all(bankId) as { id: string }[];
      return rows.map((r) => r.id);
    }
    const rows = this.stmts.getExpiredFactsAll.all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  getFactIdsBefore(before: Date, bankId: string): string[] {
    const rows = this.stmts.getFactsCreatedBefore.all(
      before.toISOString(),
      bankId,
    ) as { id: string }[];
    return rows.map((r) => r.id);
  }

  // --- Cleanup ---

  close(): void {
    this.db.close();
  }

  // --- Row mappers ---

  private rowToEntity(row: Record<string, unknown>): Entity {
    return {
      id: row.id as string,
      name: row.name as string,
      entityType: row.entity_type as string,
      bankId: row.bank_id as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private rowToFact(row: Record<string, unknown>): Fact {
    return {
      id: row.id as string,
      content: row.content as string,
      contentHash: row.content_hash as string,
      source: row.source as string | undefined,
      bankId: row.bank_id as string,
      confidence: row.confidence as number,
      occurredAt: row.occurred_at
        ? new Date(row.occurred_at as string)
        : undefined,
      expiresAt: row.expires_at
        ? new Date((row.expires_at as string) + 'Z')
        : undefined,
      createdAt: new Date(row.created_at as string),
    };
  }

  private rowToObservation(row: Record<string, unknown>): Observation {
    return {
      id: row.id as string,
      content: row.content as string,
      contentHash: row.content_hash as string,
      observationType: row.observation_type as
        | 'pattern'
        | 'preference'
        | 'insight',
      bankId: row.bank_id as string,
      confidence: row.confidence as number,
      evidenceFactIds: JSON.parse(
        (row.evidence_fact_ids as string) || '[]',
      ) as string[],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
