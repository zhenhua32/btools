<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import type { CSSProperties } from 'vue'
import { NModal } from 'naive-ui'
import {
  applyMove,
  createScramble,
  createSolvedCube,
  CUBE_FACES,
  FACE_COLORS,
  faceRotation,
  formatMove,
  inverseMove,
  isCubeSolved,
  orientationToCssMatrix,
} from '@/services/rubiks-cube'
import type { CubeCubie, CubeFace, CubeMove } from '@/services/rubiks-cube'
import { getStickerWorldFace, resolveCubeDrag } from '@/services/rubiks-cube-gestures'
import type { CubeDragTurn } from '@/services/rubiks-cube-gestures'

const cube = ref(createSolvedCube())
const viewport = ref<HTMLElement>()
const pitch = 106
const view = ref({ x: -26, y: -34 })
const zoom = ref(1)
const exploded = ref(false)
const showHelp = ref(false)
const slowMotion = ref(false)
const busy = ref(false)
const operation = ref<'shuffle' | 'return' | null>(null)
const activeMove = ref<{ move: CubeMove; angle: number } | null>(null)
const phase = ref<'ready' | 'scrambled' | 'playing' | 'solved'>('ready')
const elapsed = ref(0)
const moves = ref<CubeMove[]>([])
const path = ref<CubeMove[]>([])
const scramble = ref<CubeMove[]>([])
const statusMessage = ref('从一次打乱开始，试试你的手感。')
type CubePointerDrag = {
  pointerId: number
  x: number
  y: number
} & ({
  mode: 'orbit'
  originX: number
  originY: number
} | {
  mode: 'layer'
  startedAt: number
  cubie: CubeCubie
  localFace: CubeFace
  resolved: CubeDragTurn | null
  direction: { x: number; y: number }
  angle: number
})
const drag = ref<CubePointerDrag | null>(null)
const hoveredFace = ref<CubeFace | null>(null)
const gesturePreview = ref(false)
let clockStart = 0
let clockInterval: ReturnType<typeof setInterval> | undefined
let animationTimer: ReturnType<typeof setTimeout> | undefined
let finishAnimation: (() => void) | undefined
let session = 0
let active = false
let reducedMotion = false
let lastWheelTurn = -Infinity

const faceNames: Record<CubeFace, string> = { U: '上面', D: '下面', L: '左面', R: '右面', F: '前面', B: '后面' }
const controls: CubeFace[] = ['U', 'D', 'L', 'R', 'F', 'B']
const solved = computed(() => isCubeSolved(cube.value))
const time = computed(() => {
  const centiseconds = Math.floor(elapsed.value / 10)
  const minutes = Math.floor(centiseconds / 6000)
  const seconds = Math.floor(centiseconds / 100) % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
})
const status = computed(() => {
  if (operation.value === 'shuffle') return '正在打乱'
  if (operation.value === 'return') return '正在复原'
  if (phase.value === 'solved') return '挑战完成'
  if (phase.value === 'playing') return '挑战中'
  if (phase.value === 'scrambled') return '准备就绪'
  return '已复原'
})
const cubeStyle = computed<CSSProperties>(() => ({
  transform: `rotateX(${view.value.x}deg) rotateY(${view.value.y}deg)`,
  '--cube-zoom': zoom.value,
}))
const lastMoves = computed(() => moves.value.slice(-12))

function cubieStyle(cubie: CubeCubie): CSSProperties {
  const spacing = exploded.value ? pitch * 1.33 : pitch
  const [x, y, z] = cubie.position
  return { transform: `translate3d(${x * spacing / 2}px, ${y * spacing / 2}px, ${z * spacing / 2}px) ${orientationToCssMatrix(cubie.orientation)}` }
}

function layerStyle(cubie: CubeCubie): CSSProperties {
  if (!activeMove.value) return {}
  const { axis, layer } = faceRotation(activeMove.value.move.face)
  const index = { x: 0, y: 1, z: 2 }[axis]
  if (cubie.position[index] !== layer) return {}
  return { transform: `rotate${axis.toUpperCase()}(${activeMove.value.angle}deg)`, transitionDuration: `${moveDuration()}ms` }
}

function faceStyle(cubie: CubeCubie, face: CubeFace): CSSProperties {
  return { '--sticker-color': cubie.stickers[face] ?? '#15171b' }
}

