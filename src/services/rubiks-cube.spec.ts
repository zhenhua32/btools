import { describe, expect, it } from 'vitest'
import {
  CUBE_FACES,
  FACE_COLORS,
  applyMove,
  createScramble,
  createSolvedCube,
  faceRotation,
  formatMove,
  inverseMove,
  isCubeSolved,
  orientationToCssMatrix,
  type CubeMove,
  type CubeState,
} from './rubiks-cube'

function applyMoves(cube: CubeState, moves: readonly CubeMove[]): CubeState {
  return moves.reduce((state, move) => applyMove(state, move), cube)
}

function determinant(m: readonly number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])
}

describe('2×2 Rubik cube engine', () => {
  it('creates eight corners with three stickers each and four stickers per color', () => {
    const cube = createSolvedCube()
    expect(isCubeSolved(cube)).toBe(true)
    expect(new Set(cube.map((cubie) => cubie.id)).size).toBe(8)
    const stickers = cube.flatMap((cubie) => Object.values(cubie.stickers).filter(Boolean))
    expect(stickers).toHaveLength(24)
    for (const cubie of cube) {
      expect(Object.values(cubie.stickers).filter(Boolean)).toHaveLength(3)
    }
    for (const color of Object.values(FACE_COLORS)) {
      expect(stickers.filter((sticker) => sticker === color)).toHaveLength(4)
    }
  })

  for (const face of CUBE_FACES) {
    it(`reverses ${face} turns and returns after four quarter turns`, () => {
      const cube = createSolvedCube()
      const move: CubeMove = { face, turns: 1 }
      const turned = applyMove(cube, move)
      expect(isCubeSolved(turned)).toBe(false)
      expect(applyMove(turned, inverseMove(move))).toEqual(cube)
      expect(applyMoves(cube, [move, move, move, move])).toEqual(cube)
      expect(applyMoves(cube, [{ face, turns: 2 }, { face, turns: 2 }])).toEqual(cube)
    })
  }

  it('rotates the front top-right corner clockwise to bottom-right in CSS coordinates', () => {
    const cube = createSolvedCube()
    const moved = applyMove(cube, { face: 'F', turns: 1 })
    expect(moved.find((cubie) => cubie.id === '1,-1,1')?.position).toEqual([1, 1, 1])
    expect(moved.find((cubie) => cubie.id === '1,-1,-1'))
      .toBe(cube.find((cubie) => cubie.id === '1,-1,-1'))
    expect(cube.find((cubie) => cubie.id === '1,-1,1')?.position).toEqual([1, -1, 1])
  })

  it('preserves integer positions, orientations and stickers through a long scramble', () => {
    let seed = 13
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const moves = createScramble(150, random)
    const original = createSolvedCube()
    const scrambled = applyMoves(original, moves)
    expect(new Set(scrambled.map((cubie) => cubie.position.join(','))).size).toBe(8)
    expect(isCubeSolved(scrambled)).toBe(false)
    for (const cubie of scrambled) {
      expect(cubie.position.every((coordinate) => coordinate === 1 || coordinate === -1)).toBe(true)
      expect(cubie.orientation.every((entry) => [-1, 0, 1].includes(entry))).toBe(true)
      expect(determinant(cubie.orientation)).toBe(1)
      expect(cubie.stickers).toEqual(original.find((corner) => corner.id === cubie.id)?.stickers)
    }
    expect(applyMoves(scrambled, [...moves].reverse().map(inverseMove))).toEqual(original)
  })

  it('recognizes solved states after whole-cube turns around every axis', () => {
    for (const pair of [['R', 'L'], ['D', 'U'], ['F', 'B']] as const) {
      const rotated = applyMoves(createSolvedCube(), [
        { face: pair[0], turns: 1 },
        { face: pair[1], turns: -1 },
      ])
      expect(isCubeSolved(rotated)).toBe(true)
      expect(rotated).not.toEqual(createSolvedCube())
    }
  })

  it('generates a deterministic legal scramble without repeated faces or axis triples', () => {
    const moves = createScramble(40, () => 0)
    expect(moves).toHaveLength(40)
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i].face).not.toBe(moves[i - 1].face)
      if (i >= 2) {
        expect(new Set(moves.slice(i - 2, i + 1).map((move) => faceRotation(move.face).axis)).size)
          .toBeGreaterThan(1)
      }
    }
    expect(createScramble(0)).toEqual([])
  })

  it('formats standard notation and transposes row-major matrices for CSS', () => {
    expect(formatMove({ face: 'R', turns: 1 })).toBe('R')
    expect(formatMove({ face: 'U', turns: -1 })).toBe("U'")
    expect(formatMove({ face: 'F', turns: 2 })).toBe('F2')
    expect(inverseMove({ face: 'F', turns: 2 })).toEqual({ face: 'F', turns: 2 })
    expect(orientationToCssMatrix([0, -1, 0, 1, 0, 0, 0, 0, 1]))
      .toBe('matrix3d(0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1)')
  })
})
