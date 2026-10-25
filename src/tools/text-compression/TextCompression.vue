<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NInput, NSelect, NSpace, NText } from 'naive-ui'
import FileCompression from './FileCompression.vue'
import { ALGORITHM_GUIDANCE, renderAlgorithmLabel } from './algorithm-guidance'
import { compressText, decompressText } from '@/services/text-compression-client'
import {
  ALGORITHM_OPTIONS,
  DEFAULT_ALGORITHM,
  DEFAULT_ENCODING,
  ENCODING_OPTIONS,
  getTextMetrics,
  type CompressionAlgorithm,
  type CompressionResult,
  type TextEncoding,
} from '@/services/text-compression-types'

const compressionMode = ref<'text' | 'file'>('text')
const fileModeOpened = ref(false)
watch(compressionMode, (mode) => {
  if (mode === 'file') fileModeOpened.value = true
}, { flush: 'sync' })
const originalText = ref('')
const compressedText = ref('')
const algorithm = ref<CompressionAlgorithm>(DEFAULT_ALGORITHM)
const encoding = ref<TextEncoding>(DEFAULT_ENCODING)
const pendingAction = ref<'compress' | 'decompress' | null>(null)
const result = ref<CompressionResult | null>(null)
const errorMessage = ref('')
const statusMessage = ref('')
const copyMessage = ref('')
const copyFailed = ref(false)
const busy = computed(() => pendingAction.value !== null)
const originalMetrics = computed(() => getTextMetrics(originalText.value))
const compressedMetrics = computed(() => getTextMetrics(compressedText.value))
const numberFormatter = new Intl.NumberFormat('zh-CN')
let inputRevision = 0
let disposed = false

// An edit invalidates the displayed ratios and any in-flight result immediately.
watch([originalText, compressedText, algorithm, encoding], () => {
  inputRevision += 1
  result.value = null
  errorMessage.value = ''
  statusMessage.value = ''
  copyMessage.value = ''
}, { flush: 'sync' })

onBeforeUnmount(() => {
  disposed = true
})

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatRatio(value: number | null): string {
  return value === null ? '无法计算（原文为空）' : `${(value * 100).toFixed(1)}%`
}

function describeRatio(value: number | null): string {
  if (value === null) return ''
  if (value < 1) return `减少 ${((1 - value) * 100).toFixed(1)}%`
  if (value > 1) return `膨胀 ${((value - 1) * 100).toFixed(1)}%`
  return '大小相同'
}

function optionLabel(options: ReadonlyArray<{ label: string; value: string }>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

async function processText(action: 'compress' | 'decompress') {
  if (busy.value) return
  if (action === 'compress' && originalText.value.length === 0) return
  if (action === 'decompress' && compressedText.value.length === 0) return

  const revision = inputRevision
  const source = action === 'compress' ? originalText.value : compressedText.value
  const selectedAlgorithm = algorithm.value
  const selectedEncoding = encoding.value
  pendingAction.value = action
  errorMessage.value = ''
  statusMessage.value = ''
  copyMessage.value = ''
  result.value = null

  try {
    const nextResult = action === 'compress'
      ? await compressText(source, selectedAlgorithm, selectedEncoding)
      : await decompressText(source)
    if (disposed) return
    if (revision !== inputRevision) {
      statusMessage.value = '输入已修改，请重新操作。'
      return
    }

    if (action === 'compress') {
      compressedText.value = nextResult.text
    } else {
      originalText.value = nextResult.text
      algorithm.value = nextResult.algorithm
      encoding.value = nextResult.encoding
    }
    // Include every visible character, including the format prefix or pasted whitespace.
    const original = getTextMetrics(originalText.value)
    const compressed = getTextMetrics(compressedText.value)
    result.value = {
      ...nextResult,
      original,
      compressed,
      characterRatio: original.characters === 0 ? null : compressed.characters / original.characters,
      byteRatio: original.utf8Bytes === 0 ? null : compressed.utf8Bytes / original.utf8Bytes,
    }
    statusMessage.value = action === 'compress' ? '压缩完成，可复制右侧文本。' : '解压完成，原文已还原至左侧。'
  } catch (error) {
    if (disposed) return
    if (revision !== inputRevision) {
      statusMessage.value = '输入已修改，请重新操作。'
      return
    }
    errorMessage.value = error instanceof Error ? error.message : `${action === 'compress' ? '压缩' : '解压'}失败，请重试。`
  } finally {
    if (!disposed) pendingAction.value = null
  }
}

async function copyText(side: 'original' | 'compressed') {
  const text = side === 'original' ? originalText.value : compressedText.value
  if (text.length === 0) return
  copyMessage.value = ''
  copyFailed.value = false
  try {
    await navigator.clipboard.writeText(text)
    if (!disposed) copyMessage.value = `${side === 'original' ? '原文' : '压缩文本'}已复制。`
  } catch {
    const previousFocus = document.activeElement as HTMLElement | null
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    } finally {
      textarea.remove()
      previousFocus?.focus()
    }
    if (disposed) return
    copyFailed.value = !copied
    copyMessage.value = copied
      ? `${side === 'original' ? '原文' : '压缩文本'}已复制。`
      : '复制失败，请选中文本后手动复制。'
  }
}

