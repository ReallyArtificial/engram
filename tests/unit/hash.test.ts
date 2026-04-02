import { describe, it, expect } from 'vitest';
import { contentHash } from '../../src/utils/hash.js';

describe('contentHash', () => {
  it('produces consistent SHA-256 hash', () => {
    const hash = contentHash('Hello World');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash('Hello World')).toBe(hash);
  });

  it('normalizes whitespace', () => {
    expect(contentHash('hello  world')).toBe(contentHash('hello world'));
    expect(contentHash('hello\tworld')).toBe(contentHash('hello world'));
    expect(contentHash('hello\nworld')).toBe(contentHash('hello world'));
  });

  it('normalizes case', () => {
    expect(contentHash('Hello World')).toBe(contentHash('hello world'));
    expect(contentHash('HELLO WORLD')).toBe(contentHash('hello world'));
  });

  it('trims leading/trailing whitespace', () => {
    expect(contentHash('  hello world  ')).toBe(contentHash('hello world'));
  });

  it('produces different hashes for different content', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });
});
