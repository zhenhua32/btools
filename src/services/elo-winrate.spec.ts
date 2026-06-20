import { describe, expect, it } from 'vitest'

import {
  calculateExpectedScore,
  calculateExpectedScores,
  calculateRatingDiffByExpectedScore,
} from './elo-winrate'

describe('elo winrate service', () => {
  it('returns 50 percent expected score when ratings are equal', () => {
    expect(calculateExpectedScore(1600, 1600)).toBe(0.5)
  })

  it('calculates expected score for a 200 point advantage', () => {
    const result = calculateExpectedScores(1800, 1600)

    expect(result.ratingDiff).toBe(200)
    expect(result.expectedScoreA).toBeCloseTo(0.7597469, 6)
    expect(result.expectedScoreB).toBeCloseTo(0.2402531, 6)
  })

  it('converts target expected score back to rating difference', () => {
    const ratingDiff = calculateRatingDiffByExpectedScore(0.75)

    expect(ratingDiff).toBeCloseTo(190.8485, 4)
    expect(calculateExpectedScore(ratingDiff, 0)).toBeCloseTo(0.75, 6)
  })
})