function faceLabelStyle(face: CubeFace): CSSProperties {
  const transforms: Record<CubeFace, string> = {
    F: 'translateZ(110px)',
    B: 'rotateY(180deg) translateZ(110px)',
    R: 'rotateY(90deg) translateZ(110px)',
    L: 'rotateY(-90deg) translateZ(110px)',
    U: 'rotateX(90deg) translateZ(110px)',
    D: 'rotateX(-90deg) translateZ(110px)',
  }
  return { transform: transforms[face] }
}

function moveDuration() {
  if (reducedMotion) return 0
  if (operation.value === 'shuffle') return 95
  if (operation.value === 'return') return slowMotion.value ? 380 : 130
  return slowMotion.value ? 550 : 240
}

function tick() {
  if (phase.value === 'playing') elapsed.value = performance.now() - clockStart
}

function startClock(startedAt = performance.now()) {
  if (phase.value === 'playing') return
  if (phase.value === 'solved') {
    elapsed.value = 0
    moves.value = []
    path.value = []
  }
  phase.value = 'playing'
  clockStart = startedAt - elapsed.value
}

async function animateMove(move: CubeMove, token: number, fromAngle = 0, commit = true) {
  if (token !== session || !active) return false
  activeMove.value = { move, angle: fromAngle }
  gesturePreview.value = false
  await nextTick()
  if (token !== session || !active) return false
  // Commit the zero-angle frame before starting the layer's CSS transition.
  void viewport.value?.offsetWidth
  const rotation = faceRotation(move.face)
  activeMove.value = { move, angle: commit ? rotation.quarter * move.turns * 90 : 0 }
  await new Promise<void>((resolve) => {
    finishAnimation = resolve
    animationTimer = setTimeout(resolve, moveDuration())
  })
  finishAnimation = undefined
  animationTimer = undefined
  if (token !== session) return false
  if (commit) cube.value = applyMove(cube.value, move)
  activeMove.value = null
  await nextTick()
  return true
}

function checkCompletion() {
  tick()
  if (solved.value && phase.value === 'playing') {
    phase.value = 'solved'
    statusMessage.value = `漂亮！用 ${moves.value.length} 步找回了六面的秩序。`
  }
}

async function performManualMove(move: CubeMove, fromAngle = 0, startedAt = performance.now()) {
  if (busy.value || exploded.value || drag.value || !active) return
  busy.value = true
  const token = session
  if (await animateMove(move, token, fromAngle)) {
    startClock(startedAt)
    moves.value = [...moves.value, move]
    path.value = [...path.value, move]
    checkCompletion()
    if (!solved.value) statusMessage.value = `${faceNames[move.face]}${move.turns === -1 ? '逆' : '顺'}时针转动 90° · ${formatMove(move)}`
  }
  if (token === session) busy.value = false
}

async function turn(face: CubeFace, inverse = false) {
  await performManualMove({ face, turns: inverse ? -1 : 1 })
}

async function shuffleCube() {
  if (busy.value || drag.value || !active) return
  busy.value = true
  operation.value = 'shuffle'
  exploded.value = false
  cube.value = createSolvedCube()
  activeMove.value = null
  path.value = []
  moves.value = []
  elapsed.value = 0
  phase.value = 'ready'
  scramble.value = createScramble(16)
  const token = session
  for (const move of scramble.value) {
    if (!await animateMove(move, token)) return
    path.value = [...path.value, move]
  }
  // A random sequence can theoretically return to a solved cube.
  if (solved.value) {
    const extra: CubeMove = { face: 'R', turns: 1 }
    if (!await animateMove(extra, token)) return
    path.value = [...path.value, extra]
    scramble.value = [...scramble.value, extra]
  }
  phase.value = 'scrambled'
  operation.value = null
  busy.value = false
  statusMessage.value = '已打乱。转动任意一面开始计时，祝你玩得开心。'
}

async function undo() {
  if (busy.value || drag.value || exploded.value || !moves.value.length) return
  busy.value = true
  const token = session
  const previous = moves.value[moves.value.length - 1]!
  if (phase.value === 'solved') {
    phase.value = 'playing'
    clockStart = performance.now() - elapsed.value
  }
  if (await animateMove(inverseMove(previous), token)) {
    moves.value = moves.value.slice(0, -1)
    path.value = path.value.slice(0, -1)
    checkCompletion()
    if (!solved.value) statusMessage.value = `已撤销 ${formatMove(previous)}。`
  }
  if (token === session) busy.value = false
}

