import type { MemoryStore } from '../store/store.js';
import type { ExtractedEntity, Entity } from '../types.js';

export interface ResolvedEntity {
  entityId: string;
  created: boolean;
}

export function resolveEntity(
  store: MemoryStore,
  extracted: ExtractedEntity,
  bankId: string,
): ResolvedEntity {
  const existing = store.getEntityByNameTypeBank(
    extracted.name,
    extracted.entityType,
    bankId,
  );

  if (existing) {
    // Merge metadata if new metadata provided
    if (extracted.metadata && Object.keys(extracted.metadata).length > 0) {
      const merged = { ...(existing.metadata ?? {}), ...extracted.metadata };
      store.updateEntityMetadata(existing.id, merged);
    }
    return { entityId: existing.id, created: false };
  }

  const entity = store.insertEntity(
    extracted.name,
    extracted.entityType,
    bankId,
    extracted.metadata,
  );
  return { entityId: entity.id, created: true };
}
