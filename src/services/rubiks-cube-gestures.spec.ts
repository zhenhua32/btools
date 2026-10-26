import { describe, expect, it } from 'vitest'
import { CUBE_FACES, applyMove, createSolvedCube, faceRotation } from './rubiks-cube'
import { getFaceNormal, getStickerWorldFace, resolveCubeDrag } from './rubiks-cube-gestures'

describe('cube sticker drag gestures', () => {
  const cube = createSolvedCube()
  const frontTopLeft = cube.find((corner) => corner.id === '-1,-1,1')!
  const straightView = { x: 0, y: 0 }

  it('tracks a sticker’s current world face after a layer turn', () => {
    for (const cubie of cube) {
      for (const face of CUBE_FACES) expect(getStickerWorldFace(cubie, face)).toBe(face)
    }
    const turned = applyMove(cube, { face: 'F', turns: 1 })
    const corner = turned.find((cubie) => cubie.id === frontTopLeft.id)!
    expect(getStickerWorldFace(corner, 'U')).toBe('R')
    expect(getStickerWorldFace(corner, 'L')).toBe('U')
    expect(getStickerWorldFace(corner, 'F')).toBe('F')
  })

  it('turns the top or bottom row in the horizontal drag direction', () => {
    const right = resolveCubeDrag(frontTopLeft, 'F', straightView, { x: 50, y: 0 })!
    const left = resolveCubeDrag(frontTopLeft, 'F', straightView, { x: -50, y: 0 })!
    expect(right).toMatchObject({ face: 'U', turns: -1, axis: 'y', quarter: -1, alignment: 1 })
    expect(left).toMatchObject({ face: 'U', turns: 1, axis: 'y', quarter: -1, alignment: 1 })
    const frontBottomRight = cube.find((corner) => corner.id === '1,1,1')!
    expect(resolveCubeDrag(frontBottomRight, 'F', straightView, { x: 50, y: 0 }))
      .toMatchObject({ face: 'D', turns: 1, axis: 'y' })
  })

  it('turns the touched left or right column for vertical drags', () => {
    expect(resolveCubeDrag(frontTopLeft, 'F', straightView, { x: 0, y: -50 }))
      .toMatchObject({ face: 'L', turns: -1, axis: 'x', quarter: -1 })
    expect(resolveCubeDrag(frontTopLeft, 'F', straightView, { x: 0, y: 50 }))
      .toMatchObject({ face: 'L', turns: 1, axis: 'x' })
    const frontTopRight = cube.find((corner) => corner.id === '1,-1,1')!
    expect(resolveCubeDrag(frontTopRight, 'F', straightView, { x: 0, y: -50 }))
      .toMatchObject({ face: 'R', turns: 1, axis: 'x', quarter: 1 })
  })

  it('keeps intuitive front-face row and column controls in the default orbit view', () => {
    const view = { x: -26, y: -34 }
    expect(resolveCubeDrag(frontTopLeft, 'F', view, { x: 80, y: 0 }))
      .toMatchObject({ face: 'U', turns: -1 })
    expect(resolveCubeDrag(frontTopLeft, 'F', view, { x: 0, y: -80 }))
      .toMatchObject({ face: 'L', turns: -1 })
  })

  it('uses the camera rotation when dragging a side face now facing the viewer', () => {
    const rightFrontTop = cube.find((corner) => corner.id === '1,-1,1')!
    const view = { x: 0, y: -90 }
    expect(resolveCubeDrag(rightFrontTop, 'R', view, { x: 70, y: 0 }))
      .toMatchObject({ face: 'U', turns: -1, axis: 'y' })
    expect(resolveCubeDrag(rightFrontTop, 'R', view, { x: 0, y: -70 }))
      .toMatchObject({ face: 'F', turns: -1, axis: 'z' })
  })

  it('ignores taps, empty inner faces, non-finite coordinates, and ambiguous diagonal drags', () => {
    expect(resolveCubeDrag(frontTopLeft, 'F', straightView, { x: 7, y: 0 })).toBeNull()
    expect(resolveCubeDrag(frontTopLeft, 'B', straightView, { x: 50, y: 0 })).toBeNull()
    expect(resolveCubeDrag(frontTopLeft, 'F', straightView, { x: Infinity, y: 0 })).toBeNull()
    expect(resolveCubeDrag(frontTopLeft, 'F', straightView, { x: 50, y: 50 })).toBeNull()
  })

  it('always chooses a tangent layer containing the touched corner, including after scrambling', () => {
    let scrambled = cube
    for (const face of ['R', 'U', 'F', 'L', 'B', 'D'] as const) {
      scrambled = applyMove(scrambled, { face, turns: -1 })
    }
    let resolved = 0
    for (const cubie of scrambled) {
      for (const face of CUBE_FACES) {
        if (!cubie.stickers[face]) continue
        const normal = getFaceNormal(getStickerWorldFace(cubie, face))
        for (const view of [{ x: -26, y: -34 }, { x: 35, y: 150 }]) {
          for (const delta of [{ x: 80, y: 5 }, { x: -5, y: 80 }, { x: -80, y: -5 }]) {
            const turn = resolveCubeDrag(cubie, face, view, delta)
            if (!turn) continue
            resolved++
            const index = { x: 0, y: 1, z: 2 }[turn.axis]
            const rotation = faceRotation(turn.face)
            expect(normal[index]).toBe(0)
            expect(cubie.position[index]).toBe(rotation.layer)
            expect(turn.quarter).toBe(rotation.quarter)
            expect(turn.alignment).toBeGreaterThanOrEqual(.55)
            expect([-1, 1]).toContain(turn.turns)
            const inverse = resolveCubeDrag(cubie, face, view, { x: -delta.x, y: -delta.y })!
            expect(inverse.face).toBe(turn.face)
            expect(inverse.turns).toBe(-turn.turns)
          }
        }
      }
    }
    expect(resolved).toBeGreaterThan(100)
  })
})