async function restore() {
  if (busy.value || drag.value || solved.value || !path.value.length || !active) return
  busy.value = true
  operation.value = 'return'
  exploded.value = false
  tick()
  phase.value = 'ready'
  const solution = path.value.slice().reverse().map(inverseMove)
  const token = session
  for (let i = 0; i < solution.length; i++) {
    statusMessage.value = `沿转动记录复原 · ${i + 1} / ${solution.length}`
    if (!await animateMove(solution[i]!, token)) return
    path.value = path.value.slice(0, -1)
  }
  operation.value = null
  busy.value = false
  phase.value = 'ready'
  elapsed.value = 0
  moves.value = []
  scramble.value = []
  statusMessage.value = '六面归位。再来一局，发现新的可能。'
}

function resetView() {
  if (drag.value) return
  view.value = { x: -26, y: -34 }
  zoom.value = 1
}

function pointerDown(event: PointerEvent) {
  if ((event.button !== 0 && event.button !== 2) || drag.value || !active) return
  const hit = stickerAt(event.target)
  if (hit && event.button === 0 && !event.altKey) {
    if (busy.value || exploded.value) return
    drag.value = {
      mode: 'layer', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      ...hit, startedAt: performance.now(), resolved: null, direction: { x: 0, y: 0 }, angle: 0,
    }
    hoveredFace.value = getStickerWorldFace(hit.cubie, hit.localFace)
  } else {
    drag.value = { mode: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.value.x, originY: view.value.y }
  }
  event.preventDefault()
  viewport.value?.setPointerCapture(event.pointerId)
  viewport.value?.focus({ preventScroll: true })
}

function pointerMove(event: PointerEvent) {
  if (!drag.value) {
    const hit = stickerAt(event.target)
    hoveredFace.value = hit ? getStickerWorldFace(hit.cubie, hit.localFace) : null
    return
  }
  if (drag.value.pointerId !== event.pointerId) return
  const delta = { x: event.clientX - drag.value.x, y: event.clientY - drag.value.y }
  if (drag.value.mode === 'orbit') {
    view.value = {
      x: Math.max(-88, Math.min(88, drag.value.originX - delta.y * .45)),
      y: drag.value.originY + delta.x * .45,
    }
    return
  }
  const gesture = drag.value
  if (!gesture.resolved) {
    gesture.resolved = resolveCubeDrag(gesture.cubie, gesture.localFace, view.value, delta)
    if (!gesture.resolved) return
    const distance = Math.hypot(delta.x, delta.y)
    gesture.direction = { x: delta.x / distance, y: delta.y / distance }
  }
  const travel = delta.x * gesture.direction.x + delta.y * gesture.direction.y
  gesture.angle = gesture.resolved.quarter * gesture.resolved.turns * Math.max(-100, Math.min(100, travel * .8))
  gesturePreview.value = true
  activeMove.value = {
    move: { face: gesture.resolved.face, turns: gesture.resolved.turns },
    angle: gesture.angle,
  }
}

function pointerUp(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return
  const gesture = drag.value
  drag.value = null
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  if (gesture.mode !== 'layer' || !gesture.resolved) return
  if (Math.abs(gesture.angle) < 22) {
    void cancelPreview(gesture)
    return
  }
  const turns = gesture.angle * gesture.resolved.quarter > 0 ? 1 : -1
  void performManualMove({ face: gesture.resolved.face, turns }, gesture.angle, gesture.startedAt)
}

function pointerCancel(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return
  const gesture = drag.value
  drag.value = null
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  if (gesture.mode === 'layer' && gesture.resolved) void cancelPreview(gesture)
}

async function cancelPreview(gesture: Extract<CubePointerDrag, { mode: 'layer' }>) {
  if (!gesture.resolved || busy.value) return
  busy.value = true
  const token = session
  await animateMove({ face: gesture.resolved.face, turns: gesture.resolved.turns }, token, gesture.angle, false)
  if (token === session) busy.value = false
}

function stickerAt(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('[data-cubie-id][data-local-face]')
  if (!element || !viewport.value?.contains(element)) return null
  const cubie = cube.value.find((item) => item.id === element.dataset.cubieId)
  const localFace = element.dataset.localFace as CubeFace
  if (!cubie || !CUBE_FACES.includes(localFace) || !cubie.stickers[localFace]) return null
  return { cubie, localFace }
}

function wheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) return
  event.preventDefault()
  if (drag.value) return
  const hit = stickerAt(event.target)
  if (hit) {
    if (busy.value || exploded.value || Math.abs(event.deltaY) < 4 || performance.now() - lastWheelTurn < 400) return
    lastWheelTurn = performance.now()
    hoveredFace.value = getStickerWorldFace(hit.cubie, hit.localFace)
    void turn(hoveredFace.value, event.deltaY < 0)
    return
  }
  zoom.value = Math.max(.65, Math.min(1.4, zoom.value - event.deltaY * .001))
}

function handleKey(event: KeyboardEvent) {
  if (showHelp.value) {
    if (event.key === 'Escape') showHelp.value = false
    return
  }
  const target = event.target instanceof HTMLElement ? event.target : null
  if (event.ctrlKey || event.metaKey || event.altKey || target?.isContentEditable || target?.closest('input, textarea, select, [role="dialog"]')) return
  const face = event.key.toUpperCase()
  if (CUBE_FACES.includes(face as CubeFace) && !event.repeat) {
    event.preventDefault()
    void turn(face as CubeFace, event.shiftKey)
  } else if (event.key === 'Escape') {
    showHelp.value = false
  }
}

function activate() {
  if (active) return
  active = true
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  window.addEventListener('keydown', handleKey)
  clockInterval = setInterval(tick, 30)
  tick()
}

function deactivate() {
  if (!active) return
  showHelp.value = false
  tick()
  active = false
  session++
  window.removeEventListener('keydown', handleKey)
  clearInterval(clockInterval)
  clearTimeout(animationTimer)
  finishAnimation?.()
  finishAnimation = undefined
  activeMove.value = null
  gesturePreview.value = false
  hoveredFace.value = null
  drag.value = null
  if (operation.value) {
    // Leave an interrupted sequence in a valid state with its actual path.
    if (operation.value === 'shuffle') scramble.value = [...path.value]
    phase.value = solved.value ? 'ready' : 'scrambled'
    statusMessage.value = '转动已暂停，可以继续操作或重新打乱。'
  }
  operation.value = null
  busy.value = false
}

onMounted(activate)
onActivated(activate)
onDeactivated(deactivate)
onUnmounted(deactivate)
</script>

