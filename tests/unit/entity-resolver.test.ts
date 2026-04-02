import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/store/store.js';
import { resolveEntity } from '../../src/utils/entity-resolver.js';

describe('resolveEntity', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(':memory:', 4);
    store.ensureBank('test', 'Test Bank');
  });

  afterEach(() => {
    store.close();
  });

  it('creates a new entity when none exists', () => {
    const result = resolveEntity(
      store,
      { name: 'Alice', entityType: 'person' },
      'test',
    );
    expect(result.created).toBe(true);
    expect(result.entityId).toBeTruthy();
  });

  it('returns existing entity on match', () => {
    const first = resolveEntity(
      store,
      { name: 'Bob', entityType: 'person' },
      'test',
    );
    const second = resolveEntity(
      store,
      { name: 'Bob', entityType: 'person' },
      'test',
    );
    expect(second.created).toBe(false);
    expect(second.entityId).toBe(first.entityId);
  });

  it('treats different types as different entities', () => {
    const person = resolveEntity(
      store,
      { name: 'Apple', entityType: 'organization' },
      'test',
    );
    const fruit = resolveEntity(
      store,
      { name: 'Apple', entityType: 'concept' },
      'test',
    );
    expect(person.entityId).not.toBe(fruit.entityId);
  });

  it('merges metadata on existing entity', () => {
    resolveEntity(
      store,
      { name: 'Charlie', entityType: 'person', metadata: { age: 30 } },
      'test',
    );
    const result = resolveEntity(
      store,
      { name: 'Charlie', entityType: 'person', metadata: { city: 'NYC' } },
      'test',
    );

    const entity = store.getEntityByNameTypeBank('Charlie', 'person', 'test');
    expect(entity!.metadata).toEqual({ age: 30, city: 'NYC' });
    expect(result.created).toBe(false);
  });

  it('isolates entities by bank', () => {
    store.ensureBank('bank2', 'Bank 2');
    const r1 = resolveEntity(
      store,
      { name: 'Dave', entityType: 'person' },
      'test',
    );
    const r2 = resolveEntity(
      store,
      { name: 'Dave', entityType: 'person' },
      'bank2',
    );
    expect(r1.entityId).not.toBe(r2.entityId);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
  });
});
