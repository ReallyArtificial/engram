import { describe, it, expect } from 'vitest';
import {
  fuseScores,
  cosineDistanceToSimilarity,
  fts5RankToScore,
} from '../../src/utils/rank-fusion.js';

describe('fuseScores', () => {
  it('computes weighted average', () => {
    const score = fuseScores(
      { semantic: 0.8, keyword: 0.6, temporal: 1.0 },
      { semantic: 0.5, keyword: 0.3, temporal: 0.2 },
    );
    // (0.8*0.5 + 0.6*0.3 + 1.0*0.2) / (0.5+0.3+0.2) = (0.4+0.18+0.2)/1.0 = 0.78
    expect(score).toBeCloseTo(0.78, 2);
  });

  it('handles missing components', () => {
    const score = fuseScores(
      { semantic: 0.8 },
      { semantic: 0.5, keyword: 0.3, temporal: 0.2 },
    );
    // Only semantic: 0.8*0.5 / 0.5 = 0.8
    expect(score).toBeCloseTo(0.8, 2);
  });

  it('clamps values to [0, 1]', () => {
    const score = fuseScores(
      { semantic: 1.5, keyword: -0.5 },
      { semantic: 0.5, keyword: 0.5, temporal: 0 },
    );
    // semantic clamped to 1.0, keyword clamped to 0
    expect(score).toBeCloseTo(0.5, 2);
  });

  it('returns 0 for empty scores', () => {
    expect(fuseScores({})).toBe(0);
  });
});

describe('cosineDistanceToSimilarity', () => {
  it('converts 0 distance to 1 similarity', () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
  });

  it('converts 2 distance to 0 similarity', () => {
    expect(cosineDistanceToSimilarity(2)).toBe(0);
  });

  it('converts 1 distance to 0.5 similarity', () => {
    expect(cosineDistanceToSimilarity(1)).toBe(0.5);
  });
});

describe('fts5RankToScore', () => {
  it('normalizes FTS5 ranks', () => {
    // Best rank (-10) should score highest
    expect(fts5RankToScore(-10, -10)).toBeCloseTo(1, 2);
    // Worst rank maps to itself
    expect(fts5RankToScore(-5, -10)).toBeCloseTo(0.5, 2);
  });

  it('returns 0 for non-negative worst rank', () => {
    expect(fts5RankToScore(-5, 0)).toBe(0);
  });
});
