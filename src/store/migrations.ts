import type Database from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION } from './schema.js';

type Migration = {
  version: number;
  up: string[];
};

const migrations: Migration[] = [
  // Version 1 is the initial schema — applied via getSchema()
  {
    version: 2,
    up: [
      'ALTER TABLE facts ADD COLUMN expires_at TEXT',
      'CREATE INDEX IF NOT EXISTS idx_facts_expires_at ON facts(expires_at) WHERE expires_at IS NOT NULL',
    ],
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const currentVersion = db
    .prepare('SELECT MAX(version) as v FROM schema_version')
    .get() as { v: number | null } | undefined;

  const version = currentVersion?.v ?? 0;

  const pending = migrations.filter((m) => m.version > version);
  if (pending.length === 0) return;

  for (const migration of pending) {
    const run = db.transaction(() => {
      for (const sql of migration.up) {
        db.exec(sql);
      }
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
        migration.version,
      );
    });
    run();
  }
}

export function setInitialVersion(db: Database.Database): void {
  const existing = db
    .prepare('SELECT version FROM schema_version WHERE version = ?')
    .get(CURRENT_SCHEMA_VERSION);

  if (!existing) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
      CURRENT_SCHEMA_VERSION,
    );
  }
}