function clearAll() {
  if (busy.value) return
  originalText.value = ''
  compressedText.value = ''
  result.value = null
  errorMessage.value = ''
  statusMessage.value = ''
  copyMessage.value = ''
}
</script>

<template>
  <div class="compression-tool">
    <NSpace class="compression-mode" aria-label="压缩模式">
      <NButton :type="compressionMode === 'text' ? 'primary' : 'default'" :aria-pressed="compressionMode === 'text'" @click="compressionMode = 'text'">文本</NButton>
      <NButton :type="compressionMode === 'file' ? 'primary' : 'default'" :aria-pressed="compressionMode === 'file'" @click="compressionMode = 'file'">文件</NButton>
    </NSpace>
  <div v-show="compressionMode === 'text'" class="text-compression">
    <div class="compression-header">
      <NText strong class="compression-title">文本压缩</NText>
      <p class="compression-description">将文本无损压缩为可复制的文本，粘贴压缩文本即可自动识别格式并解压。所有处理均在本地完成。</p>
    </div>

    <div class="compression-toolbar">
      <label class="compression-select">
        <span>压缩算法</span>
        <NSelect v-model:value="algorithm" :options="ALGORITHM_OPTIONS" :render-label="renderAlgorithmLabel" :consistent-menu-width="false" :disabled="busy" aria-label="压缩算法" aria-describedby="text-algorithm-guidance" />
      </label>
      <label class="compression-select">
        <span>文本编码</span>
        <NSelect v-model:value="encoding" :options="ENCODING_OPTIONS" :disabled="busy" aria-label="文本编码" />
      </label>
      <NSpace align="center" class="compression-actions">
        <NButton type="primary" :loading="pendingAction === 'compress'" :disabled="busy || originalText.length === 0" @click="processText('compress')">压缩 →</NButton>
        <NButton type="info" :loading="pendingAction === 'decompress'" :disabled="busy || compressedText.length === 0" @click="processText('decompress')">← 解压</NButton>
        <NButton :disabled="busy || (originalText.length === 0 && compressedText.length === 0)" @click="clearAll">清空</NButton>
      </NSpace>
    </div>

    <p id="text-algorithm-guidance" class="compression-hint" aria-live="polite">选用建议：{{ ALGORITHM_GUIDANCE[algorithm].description }}</p>
    <p class="compression-hint">Base32768 / Base65536 可减少字符数，Base64url 适合链接或仅支持 ASCII 的渠道。字符更少不一定代表 UTF-8 字节更少；短文本压缩后可能膨胀。</p>

    <NAlert v-if="errorMessage" type="error" closable class="compression-alert" @close="errorMessage = ''">{{ errorMessage }}</NAlert>
    <div class="compression-feedback" role="status" aria-live="polite">
      <span v-if="busy">{{ pendingAction === 'compress' ? '正在压缩，高压缩等级可能需要一些时间…' : '正在解压…' }}</span>
      <span v-else-if="statusMessage">{{ statusMessage }}</span>
      <span v-if="copyMessage" :class="{ 'compression-copy-error': copyFailed }">{{ copyMessage }}</span>
    </div>

    <div class="compression-panels">
      <NCard size="small" class="compression-panel">
        <template #header>原文</template>
        <template #header-extra>
          <NButton size="small" :disabled="originalText.length === 0" @click="copyText('original')">复制原文</NButton>
        </template>
        <NInput v-model:value="originalText" type="textarea" :input-props="{ 'aria-label': '原文', spellcheck: false }" placeholder="在此输入原文，点击“压缩 →”生成可复制的压缩文本…" :rows="18" class="compression-input" />
        <div class="compression-metrics" data-testid="original-metrics">{{ formatNumber(originalMetrics.characters) }} 字符 · {{ formatNumber(originalMetrics.utf8Bytes) }} UTF-8 字节</div>
      </NCard>
      <NCard size="small" class="compression-panel">
        <template #header>压缩文本</template>
        <template #header-extra>
          <NButton size="small" :disabled="compressedText.length === 0" @click="copyText('compressed')">复制压缩文本</NButton>
        </template>
        <NInput v-model:value="compressedText" type="textarea" :input-props="{ 'aria-label': '压缩文本', spellcheck: false, autocapitalize: 'off', autocorrect: 'off' }" placeholder="压缩结果显示在这里，也可直接粘贴本工具生成的文本，点击“← 解压”还原…" :rows="18" class="compression-input" />
        <div class="compression-metrics" data-testid="compressed-metrics">{{ formatNumber(compressedMetrics.characters) }} 字符 · {{ formatNumber(compressedMetrics.utf8Bytes) }} UTF-8 字节</div>
      </NCard>
    </div>

    <NCard v-if="result" size="small" class="compression-result" data-testid="compression-result">
      <div class="compression-result-title">{{ optionLabel(ALGORITHM_OPTIONS, result.algorithm) }} + {{ optionLabel(ENCODING_OPTIONS, result.encoding) }}</div>
      <div class="compression-ratios">
        <div><span>字符压缩率</span><strong>{{ formatRatio(result.characterRatio) }}</strong><span>{{ describeRatio(result.characterRatio) }}</span></div>
        <div><span>UTF-8 字节压缩率</span><strong>{{ formatRatio(result.byteRatio) }}</strong><span>{{ describeRatio(result.byteRatio) }}</span></div>
      </div>
      <p class="compression-hint">压缩率 = 压缩文本 / 原文，包含完整格式标识；小于 100% 表示更小。字符数按 Unicode 码点统计。</p>
    </NCard>
  </div>
    <FileCompression v-show="compressionMode === 'file'" v-if="fileModeOpened" />
  </div>
