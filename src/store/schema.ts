export function getSchema(dimensions: number): string[] {
  return [
    // Schema versioning
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // Memory banks
    `CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // Entities
    `CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      bank_id TEXT NOT NULL REFERENCES banks(id),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type_bank
      ON entities(name, entity_type, bank_id)`,

    // Facts
    `CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source TEXT,
      bank_id TEXT NOT NULL REFERENCES banks(id),
      confidence REAL NOT NULL DEFAULT 1.0,
      occurred_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_hash_bank
      ON facts(content_hash, bank_id)`,

    // Fact-Entity join table
    `CREATE TABLE IF NOT EXISTS entity_facts (
      entity_id TEXT NOT NULL REFERENCES entities(id),
      fact_id TEXT NOT NULL REFERENCES facts(id),
      PRIMARY KEY (entity_id, fact_id)
    )`,

    // Entity relations
    `CREATE TABLE IF NOT EXISTS entity_relations (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL REFERENCES entities(id),
      target_entity_id TEXT NOT NULL REFERENCES entities(id),
      relation_type TEXT NOT NULL,
      bank_id TEXT NOT NULL REFERENCES banks(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_relations_unique
      ON entity_relations(source_entity_id, target_entity_id, relation_type, bank_id)`,

    // Observations
    `CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      observation_type TEXT NOT NULL CHECK(observation_type IN ('pattern', 'preference', 'insight')),
      bank_id TEXT NOT NULL REFERENCES banks(id),
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_fact_ids TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_hash_bank
      ON observations(content_hash, bank_id)`,

    // Reflect log
    `CREATE TABLE IF NOT EXISTS reflect_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id TEXT NOT NULL REFERENCES banks(id),
      facts_processed INTEGER NOT NULL,
      observations_created INTEGER NOT NULL,
      observations_updated INTEGER NOT NULL,
      observations_archived INTEGER NOT NULL,
      clusters INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // FTS5 for facts
    `CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
      content,
      content='facts',
      content_rowid='rowid'
    )`,

    // FTS5 triggers for facts
    `CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
      INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,

    // FTS5 for observations
    `CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      content,
      content='observations',
      content_rowid='rowid'
    )`,

    // FTS5 triggers for observations
    `CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO observations_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,

    // Vector tables (sqlite-vec)
    `CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings USING vec0(
      fact_id TEXT PRIMARY KEY,
      embedding float[${dimensions}] distance_metric=cosine
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS observation_embeddings USING vec0(
      observation_id TEXT PRIMARY KEY,
      embedding float[${dimensions}] distance_metric=cosine
    )`,
  ];
}

export const CURRENT_SCHEMA_VERSION = 2;
