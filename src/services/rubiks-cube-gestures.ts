import { faceRotation } from './rubiks-cube'
import type { CubeAxis, CubeCubie, CubeFace, CubeVector } from './rubiks-cube'

const FACE_NORMALS: Readonly<Record<CubeFace, CubeVector>> = {
  U: [0, -1, 0],
  D: [0, 1, 0],
  L: [-1, 0, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
}

const AXES: readonly CubeAxis[] = ['x', 'y', 'z']
const AXIS_VECTORS: Readonly<Record<CubeAxis, CubeVector>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

export interface CubeDragView {
  x: number
  y: number
}

export interface CubeDragDelta {
  x: number
  y: number
}

export interface CubeDragTurn {
  face: CubeFace
  turns: 1 | -1
  axis: CubeAxis
  /** Multiply by turns to obtain the signed CSS quarter-turn direction. */
  quarter: 1 | -1
  alignment: number
}

export function getFaceNormal(face: CubeFace): CubeVector {
  return FACE_NORMALS[face]
}

/** Stickers keep their local identity while their visible world face changes. */
export function getStickerWorldFace(cubie: CubeCubie, localFace: CubeFace): CubeFace {
  const [x, y, z] = FACE_NORMALS[localFace]
  const matrix = cubie.orientation
  const normal: CubeVector = [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ]
  if (normal[0]) return normal[0] > 0 ? 'R' : 'L'
  if (normal[1]) return normal[1] > 0 ? 'D' : 'U'
  return normal[2] > 0 ? 'F' : 'B'
}

function cross(a: CubeVector, b: CubeVector): CubeVector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

/** CSS rotateX(pitch) rotateY(yaw) applies the Y rotation first. */
function projectToScreen(vector: CubeVector, view: CubeDragView): CubeDragDelta {
  const pitch = view.x * Math.PI / 180
  const yaw = view.y * Math.PI / 180
  const x = Math.cos(yaw) * vector[0] + Math.sin(yaw) * vector[2]
  const y = vector[1]
  const z = -Math.sin(yaw) * vector[0] + Math.cos(yaw) * vector[2]
  return { x, y: Math.cos(pitch) * y - Math.sin(pitch) * z }
}

function layerFace(axis: CubeAxis, coordinate: number): CubeFace {
  if (axis === 'x') return coordinate > 0 ? 'R' : 'L'
  if (axis === 'y') return coordinate > 0 ? 'D' : 'U'
  return coordinate > 0 ? 'F' : 'B'
}

/**
 * Convert a drag on an actual sticker into a row/column turn. The projected
 * tangent of each legal layer determines both the axis and rotation direction,
 * so controls continue to follow the pointer after orbiting or scrambling.
 */
export function resolveCubeDrag(
  cubie: CubeCubie,
  localFace: CubeFace,
  view: CubeDragView,
  delta: CubeDragDelta,
): CubeDragTurn | null {
  const distance = Math.hypot(delta.x, delta.y)
  if (!Number.isFinite(distance) || distance < 8 || !cubie.stickers[localFace]) return null
  const normal = FACE_NORMALS[getStickerWorldFace(cubie, localFace)]
  // Cubie centers are ±1; the outside sticker is about one cubie radius farther.
  const surface: CubeVector = [
    cubie.position[0] + normal[0] * .95,
    cubie.position[1] + normal[1] * .95,
    cubie.position[2] + normal[2] * .95,
  ]
  const candidates: CubeDragTurn[] = []
  for (const [index, axis] of AXES.entries()) {
    if (normal[index]) continue
    const velocity = projectToScreen(cross(AXIS_VECTORS[axis], surface), view)
    const speed = Math.hypot(velocity.x, velocity.y)
    if (speed < .15) continue
    const alignment = (velocity.x * delta.x + velocity.y * delta.y) / (speed * distance)
    const face = layerFace(axis, cubie.position[index])
    const { quarter } = faceRotation(face)
    candidates.push({
      face,
      axis,
      quarter,
      turns: alignment >= 0 ? quarter : quarter === 1 ? -1 : 1,
      alignment: Math.abs(alignment),
    })
  }
  candidates.sort((a, b) => b.alignment - a.alignment)
  const best = candidates[0]
  if (!best || best.alignment < .55) return null
  // Wait for a clearer gesture rather than choosing a layer for a diagonal.
  if (candidates[1] && best.alignment - candidates[1].alignment < .08) return null
  return best
}
