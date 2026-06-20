export const DEFAULT_ELO_SCALE_FACTOR = 400

export interface EloMatchupResult {
  ratingA: number
  ratingB: number
  ratingDiff: number
  expectedScoreA: number
  expectedScoreB: number
  scaleFactor: number
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`)
  }
}

function assertValidScaleFactor(scaleFactor: number): void {
  assertFiniteNumber(scaleFactor, 'Elo 缩放系数')
  if (scaleFactor <= 0) {
    throw new Error('Elo 缩放系数必须大于 0')
  }
}

export function calculateExpectedScore(
  ratingSelf: number,
  ratingOpponent: number,
  scaleFactor = DEFAULT_ELO_SCALE_FACTOR,
): number {
  assertFiniteNumber(ratingSelf, '己方分数')
  assertFiniteNumber(ratingOpponent, '对手分数')
  assertValidScaleFactor(scaleFactor)

  return 1 / (1 + 10 ** ((ratingOpponent - ratingSelf) / scaleFactor))
}

export function calculateExpectedScores(
  ratingA: number,
  ratingB: number,
  scaleFactor = DEFAULT_ELO_SCALE_FACTOR,
): EloMatchupResult {
  const expectedScoreA = calculateExpectedScore(ratingA, ratingB, scaleFactor)

  return {
    ratingA,
    ratingB,
    ratingDiff: ratingA - ratingB,
    expectedScoreA,
    expectedScoreB: 1 - expectedScoreA,
    scaleFactor,
  }
}

export function calculateRatingDiffByExpectedScore(
  expectedScore: number,
  scaleFactor = DEFAULT_ELO_SCALE_FACTOR,
): number {
  assertFiniteNumber(expectedScore, '目标胜率')
  assertValidScaleFactor(scaleFactor)

  if (!(expectedScore > 0 && expectedScore < 1)) {
    throw new Error('目标胜率必须大于 0 且小于 1')
  }

  return -scaleFactor * Math.log10(1 / expectedScore - 1)
}