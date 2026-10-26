export const CUBE_FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const

export type CubeFace = (typeof CUBE_FACES)[number]
export type CubeAxis = 'x' | 'y' | 'z'
export type CubeVector = readonly [number, number, number]
/** Row-major local-to-world rotation matrix. */
export type CubeMatrix = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

export interface CubeMove {
  face: CubeFace
  turns: 1 | -1 | 2
}

export interface CubeCubie {
  id: string
  position: CubeVector
  orientation: CubeMatrix
  /** Stickers are attached to the cubie's original, local faces. */
  stickers: Readonly<Record<CubeFace, string | null>>
}

export type CubeState = readonly CubeCubie[]

export const FACE_COLORS: Readonly<Record<CubeFace, string>> = {
  U: '#f5f3e9',
  D: '#ffd43b',
  F: '#36cf92',
  B: '#478bff',
  R: '#ff565b',
  L: '#ff9c42',
}

const IDENTITY: CubeMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const FACE_NORMALS: Record<CubeFace, CubeVector> = {
  U: [0, -1, 0],
  D: [0, 1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
}

export function faceRotation(face: CubeFace): {
  axis: CubeAxis
  layer: 1 | -1
  quarter: 1 | -1
} {
  switch (face) {
    case 'U': return { axis: 'y', layer: -1, quarter: -1 }
    case 'D': return { axis: 'y', layer: 1, quarter: 1 }
    case 'L': return { axis: 'x', layer: -1, quarter: -1 }
    case 'R': return { axis: 'x', layer: 1, quarter: 1 }
    case 'F': return { axis: 'z', layer: 1, quarter: 1 }
    case 'B': return { axis: 'z', layer: -1, quarter: -1 }
  }
}

export function createSolvedCube(): CubeState {
  const cubies: CubeCubie[] = []
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        cubies.push({
          id: `${x},${y},${z}`,
          position: [x, y, z],
          orientation: [...IDENTITY],
          stickers: {
            U: y === -1 ? FACE_COLORS.U : null,
            D: y === 1 ? FACE_COLORS.D : null,
            F: z === 1 ? FACE_COLORS.F : null,
            B: z === -1 ? FACE_COLORS.B : null,
            R: x === 1 ? FACE_COLORS.R : null,
            L: x === -1 ? FACE_COLORS.L : null,
          },
        })
      }
    }
  }
  return cubies
}

function transformVector(matrix: CubeMatrix, vector: CubeVector): CubeVector {
  const [x, y, z] = vector
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ]
}

function multiplyMatrices(a: CubeMatrix, b: CubeMatrix): CubeMatrix {
  const result: number[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      result.push(
        a[row * 3] * b[col]
        + a[row * 3 + 1] * b[col + 3]
        + a[row * 3 + 2] * b[col + 6],
      )
    }
  }
  return result as unknown as CubeMatrix
}

/** Positive CSS quarter turn: x→y for Z, z→x for Y, y→z for X. */
function quarterMatrix(axis: CubeAxis): CubeMatrix {
  if (axis === 'x') return [1, 0, 0, 0, 0, -1, 0, 1, 0]
  if (axis === 'y') return [0, 0, 1, 0, 1, 0, -1, 0, 0]
  return [0, -1, 0, 1, 0, 0, 0, 0, 1]
}

export function applyMove(cube: CubeState, move: CubeMove): CubeState {
  const { axis, layer, quarter } = faceRotation(move.face)
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const turnCount = ((quarter * move.turns) % 4 + 4) % 4
  let rotation = IDENTITY
  for (let i = 0; i < turnCount; i++) {
    rotation = multiplyMatrices(quarterMatrix(axis), rotation)
  }

  return cube.map((cubie) => cubie.position[axisIndex] === layer
    ? {
        ...cubie,
        position: transformVector(rotation, cubie.position),
        orientation: multiplyMatrices(rotation, cubie.orientation),
      }
    : cubie)
}

/** A solved cube may have any overall spatial orientation. */
export function isCubeSolved(cube: CubeState): boolean {
  if (cube.length !== 8) return false
  const faces = new Map<string, { color: string; count: number }>()
  for (const cubie of cube) {
    for (const face of CUBE_FACES) {
      const color = cubie.stickers[face]
      if (!color) continue
      const normal = transformVector(cubie.orientation, FACE_NORMALS[face])
      const key = normal.join(',')
      const existing = faces.get(key)
      if (existing && existing.color !== color) return false
      faces.set(key, { color, count: (existing?.count ?? 0) + 1 })
    }
  }
  return faces.size === 6 && [...faces.values()].every((face) => face.count === 4)
}

export function inverseMove(move: CubeMove): CubeMove {
  return { face: move.face, turns: move.turns === 2 ? 2 : move.turns === 1 ? -1 : 1 }
}

export function formatMove(move: CubeMove): string {
  return `${move.face}${move.turns === -1 ? "'" : move.turns === 2 ? '2' : ''}`
}

/** Avoid adjacent turns on the same face and redundant three-turn axis runs. */
export function createScramble(length = 18, random = Math.random): CubeMove[] {
  const moves: CubeMove[] = []
  const turns = [1, -1, 2] as const
  const count = Math.max(0, Math.min(1000, Math.floor(length)))
  for (let i = 0; i < count; i++) {
    const previous = moves[i - 1]
    const beforePrevious = moves[i - 2]
    const faces = CUBE_FACES.filter((face) => {
      if (face === previous?.face) return false
      if (!previous || !beforePrevious) return true
      const axis = faceRotation(face).axis
      return axis !== faceRotation(previous.face).axis
        || axis !== faceRotation(beforePrevious.face).axis
    })
    const sample = () => Math.max(0, Math.min(0.999999999999, random()))
    moves.push({
      face: faces[Math.floor(sample() * faces.length)],
      turns: turns[Math.floor(sample() * turns.length)],
    })
  }
  return moves
}

/** CSS matrix3d uses column-major order, unlike CubeMatrix. */
export function orientationToCssMatrix(matrix: CubeMatrix): string {
  return `matrix3d(${[
    matrix[0], matrix[3], matrix[6], 0,
    matrix[1], matrix[4], matrix[7], 0,
    matrix[2], matrix[5], matrix[8], 0,
    0, 0, 0, 1,
  ].join(',')})`
}
