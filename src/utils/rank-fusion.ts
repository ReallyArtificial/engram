export interface ScoreComponents {
  semantic?: number;
  keyword?: number;
  temporal?: number;
}

export interface FusionWeights {
  semantic: number;
  keyword: number;
  temporal: number;
}

const DEFAULT_WEIGHTS: FusionWeights = {
  semantic: 0.5,
  keyword: 0.3,
  temporal: 0.2,
};

export function fuseScores(
  scores: ScoreComponents,
  weights: FusionWeights = DEFAULT_WEIGHTS,
): number {
  let total = 0;
  let weightSum = 0;

  if (scores.semantic !== undefined) {
    total += clamp01(scores.semantic) * weights.semantic;
    weightSum += weights.semantic;
  }
  if (scores.keyword !== undefined) {
    total += clamp01(scores.keyword) * weights.keyword;
    weightSum += weights.keyword;
  }
  if (scores.temporal !== undefined) {
    total += clamp01(scores.temporal) * weights.temporal;
    weightSum += weights.temporal;
  }

  return weightSum > 0 ? total / weightSum : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalize cosine distance to similarity.
 * sqlite-vec cosine distance is in [0, 2], where 0 = identical.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  return clamp01(1 - distance / 2);
}

/**
 * Normalize FTS5 rank to [0, 1].
 * FTS5 rank is negative; more negative = better match.
 */
export function fts5RankToScore(rank: number, worstRank: number): number {
  if (worstRank >= 0) return 0;
  return clamp01(rank / worstRank);
}