</template>

<style scoped>
.compression-tool { display: flex; flex-direction: column; gap: 16px; }
.text-compression { display: flex; flex-direction: column; gap: 12px; min-height: 100%; }
.compression-title { font-size: 18px; }
.compression-description, .compression-hint, .compression-metrics { color: var(--text-secondary, #6b7280); font-size: 12px; line-height: 1.7; }
.compression-description { margin-top: 4px; }
.compression-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.compression-select { display: flex; flex-direction: column; gap: 5px; width: 200px; font-size: 12px; color: var(--text-secondary, #6b7280); }
.compression-actions { padding-bottom: 1px; }
.compression-feedback { display: flex; flex-wrap: wrap; gap: 12px; min-height: 20px; font-size: 12px; color: var(--text-secondary, #6b7280); }
.compression-copy-error { color: #d03050; }
.compression-panels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.compression-panel { min-width: 0; }
.compression-input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.compression-metrics { margin-top: 8px; font-variant-numeric: tabular-nums; }
.compression-result-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.compression-ratios { display: flex; flex-wrap: wrap; gap: 16px 36px; margin-bottom: 8px; }
.compression-ratios > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 12px; }
.compression-ratios strong { font-size: 20px; font-variant-numeric: tabular-nums; }
.compression-ratios span { color: var(--text-secondary, #6b7280); }
@media (max-width: 900px) {
  .compression-panels { grid-template-columns: minmax(0, 1fr); }
  .compression-select { flex: 1; min-width: 150px; }
  .compression-actions { width: 100%; }
}
</style>
