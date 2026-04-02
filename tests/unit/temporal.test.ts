import { describe, it, expect } from 'vitest';
import { parseTemporalFilter } from '../../src/utils/temporal.js';

describe('parseTemporalFilter', () => {
  it('parses "yesterday"', () => {
    const result = parseTemporalFilter('yesterday');
    const now = new Date();
    expect(result.start).toBeInstanceOf(Date);
    expect(result.end).toBeInstanceOf(Date);
    expect(result.start.getTime()).toBeLessThan(now.getTime());
  });

  it('parses "last week"', () => {
    const result = parseTemporalFilter('last week');
    const now = new Date();
    expect(result.start.getTime()).toBeLessThan(now.getTime());
    // Should be roughly 7 days ago
    const daysDiff =
      (now.getTime() - result.start.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(3);
    expect(daysDiff).toBeLessThan(14);
  });

  it('falls back to 30-day window on unparseable input', () => {
    const result = parseTemporalFilter('xyzzy gibberish');
    const now = new Date();
    const daysDiff =
      (now.getTime() - result.start.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeCloseTo(30, 0);
  });

  it('returns start before end', () => {
    const result = parseTemporalFilter('last month');
    expect(result.start.getTime()).toBeLessThan(result.end.getTime());
  });
});
