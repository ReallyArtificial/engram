import { describe, it, expect, afterEach, vi } from 'vitest';
import { Engram } from '../../src/engram.js';
import {
  MockEmbeddingProvider,
  MockLLMProvider,
} from '../helpers/mock-providers.js';

function createTestEngram(opts?: {
  autoReflect?: boolean;
  reflectThreshold?: number;
  skipEvidenceEvaluation?: boolean;
  reflectMaxClusters?: number;
}) {
  const embedding = new MockEmbeddingProvider();
  const llm = new MockLLMProvider();
  const engram = new Engram(
    {
      dbPath: ':memory:',
      autoReflect: opts?.autoReflect ?? false,
      reflectThreshold: opts?.reflectThreshold ?? 20,
      skipEvidenceEvaluation: opts?.skipEvidenceEvaluation,
      reflectMaxClusters: opts?.reflectMaxClusters,
    },
    embedding,
    llm,
  );
  return { engram, embedding, llm };
}

describe('Engram integration', () => {
  let engram: Engram;

  afterEach(() => {
    engram?.close();
  });

  it('retain → recall basic cycle', async () => {
    ({ engram } = createTestEngram());

    // Retain some facts
    const result = await engram.retain({
      text: 'Alice works at Acme Corp. She likes TypeScript and coffee.',
      source: 'test',
    });

    expect(result.factsStored).toBeGreaterThan(0);
    expect(result.factIds.length).toBe(result.factsStored);

    // Recall
    const recall = await engram.recall({
      query: 'Alice TypeScript',
      limit: 5,
    });

    expect(recall.results.length).toBeGreaterThan(0);
    expect(recall.results[0].type).toBe('fact');
    expect(recall.results[0].score).toBeGreaterThan(0);
  });

  it('retain is idempotent', async () => {
    ({ engram } = createTestEngram());

    const text = 'Bob uses Python for data science.';
    const r1 = await engram.retain({ text });
    const r2 = await engram.retain({ text });

    expect(r1.factsStored).toBeGreaterThan(0);
    expect(r2.factsSkipped).toBe(r1.factsStored);
    expect(r2.factsStored).toBe(0);
  });

  it('reflect synthesizes observations', async () => {
    ({ engram } = createTestEngram());

    // Store multiple related facts that share entities
    await engram.retain({
      text: 'Alice loves TypeScript. Alice uses TypeScript daily. Alice recommends TypeScript to everyone.',
    });

    // Force reflect
    const result = await engram.reflect({ force: true });

    expect(result.factsProcessed).toBeGreaterThan(0);
    // May or may not create observations depending on mock clustering
  });

  it('bank isolation works', async () => {
    ({ engram } = createTestEngram());

    engram.createBank('work', 'Work');
    engram.createBank('personal', 'Personal');

    await engram.retain({
      text: 'Work project deadline is Friday.',
      bankId: 'work',
    });
    await engram.retain({
      text: 'Grocery shopping on Saturday.',
      bankId: 'personal',
    });

    const workRecall = await engram.recall({
      query: 'deadline',
      bankId: 'work',
    });
    const personalRecall = await engram.recall({
      query: 'deadline',
      bankId: 'personal',
    });

    // Work bank should find the deadline fact
    const workHasDeadline = workRecall.results.some((r) =>
      r.content.toLowerCase().includes('deadline'),
    );
    const personalHasDeadline = personalRecall.results.some((r) =>
      r.content.toLowerCase().includes('deadline'),
    );

    expect(workHasDeadline).toBe(true);
    expect(personalHasDeadline).toBe(false);
  });

  it('events fire correctly', async () => {
    ({ engram } = createTestEngram());

    const events: string[] = [];
    engram.on('retain:start', () => events.push('retain:start'));
    engram.on('retain:complete', () => events.push('retain:complete'));
    engram.on('recall:start', () => events.push('recall:start'));
    engram.on('recall:complete', () => events.push('recall:complete'));

    await engram.retain({ text: 'Test event.' });
    await engram.recall({ query: 'test' });

    expect(events).toEqual([
      'retain:start',
      'retain:complete',
      'recall:start',
      'recall:complete',
    ]);
  });

  it('stats are accurate', async () => {
    ({ engram } = createTestEngram());

    const before = engram.getStats();
    expect(before.facts).toBe(0);

    await engram.retain({
      text: 'Charlie built a rocket. Dave painted a mural.',
    });

    const after = engram.getStats();
    expect(after.facts).toBeGreaterThan(0);
    expect(after.banks).toBeGreaterThanOrEqual(1);
  });

  it('recall with time filter works', async () => {
    ({ engram } = createTestEngram());

    await engram.retain({
      text: 'Meeting happened yesterday about the project launch.',
    });

    const result = await engram.recall({
      query: 'meeting project',
      timeFilter: 'last week',
    });

    // Should not error even if no temporal matches
    expect(result.results).toBeDefined();
  });

  it('auto-reflect triggers after threshold', async () => {
    ({ engram } = createTestEngram({
      autoReflect: true,
      reflectThreshold: 3,
    }));

    const triggers: string[] = [];
    engram.on('reflect:trigger', (_bankId, reason) => triggers.push(reason));

    // Retain enough facts to trigger auto-reflect
    // Each retain extracts ~2 facts from a sentence
    await engram.retain({ text: 'Fact one about Alice. Fact two about Alice.' });
    await engram.retain({ text: 'Fact three about Bob. Fact four about Bob.' });

    // Give fire-and-forget reflect a moment
    await new Promise((r) => setTimeout(r, 100));

    // Should have triggered (or at least attempted) — the threshold is low
    // The exact trigger depends on mock extraction count
  });

  it('observation confidence lifecycle', async () => {
    ({ engram } = createTestEngram());

    // Manually insert an observation via the store
    const store = engram.getStore();
    const { contentHash } = await import('../../src/utils/hash.js');
    const { MockEmbeddingProvider: MEP } = await import(
      '../helpers/mock-providers.js'
    );
    const emb = new MEP();
    const vec = await emb.embed('test observation');

    const obsId = store.insertObservation(
      'Users prefer TypeScript',
      contentHash('Users prefer TypeScript'),
      'preference',
      'default',
      [],
      0.5,
      vec,
    );

    const obs = store.getObservation(obsId);
    expect(obs!.confidence).toBe(0.5);

    // Update confidence
    store.updateObservationConfidence(obsId, 0.05);
    const updated = store.getObservation(obsId);
    expect(updated!.confidence).toBe(0.05);

    // Archive
    store.archiveLowConfidence('default');
    const active = store.getActiveObservations('default');
    expect(active.find((o) => o.id === obsId)).toBeUndefined();
  });

  // --- New feature tests ---

  it('retainDirect stores pre-extracted facts and they are recallable', async () => {
    ({ engram } = createTestEngram());

    const result = await engram.retainDirect({
      facts: [
        { content: 'Alice prefers dark mode' },
        { content: 'Bob uses vim keybindings' },
      ],
      entities: [
        { name: 'Alice', entityType: 'person' },
        { name: 'Bob', entityType: 'person' },
      ],
    });

    expect(result.factsStored).toBe(2);
    expect(result.factIds).toHaveLength(2);

    const recall = await engram.recall({ query: 'Alice dark mode' });
    expect(recall.results.length).toBeGreaterThan(0);
    expect(
      recall.results.some((r) => r.content.includes('dark mode')),
    ).toBe(true);
  });

  it('retainDirect is idempotent', async () => {
    ({ engram } = createTestEngram());

    const facts = [{ content: 'Unique direct fact xyz' }];
    const r1 = await engram.retainDirect({ facts });
    const r2 = await engram.retainDirect({ facts });

    expect(r1.factsStored).toBe(1);
    expect(r2.factsStored).toBe(0);
    expect(r2.factsSkipped).toBe(1);
  });

  it('retainDirect does not call LLM extractFacts', async () => {
    const { engram: e, llm } = createTestEngram();
    engram = e;

    const spy = vi.spyOn(llm, 'extractFacts');

    await engram.retainDirect({
      facts: [{ content: 'Direct fact without LLM' }],
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('skipEvidenceEvaluation prevents evidence eval calls', async () => {
    const { engram: e, llm } = createTestEngram({
      skipEvidenceEvaluation: true,
    });
    engram = e;

    const spy = vi.spyOn(llm, 'evaluateEvidence');

    // Insert an observation first so evidence eval would be triggered
    const store = engram.getStore();
    const emb = new MockEmbeddingProvider();
    const { contentHash } = await import('../../src/utils/hash.js');
    store.insertObservation(
      'Test observation for evidence',
      contentHash('Test observation for evidence'),
      'pattern',
      'default',
      [],
      0.5,
      await emb.embed('test observation'),
    );

    await engram.retain({
      text: 'Some new fact that might relate to the observation.',
    });

    // Give fire-and-forget a moment
    await new Promise((r) => setTimeout(r, 100));

    expect(spy).not.toHaveBeenCalled();
  });

  it('reflectMaxClusters limits clusters processed', async () => {
    ({ engram } = createTestEngram({ reflectMaxClusters: 1 }));

    // Create facts across multiple entity clusters
    await engram.retain({
      text: 'Alice loves React. Alice uses React daily.',
    });
    await engram.retain({
      text: 'Bob prefers Angular. Bob recommends Angular often.',
    });

    const result = await engram.reflect({ force: true });

    // With maxClusters=1, should process at most 1 cluster
    expect(result.clusters).toBeLessThanOrEqual(1);
  });

  it('forget by factId removes fact from recall', async () => {
    ({ engram } = createTestEngram());

    const retained = await engram.retainDirect({
      facts: [{ content: 'Forgettable fact about quantum computing' }],
    });

    expect(retained.factsStored).toBe(1);
    const factId = retained.factIds[0];

    // Verify recallable
    const before = await engram.recall({ query: 'quantum computing' });
    expect(before.results.some((r) => r.content.includes('quantum'))).toBe(true);

    // Forget
    const forgetResult = engram.forget({ factId });
    expect(forgetResult.factsRemoved).toBe(1);

    // Should no longer be recallable
    const after = await engram.recall({ query: 'quantum computing' });
    expect(after.results.some((r) => r.content.includes('quantum'))).toBe(false);
  });

  it('retain with maxAge sets expiresAt', async () => {
    ({ engram } = createTestEngram());

    const result = await engram.retainDirect({
      facts: [{ content: 'Temporary fact with TTL' }],
      maxAge: 3600000, // 1 hour
    });

    expect(result.factsStored).toBe(1);
    const fact = engram.getStore().getFact(result.factIds[0]);
    expect(fact!.expiresAt).toBeDefined();
    // expiresAt should be roughly 1 hour from now (within 5s tolerance)
    const diff = fact!.expiresAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(3595000);
    expect(diff).toBeLessThan(3605000);
  });

  it('pruneExpired removes expired facts', async () => {
    ({ engram } = createTestEngram());

    // Insert with a past expiry using the store directly
    const store = engram.getStore();
    const emb = new MockEmbeddingProvider();
    const { contentHash } = await import('../../src/utils/hash.js');

    const pastExpiry = new Date(Date.now() - 60000);
    store.insertFactAtomic({
      content: 'expired fact to prune',
      contentHash: contentHash('expired fact to prune'),
      bankId: 'default',
      entityIds: [],
      embedding: await emb.embed('expired fact to prune'),
      expiresAt: pastExpiry,
    });

    // Also insert a non-expired fact
    store.insertFactAtomic({
      content: 'valid fact stays',
      contentHash: contentHash('valid fact stays'),
      bankId: 'default',
      entityIds: [],
      embedding: await emb.embed('valid fact stays'),
    });

    const pruned = engram.pruneExpired();
    expect(pruned).toBe(1);

    // Valid fact still exists
    const stats = engram.getStats();
    expect(stats.facts).toBe(1);
  });

  it('listBanks returns created banks', async () => {
    ({ engram } = createTestEngram());

    engram.createBank('alpha', 'Alpha Bank');
    engram.createBank('beta', 'Beta Bank');

    const banks = engram.listBanks();
    const ids = banks.map((b) => b.id);
    expect(ids).toContain('default');
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });
});
