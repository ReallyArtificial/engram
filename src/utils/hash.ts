import { createHash } from 'node:crypto';

export function contentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}
