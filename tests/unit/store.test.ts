import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/store/store.js';
import { contentHash } from '../../src/utils/hash.js';

const DIMENSIONS = 4;

function makeEmbedding(seed: number): Float32Array {
  const vec = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < DIMENSIONS; i++) vec[i] /= mag;
  return vec;
}

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(':memory:', DIMENSIONS);
    store.ensureBank('test', 'Test Bank');
  });

  afterEach(() => {
    store.close();
  });

  describe('banks', () => {
    it('creates and retrieves a bank', () => {
      const bank = store.createBank('b1', 'My Bank', 'A description');
      expect(bank.id).toBe('b1');
      expect(bank.name).toBe('My Bank');
      expect(bank.description).toBe('A description');

      const fetched = store.getBank('b1');
      expect(fetched).toEqual(bank);
    });

    it('ensureBank is idempotent', () => {
      store.ensureBank('b2', 'Bank 2');
      store.ensureBank('b2', 'Bank 2 Again');
      expect(store.getBank('b2')!.name).toBe('Bank 2');
    });
  });

  describe('facts', () => {
    it('inserts a fact atomically', () => {
      const hash = contentHash('test fact');
      const factId = store.insertFactAtomic({
        content: 'test fact',
        contentHash: hash,
        source: 'test',
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(1),
      });

      expect(factId).toBeTruthy();
      const fact = store.getFact(factId!);
      expect(fact).toBeTruthy();
      expect(fact!.content).toBe('test fact');
      expect(fact!.source).toBe('test');
    });

    it('skips duplicate facts (idempotent)', () => {
      const hash = contentHash('duplicate fact');
      const id1 = store.insertFactAtomic({
        content: 'duplicate fact',
        contentHash: hash,
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(2),
      });
      const id2 = store.insertFactAtomic({
        content: 'duplicate fact',
        contentHash: hash,
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(2),
      });

      expect(id1).toBeTruthy();
      expect(id2).toBeNull();
    });

    it('links entities to facts', () => {
      const entity = store.insertEntity('Alice', 'person', 'test');
      const hash = contentHash('Alice likes coffee');
      const factId = store.insertFactAtomic({
        content: 'Alice likes coffee',
        contentHash: hash,
        bankId: 'test',
        entityIds: [entity.id],
        embedding: makeEmbedding(3),
      });

      const entities = store.getEntitiesForFact(factId!);
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Alice');
    });
  });

  describe('semantic search', () => {
    it('finds facts by vector similarity', () => {
      const emb = makeEmbedding(10);
      store.insertFactAtomic({
        content: 'fact one',
        contentHash: contentHash('fact one'),
        bankId: 'test',
        entityIds: [],
        embedding: emb,
      });
      store.insertFactAtomic({
        content: 'fact two',
        contentHash: contentHash('fact two'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(20),
      });

      const results = store.searchFactsBySemantic(emb, 'test', 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].distance).toBeCloseTo(0, 1); // Near-identical vector
    });
  });

  describe('keyword search', () => {
    it('finds facts by FTS5 match', () => {
      store.insertFactAtomic({
        content: 'TypeScript is a programming language',
        contentHash: contentHash('TypeScript is a programming language'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(30),
      });
      store.insertFactAtomic({
        content: 'Python is great for data science',
        contentHash: contentHash('Python is great for data science'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(31),
      });

      const results = store.searchFactsByKeyword('"TypeScript"', 'test', 5);
      expect(results.length).toBe(1);
    });
  });

  describe('observations', () => {
    it('inserts and retrieves observations', () => {
      const hash = contentHash('people like coffee');
      const id = store.insertObservation(
        'people like coffee',
        hash,
        'pattern',
        'test',
        ['fact1', 'fact2'],
        0.5,
        makeEmbedding(40),
      );

      const obs = store.getObservation(id);
      expect(obs).toBeTruthy();
      expect(obs!.content).toBe('people like coffee');
      expect(obs!.observationType).toBe('pattern');
      expect(obs!.confidence).toBe(0.5);
      expect(obs!.evidenceFactIds).toEqual(['fact1', 'fact2']);
    });

    it('archives low-confidence observations', () => {
      store.insertObservation(
        'weak observation',
        contentHash('weak observation'),
        'insight',
        'test',
        [],
        0.05,
        makeEmbedding(50),
      );

      const archived = store.archiveLowConfidence('test');
      expect(archived).toBe(1);

      const active = store.getActiveObservations('test');
      expect(active).toHaveLength(0);
    });
  });

  describe('listBanks', () => {
    it('returns all banks', () => {
      store.createBank('b1', 'Bank 1');
      store.createBank('b2', 'Bank 2');

      const banks = store.listBanks();
      const ids = banks.map((b) => b.id);
      // 'test' was created in beforeEach
      expect(ids).toContain('test');
      expect(ids).toContain('b1');
      expect(ids).toContain('b2');
      expect(banks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('forgetting', () => {
    it('insertFactAtomic with expiresAt stores correctly', () => {
      const expiresAt = new Date(Date.now() + 60000);
      const factId = store.insertFactAtomic({
        content: 'expiring fact',
        contentHash: contentHash('expiring fact'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(70),
        expiresAt,
      });

      expect(factId).toBeTruthy();
      const fact = store.getFact(factId!);
      expect(fact).toBeTruthy();
      expect(fact!.expiresAt).toBeDefined();
      // Within 2 seconds tolerance (milliseconds are stripped in storage)
      expect(Math.abs(fact!.expiresAt!.getTime() - expiresAt.getTime())).toBeLessThan(2000);
    });

    it('deleteFact removes fact + entity links + embedding; FTS5 cascades', () => {
      const entity = store.insertEntity('TestEntity', 'concept', 'test');
      const factId = store.insertFactAtomic({
        content: 'deletable fact about TestEntity',
        contentHash: contentHash('deletable fact about TestEntity'),
        bankId: 'test',
        entityIds: [entity.id],
        embedding: makeEmbedding(71),
      });
      expect(factId).toBeTruthy();

      // Verify fact exists and has entity link
      expect(store.getFact(factId!)).toBeTruthy();
      expect(store.getEntitiesForFact(factId!)).toHaveLength(1);

      // Delete
      store.deleteFact(factId!);

      // Fact gone
      expect(store.getFact(factId!)).toBeUndefined();
      // Entity link gone
      expect(store.getEntitiesForFact(factId!)).toHaveLength(0);
      // FTS5 should be cleaned up by trigger — no keyword results
      const kwResults = store.searchFactsByKeyword('"deletable"', 'test', 5);
      expect(kwResults).toHaveLength(0);
    });

    it('deleteFactsBatch handles multiple', () => {
      const id1 = store.insertFactAtomic({
        content: 'batch fact 1',
        contentHash: contentHash('batch fact 1'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(72),
      })!;
      const id2 = store.insertFactAtomic({
        content: 'batch fact 2',
        contentHash: contentHash('batch fact 2'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(73),
      })!;

      const deleted = store.deleteFactsBatch([id1, id2]);
      expect(deleted).toBe(2);
      expect(store.getFact(id1)).toBeUndefined();
      expect(store.getFact(id2)).toBeUndefined();
    });

    it('getExpiredFactIds returns only expired facts', () => {
      // Insert a fact that expired in the past
      const pastExpiry = new Date(Date.now() - 60000);
      store.insertFactAtomic({
        content: 'already expired',
        contentHash: contentHash('already expired'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(74),
        expiresAt: pastExpiry,
      });

      // Insert a fact that expires in the future
      store.insertFactAtomic({
        content: 'not yet expired',
        contentHash: contentHash('not yet expired'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(75),
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Insert a fact with no expiry
      store.insertFactAtomic({
        content: 'never expires',
        contentHash: contentHash('never expires'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(76),
      });

      const expired = store.getExpiredFactIds('test');
      expect(expired).toHaveLength(1);
    });

    it('getFactIdsBefore filters correctly', () => {
      // Insert a fact, then query with a future date
      store.insertFactAtomic({
        content: 'old fact for before test',
        contentHash: contentHash('old fact for before test'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(77),
      });

      // All facts created before "future" should include our fact
      const future = new Date(Date.now() + 60000);
      const ids = store.getFactIdsBefore(future, 'test');
      expect(ids.length).toBeGreaterThan(0);

      // No facts created before epoch
      const past = new Date('1970-01-02T00:00:00Z');
      const noneIds = store.getFactIdsBefore(past, 'test');
      expect(noneIds).toHaveLength(0);
    });
  });

  describe('stats', () => {
    it('returns accurate counts', () => {
      store.insertFactAtomic({
        content: 'stat fact',
        contentHash: contentHash('stat fact'),
        bankId: 'test',
        entityIds: [],
        embedding: makeEmbedding(60),
      });
      store.insertEntity('Bob', 'person', 'test');

      const stats = store.getStats();
      expect(stats.facts).toBeGreaterThanOrEqual(1);
      expect(stats.entities).toBeGreaterThanOrEqual(1);
      expect(stats.banks).toBeGreaterThanOrEqual(1);
    });
  });
});