<template>
  <section class="cube-workshop" aria-label="二阶魔方工作台">
    <header class="workshop-header">
      <div class="brand-lockup">
        <span class="brand-icon i-carbon-cube" aria-hidden="true" />
        <span class="brand-wordmark">二阶魔方</span>
        <span class="edition-badge">2 × 2 × 2</span>
      </div>
      <button class="help-button" :disabled="!!drag" :aria-expanded="showHelp" aria-haspopup="dialog" aria-controls="cube-guide" @click="showHelp = true">
        <span class="i-carbon-help" aria-hidden="true" /> 操作指南
      </button>
    </header>

    <div class="workshop-heading">
      <div>
        <h1>直接上手，转动魔方</h1>
        <p>拖动色块转动一层，拖动空白处调整视角。</p>
      </div>
      <div class="live-label"><span /> 实时 3D 交互</div>
    </div>

    <div class="playground-layout">
      <div class="stage-column">
        <div class="cube-stage" :class="{ 'is-dragging': drag?.mode === 'orbit', 'is-turning': gesturePreview, 'is-solved': phase === 'solved' }">
          <div class="stage-caption"><span class="stage-index">拖动色块即可转层</span><span class="stage-material">{{ hoveredFace ? `当前指向：${faceNames[hoveredFace]}` : '指向任意一面试试' }}</span></div>
          <div class="cube-floor-shadow" :class="{ 'is-exploded': exploded }" aria-hidden="true" />

          <div
            ref="viewport"
            class="cube-viewport"
            tabindex="0"
            role="group"
            aria-label="立体二阶魔方。拖动色块转动一层，拖动空白处旋转视角。指向魔方面滚动可转动该面，空白处滚动可缩放。"
            @pointerdown="pointerDown"
            @pointermove="pointerMove"
            @pointerup="pointerUp"
            @pointercancel="pointerCancel"
            @lostpointercapture="pointerCancel"
            @pointerleave="!drag && (hoveredFace = null)"
            @wheel="wheel"
            @contextmenu.prevent
            @dblclick="resetView"
          >
            <div class="cube-scale" :style="{ '--cube-zoom': zoom }">
              <div class="cube-view" :class="{ 'view-dragging': drag?.mode === 'orbit' }" :style="cubeStyle">
                <div v-for="cubie in cube" :key="cubie.id" class="cubie-layer" :class="{ 'layer-turning': activeMove }" :style="layerStyle(cubie)">
                  <div class="cubie" :style="cubieStyle(cubie)">
                    <div
                      v-for="face in CUBE_FACES"
                      :key="face"
                      class="cubie-face"
                      :class="[`cubie-face-${face}`, { 'has-sticker': cubie.stickers[face], 'sticker-highlighted': cubie.stickers[face] && hoveredFace === getStickerWorldFace(cubie, face) }]"
                      :style="faceStyle(cubie, face)"
                      :data-cubie-id="cubie.id"
                      :data-local-face="face"
                    >
                      <span v-if="cubie.stickers[face]" class="cube-sticker"><span class="sticker-sheen" /></span>
                    </div>
                  </div>
                </div>
                <span v-for="face in CUBE_FACES" :key="`label-${face}`" class="world-face-label" :style="faceLabelStyle(face)" aria-hidden="true">{{ faceNames[face] }}</span>
              </div>
            </div>
          </div>

          <div v-if="phase === 'solved'" class="completion-badge"><span class="i-carbon-checkmark-filled" /> 六面归位，漂亮！</div>
          <div class="stage-bottom">
            <span class="orbit-hint"><span class="i-carbon-touch-interaction" aria-hidden="true" /> 拖色块转层，拖空白转视角</span>
            <div class="stage-actions">
              <button class="stage-icon-button" :class="{ selected: exploded }" :disabled="busy || !!drag" :aria-pressed="exploded" title="分解视图：观察八个角块" aria-label="切换分解视图" @click="exploded = !exploded">
                <span class="i-carbon-3d-cursor-alt" aria-hidden="true" />
              </button>
              <button class="stage-icon-button" :disabled="!!drag" title="重置视角（也可双击舞台）" aria-label="重置视角" @click="resetView"><span class="i-carbon-center-circle" aria-hidden="true" /></button>
            </div>
          </div>
        </div>

        <p class="interaction-hint">也可以指向一个面滚动鼠标滚轮；在空白处滚动可缩放。</p>

        <div class="scramble-strip">
          <div class="strip-label"><span class="i-carbon-shuffle" aria-hidden="true" /> 打乱公式</div>
          <p v-if="scramble.length" class="scramble-notation">{{ scramble.map(formatMove).join('  ') }}</p>
          <p v-else class="strip-placeholder">准备好了？点击「随机打乱」开启一局。</p>
          <span v-if="scramble.length" class="scramble-length">{{ scramble.length }} 步</span>
        </div>
      </div>

      <aside class="control-panel" aria-label="魔方控制面板">
        <div class="session-heading"><span>你的这一局</span><span class="status-pill" :class="{ 'status-playing': phase === 'playing', 'status-complete': phase === 'solved' }"><span />{{ status }}</span></div>
        <div class="session-stats">
          <div class="stat-block"><span class="stat-label"><span class="i-carbon-time" aria-hidden="true" /> 用时</span><strong class="time-value">{{ time }}</strong><span class="stat-footnote">首次转动开始计时</span></div>
          <div class="stat-block moves-stat"><span class="stat-label"><span class="i-carbon-renew" aria-hidden="true" /> 步数</span><strong>{{ String(moves.length).padStart(2, '0') }}<small>步</small></strong><span class="stat-footnote">每次转动 +1</span></div>
        </div>

        <div class="panel-separator" />
        <details class="button-controls">
          <summary>按面转动 / 键盘快捷键</summary>
          <div class="section-heading"><h2>转动一面</h2><span>↻ 顺时针 / ↺ 逆时针</span></div>
          <div class="face-controls">
          <div v-for="face in controls" :key="face" class="face-control">
            <div class="face-label"><span class="face-color" :style="{ background: FACE_COLORS[face] }" /><span>{{ faceNames[face] }}</span><kbd>{{ face }}</kbd></div>
            <div class="face-button-pair">
              <button :disabled="busy || !!drag || exploded" :title="`${faceNames[face]}顺时针 90°（${face}）`" :aria-label="`${faceNames[face]}顺时针转动`" @click="turn(face)"><span>↻</span></button>
              <button :disabled="busy || !!drag || exploded" :title="`${faceNames[face]}逆时针 90°（Shift + ${face}）`" :aria-label="`${faceNames[face]}逆时针转动`" @click="turn(face, true)"><span>↺</span></button>
            </div>
          </div>
          </div>
          <p class="keyboard-hint"><span class="i-carbon-keyboard" aria-hidden="true" /> 键盘 U D L R F B<span> · Shift 反向</span></p>
        </details>
        <p v-if="exploded" class="explode-hint">当前为分解视图，退出后可继续转动。</p>

        <div class="panel-separator" />
        <button class="shuffle-button" :disabled="busy || !!drag" @click="shuffleCube"><span :class="operation === 'shuffle' ? 'i-carbon-renew spin-icon' : 'i-carbon-shuffle'" aria-hidden="true" />{{ operation === 'shuffle' ? '打乱中…' : '随机打乱' }}<span v-if="operation !== 'shuffle'" class="button-arrow">↗</span></button>
        <div class="secondary-actions">
          <button :disabled="busy || !!drag || !moves.length || exploded" title="撤销上一次手动转动" @click="undo"><span class="i-carbon-undo" aria-hidden="true" /> 撤销一步</button>
          <button :disabled="busy || !!drag || solved" title="沿本局转动记录反向演示复原" @click="restore"><span :class="operation === 'return' ? 'i-carbon-renew spin-icon' : 'i-carbon-reset'" aria-hidden="true" />{{ operation === 'return' ? '复原中…' : '自动复原' }}</button>
        </div>
        <label class="slow-motion-control"><span><span class="i-carbon-play-outline" aria-hidden="true" /> 慢动作观察</span><input v-model="slowMotion" type="checkbox" :disabled="busy || !!drag" /><span class="toggle-track" aria-hidden="true" /></label>
      </aside>
    </div>

    <div class="activity-bar">
      <div class="activity-message" role="status" aria-live="polite"><span class="activity-dot" :class="{ 'activity-complete': phase === 'solved' }" />{{ statusMessage }}</div>
      <div v-if="lastMoves.length" class="move-trail" aria-label="最近的转动"><span v-for="(move, index) in lastMoves" :key="index" :class="{ 'latest-move': index === lastMoves.length - 1 }">{{ formatMove(move) }}</span></div>
      <span v-else class="activity-note">保持好奇，享受转动。</span>
    </div>

    <NModal v-model:show="showHelp">
      <section id="cube-guide" class="guide-panel" role="dialog" aria-modal="true" aria-labelledby="cube-guide-title">
        <div class="guide-heading"><h2 id="cube-guide-title">操作指南</h2><button class="stage-icon-button" aria-label="关闭操作指南" @click="showHelp = false"><span class="i-carbon-close" /></button></div>
        <p class="guide-intro">直接拖动和滚动就能操作，不需要先记住六个面的字母。</p>
        <div class="guide-grid">
          <p><strong>01 · 直接转动</strong>按住一个色块横向或纵向拖动，对应的一层会跟着手势转动；松开后自动吸附到 90°。指向一个面滚动鼠标滚轮，也能转动该面。</p>
          <p><strong>02 · 看清各面</strong>魔方上显示各面的名称，指向时会高亮整面。拖动空白处或按住鼠标右键拖动调整视角，在空白处滚动缩放，双击重置视角。</p>
          <p><strong>03 · 挑战一下</strong>随机打乱后，第一次转动开始计时。六面颜色各自统一即完成。撤销可以退回上一步，自动复原会反向演示当前转动记录。</p>
          <p><strong>04 · 按钮与快捷键</strong>展开“按面转动 / 键盘快捷键”，可以用按钮操作。U / D / L / R / F / B 分别对应上、下、左、右、前、后面，按住 Shift 反向转动。</p>
        </div>
        <div class="guide-footer"><button class="guide-confirm" @click="showHelp = false">我知道了</button></div>
      </section>
    </NModal>
    <footer class="workshop-footer"><span>8 个角块，6 种颜色，一点点耐心。</span><span>MADE FOR YOUR NEXT BREAK<span class="footer-spark">✳</span></span></footer>
  </section>
</template>

<style scoped src="./rubiks-cube.css"></style>
