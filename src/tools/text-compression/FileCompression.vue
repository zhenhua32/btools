<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { NAlert, NButton, NCard, NSelect, NText } from 'naive-ui'
import { compressFile, decompressFile, releaseFileResult } from '@/services/text-compression-client'
import {
  DEFAULT_FILE_ALGORITHM, FILE_ALGORITHM_OPTIONS, FILE_DECOMPRESSION_OPTIONS, MAX_ARCHIVE_ENTRIES,
  type FileCompressionAlgorithm, type FileCompressionResult, type FileDecompressionAlgorithm,
} from '@/services/file-compression-types'
import { DEFAULT_ENCODING, ENCODING_OPTIONS, type TextEncoding } from '@/services/text-compression-types'
import {
  DEFAULT_FILE_CONCURRENCY, FILE_CONCURRENCY_OPTIONS, MAX_EXPANDED_BYTES, MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES,
  type FileCompressionConcurrency, type FileOperationProgress, type ProcessedFile, type TextPart,
} from '@/services/file-stream-types'

type Action = 'compress' | 'decompress'
const COPY_ALL_LIMIT = 16 * 1024 ** 2
const PREVIEW_LIMIT = 64 * 1024
const sourceFile = shallowRef<File | null>(null)
const archiveFile = shallowRef<File | null>(null)
const archiveSource = ref<'upload' | 'paste'>('upload')
const pastedArchive = ref('')
const algorithm = ref<FileCompressionAlgorithm>(DEFAULT_FILE_ALGORITHM)
const encoding = ref<TextEncoding>(DEFAULT_ENCODING)
const concurrency = ref<FileCompressionConcurrency>(DEFAULT_FILE_CONCURRENCY)
const decompressionAlgorithm = ref<FileDecompressionAlgorithm>('auto')
const compressedResult = shallowRef<FileCompressionResult | null>(null)
const decompressedResult = shallowRef<FileCompressionResult | null>(null)
const compressing = ref(false)
const decompressing = ref(false)
const compressError = ref('')
const decompressError = ref('')
const compressStatus = ref('')
const decompressStatus = ref('')
const compressProgress = shallowRef<FileOperationProgress | null>(null)
const decompressProgress = shallowRef<FileOperationProgress | null>(null)
const preview = ref('')
const copying = ref(false)
const copyStatus = ref('')
const selectedPart = ref(0)
const numberFormatter = new Intl.NumberFormat('zh-CN')
const revisions: Record<Action, number> = { compress: 0, decompress: 0 }
const controllers: Partial<Record<Action, AbortController>> = {}
let disposed = false
let copyRevision = 0
const compressionOptions = FILE_ALGORITHM_OPTIONS.map((option) => ({ ...option, label: option.label.replace(/（\.[^）]+）/, '') }))

const textOutput = computed(() => compressedResult.value?.textOutput)
const compressedFiles = computed(() => outputFiles(compressedResult.value))
const decompressedFiles = computed(() => outputFiles(decompressedResult.value))
const partOptions = computed(() => (textOutput.value?.parts ?? []).map((part, index) => ({
  value: index, label: `第 ${index + 1} / ${textOutput.value!.parts.length} 段 · ${numberFormatter.format(part.characters)} 字符`,
})))
const pastedBytes = computed(() => new Blob([pastedArchive.value]).size)
const canDecompress = computed(() => archiveSource.value === 'paste'
  ? pastedArchive.value.length > 0 && pastedBytes.value <= COPY_ALL_LIMIT
  : !!archiveFile.value && archiveFile.value.size <= MAX_TEXT_ARCHIVE_BYTES)

function releaseResult(result: FileCompressionResult | null) {
  if (result) void releaseFileResult(result).catch(() => {})
}

function invalidate(action: Action) {
  revisions[action] += 1
  controllers[action]?.abort()
  delete controllers[action]
  const resultRef = action === 'compress' ? compressedResult : decompressedResult
  releaseResult(resultRef.value)
  resultRef.value = null
  if (action === 'compress') {
    compressing.value = false
    compressError.value = ''
    compressStatus.value = ''
    compressProgress.value = null
    preview.value = ''
    selectedPart.value = 0
    copyRevision += 1
    copying.value = false
    copyStatus.value = ''
  } else {
    decompressing.value = false
    decompressError.value = ''
    decompressStatus.value = ''
    decompressProgress.value = null
  }
}

watch([sourceFile, algorithm, encoding, concurrency], () => invalidate('compress'), { flush: 'sync' })
watch([archiveFile, archiveSource, pastedArchive, decompressionAlgorithm], () => invalidate('decompress'), { flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  invalidate('compress')
  invalidate('decompress')
  // Existing download URLs retain their full grace period, even when this view closes.
})

function outputFiles(result: FileCompressionResult | null): ProcessedFile[] {
  if (!result) return []
  if (result.outputs) return result.outputs
  return result.files.map((file) => ({
    name: file.name, type: file.type || 'application/octet-stream',
    blob: new Blob([new Uint8Array(file.bytes).buffer], { type: file.type || 'application/octet-stream' }),
  }))
}

function formatBytes(bytes: number): string {
  const exact = `${numberFormatter.format(bytes)} 字节`
  if (bytes < 1024) return exact
  const unit = bytes >= 1024 ** 3 ? 'GiB' : bytes >= 1024 ** 2 ? 'MiB' : 'KiB'
  const divisor = bytes >= 1024 ** 3 ? 1024 ** 3 : bytes >= 1024 ** 2 ? 1024 ** 2 : 1024
  return `${(bytes / divisor).toFixed(2)} ${unit}（${exact}）`
}
function formatRatio(ratio: number | null): string {
  return ratio === null ? '无法计算（原文件为空）' : `${(ratio * 100).toFixed(1)}%`
}
function describeRatio(ratio: number | null): string {
  if (ratio === null) return ''
  if (ratio < 1) return `减少 ${((1 - ratio) * 100).toFixed(1)}%`
  if (ratio > 1) return `膨胀 ${((ratio - 1) * 100).toFixed(1)}%`
  return '大小相同'
}
function algorithmLabel(value: FileCompressionAlgorithm): string {
  return FILE_ALGORITHM_OPTIONS.find((option) => option.value === value)?.label ?? value
}
function encodingLabel(value: TextEncoding): string {
  return ENCODING_OPTIONS.find((option) => option.value === value)?.label ?? value
}
function progressPercent(progress: FileOperationProgress): number {
  return progress.total === 0 ? 0 : Math.min(100, Math.max(0, progress.completed / progress.total * 100))
}

function chooseFile(event: Event, action: Action) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  invalidate(action)
  const fileRef = action === 'compress' ? sourceFile : archiveFile
  const errorRef = action === 'compress' ? compressError : decompressError
  const limit = action === 'compress' ? MAX_UPLOAD_BYTES : MAX_TEXT_ARCHIVE_BYTES
  fileRef.value = file
  errorRef.value = file.size > limit ? `文件超过大小限制，最多支持 ${formatBytes(limit)}。` : ''
}

function readBlob(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function loadPreview(result: FileCompressionResult, revision: number) {
  const output = result.textOutput
  if (!output) return
  const text = await readBlob(output.blob.slice(0, PREVIEW_LIMIT))
  if (!disposed && revisions.compress === revision && compressedResult.value === result) preview.value = text
}

async function processFile(action: Action) {
  const pendingRef = action === 'compress' ? compressing : decompressing
  if (pendingRef.value) return
  const errorRef = action === 'compress' ? compressError : decompressError
  const statusRef = action === 'compress' ? compressStatus : decompressStatus
  const resultRef = action === 'compress' ? compressedResult : decompressedResult
  let file = action === 'compress' ? sourceFile.value : archiveFile.value
  if (action === 'decompress' && archiveSource.value === 'paste') {
    if (!pastedArchive.value) return
    if (pastedBytes.value > COPY_ALL_LIMIT) {
      errorRef.value = '粘贴文本超过 16 MiB，请上传完整的压缩文本 .txt 文件。'
      return
    }
    file = new File([pastedArchive.value], 'pasted.btf2.txt', { type: 'text/plain;charset=utf-8' })
  }
  if (!file) return
  const limit = action === 'compress' ? MAX_UPLOAD_BYTES : MAX_TEXT_ARCHIVE_BYTES
  if (file.size > limit) {
    errorRef.value = `文件超过大小限制，最多支持 ${formatBytes(limit)}。`
    return
  }
  invalidate(action)
  const revision = revisions[action]
  const controller = new AbortController()
  controllers[action] = controller
  const isCurrent = () => !disposed && !controller.signal.aborted && revision === revisions[action]
  const progressRef = action === 'compress' ? compressProgress : decompressProgress
  pendingRef.value = true
  const options = {
    signal: controller.signal,
    onProgress: (progress: FileOperationProgress) => { if (isCurrent()) progressRef.value = progress },
  }
  try {
    const nextResult = action === 'compress'
      ? await compressFile(file, algorithm.value, { ...options, encoding: encoding.value, concurrency: concurrency.value })
      : await decompressFile(file, archiveSource.value === 'paste' ? 'auto' : decompressionAlgorithm.value, options)
    if (!isCurrent()) {
      releaseResult(nextResult)
      return
    }
    resultRef.value = nextResult
    statusRef.value = action === 'compress'
      ? '压缩完成，可复制纯文本或下载完整文本。'
      : `解压完成，共 ${outputFiles(nextResult).length} 个文件，可分别下载。`
    if (action === 'compress') {
      void loadPreview(nextResult, revision).catch(() => {
        if (isCurrent()) copyStatus.value = '预览加载失败，仍可下载完整文本。'
      })
    }
  } catch (error) {
    if (!isCurrent()) return
    errorRef.value = error instanceof Error ? error.message : `${action === 'compress' ? '压缩' : '解压'}失败，请重试。`
  } finally {
    if (controllers[action] === controller) {
      delete controllers[action]
      pendingRef.value = false
    }
  }
}

function cancel(action: Action) {
  invalidate(action)
  const statusRef = action === 'compress' ? compressStatus : decompressStatus
  statusRef.value = '已取消。'
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const previousFocus = document.activeElement as HTMLElement | null
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      if (!document.execCommand('copy')) throw new Error('copy failed')
    } finally {
      textarea.remove()
      previousFocus?.focus()
    }
  }
}

async function copyOutput(part?: TextPart) {
  const result = compressedResult.value
  const output = result?.textOutput
  if (!output || copying.value || (!part && output.blob.size > COPY_ALL_LIMIT)) return
  const revision = revisions.compress
  const currentCopy = ++copyRevision
  copying.value = true
  copyStatus.value = ''
  const partIndex = part ? output.parts.indexOf(part) : -1
  try {
    const text = await readBlob(part ? output.blob.slice(part.offset, part.offset + part.size) : output.blob)
    if (disposed || revision !== revisions.compress) return
    await writeClipboard(text)
    if (!disposed && revision === revisions.compress) copyStatus.value = part
      ? `第 ${partIndex + 1} / ${output.parts.length} 段已复制，请按顺序拼接各段，不添加分隔字符。`
      : '完整压缩文本已复制。'
  } catch {
    if (!disposed && revision === revisions.compress) copyStatus.value = '复制失败，请下载完整文本后复制，或尝试按段复制。'
  } finally {
    if (currentCopy === copyRevision) copying.value = false
  }
}

function downloadFile(file: ProcessedFile, action: Action) {
  const errorRef = action === 'compress' ? compressError : decompressError
  errorRef.value = ''
  let url: string | undefined
  try {
    url = URL.createObjectURL(file.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.appendChild(anchor)
    try { anchor.click() } finally { anchor.remove() }
    const downloadUrl = url
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000)
  } catch {
    if (url) URL.revokeObjectURL(url)
    errorRef.value = '下载失败，请重试。'
  }
}
</script>

<template>
  <div class="file-compression">
    <div>
      <NText strong class="file-title">文件压缩 / 解压</NText>
      <p class="file-description">将任意文件无损压缩为可复制的纯文本，粘贴文本或上传文件即可还原。全部在浏览器本地处理，原文件最大 1 GiB。</p>
    </div>
    <div class="file-panels">
      <NCard size="small" class="file-panel">
        <template #header>文件 → 压缩文本</template>
        <label class="file-upload"><span>选择原始文件</span>
          <input type="file" aria-label="选择原始文件" @change="chooseFile($event, 'compress')" />
        </label>
        <p class="file-hint">支持文本、图片、PDF 等任意文件，最大 {{ formatBytes(MAX_UPLOAD_BYTES) }}。大文件分块处理，请预留足够的本地磁盘空间。</p>
        <div v-if="sourceFile" class="file-selection" data-testid="source-file-info"><strong>{{ sourceFile.name }}</strong><span>{{ formatBytes(sourceFile.size) }}</span></div>
        <div class="file-options">
          <label class="file-select"><span>压缩算法</span><NSelect v-model:value="algorithm" :options="compressionOptions" aria-label="文件压缩算法" /></label>
          <label class="file-select"><span>文本编码</span><NSelect v-model:value="encoding" :options="ENCODING_OPTIONS" aria-label="文件文本编码" /></label>
          <label class="file-select"><span>压缩并发</span><NSelect v-model:value="concurrency" :options="FILE_CONCURRENCY_OPTIONS" aria-label="文件压缩并发" /></label>
        </div>
        <p class="file-hint">多并发可加快分块压缩；更高并发会增加 CPU 和内存占用，速度取决于设备与算法。各并发使用相同纯文本格式和压缩参数。</p>
        <div class="file-actions">
          <NButton type="primary" :loading="compressing" :disabled="compressing || !sourceFile || sourceFile.size > MAX_UPLOAD_BYTES" @click="processFile('compress')">压缩文件</NButton>
          <NButton v-if="compressing" @click="cancel('compress')">取消压缩</NButton>
        </div>
        <NAlert v-if="compressError" type="error" class="file-alert">{{ compressError }}</NAlert>
        <div class="file-status" role="status" aria-live="polite">{{ compressing ? '正在压缩，大文件和高压缩等级可能需要较长时间…' : compressStatus }}</div>
        <div v-if="compressing && compressProgress" class="file-progress" data-testid="compress-progress">
          <progress :value="progressPercent(compressProgress)" max="100" aria-label="压缩进度" />
          <span>已处理 {{ formatBytes(compressProgress.completed) }} / {{ formatBytes(compressProgress.total) }}</span>
        </div>
        <div v-if="compressedResult" class="file-result" data-testid="file-compress-result">
          <strong>{{ algorithmLabel(compressedResult.algorithm) }}<template v-if="textOutput"> + {{ encodingLabel(textOutput.encoding) }}</template></strong>
          <div>原文件大小：{{ formatBytes(compressedResult.originalBytes) }}</div>
          <div>压缩文本 UTF-8 大小：{{ formatBytes(textOutput?.blob.size ?? compressedResult.compressedBytes) }}</div>
          <div v-if="textOutput">压缩文本字符数：{{ numberFormatter.format(textOutput.characters) }} 字符</div>
          <div>字节压缩率：<strong>{{ formatRatio(compressedResult.byteRatio) }}</strong> {{ describeRatio(compressedResult.byteRatio) }}</div>
          <template v-if="textOutput">
            <label class="file-upload"><span>压缩文本预览<span v-if="textOutput.blob.size > PREVIEW_LIMIT">（仅前 64 KiB，请使用复制或下载获取完整内容）</span></span>
              <textarea :value="preview" readonly rows="6" aria-label="文件压缩文本预览" class="file-textarea" spellcheck="false" />
            </label>
            <div class="file-actions">
              <NButton size="small" :disabled="copying || textOutput.blob.size > COPY_ALL_LIMIT" @click="copyOutput()">复制完整文本</NButton>
              <NButton size="small" @click="downloadFile(textOutput, 'compress')">下载完整文本 .txt</NButton>
            </div>
            <div v-if="textOutput.parts.length" class="file-parts">
              <NSelect v-model:value="selectedPart" :options="partOptions" aria-label="复制文本分段" />
              <NButton size="small" :disabled="copying" @click="copyOutput(textOutput.parts[selectedPart])">复制所选段</NButton>
            </div>
            <p class="file-hint">超过 16 MiB 的文本请按段复制，依次拼接全部 {{ textOutput.parts.length }} 段，不添加空格、换行或其他分隔字符；也可直接下载完整 .txt。预览仅供查看，复制按钮会保留原始字符。</p>
            <div class="file-status" role="status" aria-live="polite">{{ copyStatus }}</div>
          </template>
          <template v-else>
            <div v-for="(file, index) in compressedFiles" :key="index" class="file-output"><span>{{ file.name }}</span><NButton size="small" @click="downloadFile(file, 'compress')">下载压缩文件</NButton></div>
          </template>
        </div>
      </NCard>
      <NCard size="small" class="file-panel">
        <template #header>压缩文本 / 文件 → 原文件</template>
        <div class="file-actions file-source-choice">
          <NButton size="small" :type="archiveSource === 'upload' ? 'primary' : 'default'" :aria-pressed="archiveSource === 'upload'" @click="archiveSource = 'upload'">上传压缩文件</NButton>
          <NButton size="small" :type="archiveSource === 'paste' ? 'primary' : 'default'" :aria-pressed="archiveSource === 'paste'" @click="archiveSource = 'paste'">粘贴压缩文本</NButton>
        </div>
        <template v-if="archiveSource === 'upload'">
          <label class="file-upload"><span>选择压缩文件</span><input type="file" aria-label="选择压缩文件" @change="chooseFile($event, 'decompress')" /></label>
          <p class="file-hint">上传本工具生成的完整 .txt，也支持标准 gzip、Zstd、LZMA、ZIP、Brotli 和 DEFLATE。压缩文本文件最大 {{ formatBytes(MAX_TEXT_ARCHIVE_BYTES) }}，解压后累计最大 {{ formatBytes(MAX_EXPANDED_BYTES) }}，ZIP 最多 {{ MAX_ARCHIVE_ENTRIES }} 个条目。</p>
          <div v-if="archiveFile" class="file-selection" data-testid="archive-file-info"><strong>{{ archiveFile.name }}</strong><span>{{ formatBytes(archiveFile.size) }}</span></div>
          <label class="file-select"><span>解压格式</span><NSelect v-model:value="decompressionAlgorithm" :options="FILE_DECOMPRESSION_OPTIONS" aria-label="文件解压格式" /></label>
        </template>
        <template v-else>
          <label class="file-upload"><span>完整文件压缩文本</span><textarea v-model="pastedArchive" aria-label="粘贴文件压缩文本" class="file-textarea" rows="10" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="粘贴本工具生成的完整 BTF2 压缩文本，自动识别算法和编码…" /></label>
          <p class="file-hint">粘贴支持最多 16 MiB；更大的压缩文本请上传 .txt 文件。分段复制时，先按顺序拼接全部段落且不添加分隔字符。</p>
          <NAlert v-if="pastedBytes > COPY_ALL_LIMIT" type="error" class="file-alert">粘贴文本超过 16 MiB，请上传完整的压缩文本 .txt 文件。</NAlert>
        </template>
        <div class="file-actions">
          <NButton type="info" :loading="decompressing" :disabled="decompressing || !canDecompress" @click="processFile('decompress')">解压文件</NButton>
          <NButton v-if="decompressing" @click="cancel('decompress')">取消解压</NButton>
        </div>
        <NAlert v-if="decompressError" type="error" class="file-alert">{{ decompressError }}</NAlert>
        <div class="file-status" role="status" aria-live="polite">{{ decompressing ? '正在解压…' : decompressStatus }}</div>
        <div v-if="decompressing && decompressProgress" class="file-progress" data-testid="decompress-progress">
          <progress :value="progressPercent(decompressProgress)" max="100" aria-label="解压进度" />
          <span>已处理 {{ formatBytes(decompressProgress.completed) }} / {{ formatBytes(decompressProgress.total) }}</span>
        </div>
        <div v-if="decompressedResult" class="file-result" data-testid="file-decompress-result">
          <strong>{{ algorithmLabel(decompressedResult.algorithm) }}</strong>
          <div>压缩输入大小：{{ formatBytes(decompressedResult.compressedBytes) }}</div>
          <div>还原文件大小：{{ formatBytes(decompressedResult.originalBytes) }}</div>
          <div>字节压缩率：<strong>{{ formatRatio(decompressedResult.byteRatio) }}</strong> {{ describeRatio(decompressedResult.byteRatio) }}</div>
          <div v-for="(file, index) in decompressedFiles" :key="index" class="file-output"><span>{{ file.name }} · {{ formatBytes(file.blob.size) }}</span><NButton size="small" @click="downloadFile(file, 'decompress')">下载 {{ file.name }}</NButton></div>
        </div>
      </NCard>
    </div>
    <p class="file-hint">压缩率 = 完整压缩文本 UTF-8 字节数 / 原文件字节数（标准压缩文件按压缩文件大小计算），包含格式标识。原文件可能是二进制，因此仅统计压缩文本字符数，不计算文件字符压缩率。空文件无法计算压缩率，图片、视频或已压缩文件可能变大。</p>
  </div>
</template>

<style scoped>
.file-compression { display: flex; flex-direction: column; gap: 12px; }
.file-title { font-size: 18px; }
.file-description, .file-hint, .file-status { color: var(--text-secondary, #6b7280); font-size: 12px; line-height: 1.7; }
.file-description { margin-top: 4px; }
.file-panels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.file-panel { min-width: 0; }
.file-upload, .file-select { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.file-upload input { display: block; max-width: 100%; font: inherit; }
.file-select { min-width: 0; max-width: 300px; margin: 16px 0 12px; }
.file-options { display: flex; flex-wrap: wrap; gap: 12px; }
.file-options .file-select { flex: 1; min-width: 160px; }
.file-selection { display: flex; flex-direction: column; gap: 4px; border-radius: 6px; padding: 10px; background: var(--bg-secondary, rgba(128, 128, 128, 0.08)); font-size: 12px; overflow-wrap: anywhere; }
.file-selection span { color: var(--text-secondary, #6b7280); }
.file-alert { margin-top: 12px; }
.file-status { min-height: 20px; margin-top: 10px; }
.file-result { display: flex; flex-direction: column; gap: 8px; font-size: 12px; margin-top: 12px; font-variant-numeric: tabular-nums; }
.file-output { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid rgba(128, 128, 128, 0.2); padding-top: 10px; }
.file-output span { overflow-wrap: anywhere; min-width: 0; flex: 1; }
.file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.file-source-choice { margin-bottom: 16px; }
.file-textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; border: 1px solid rgba(128, 128, 128, 0.4); border-radius: 4px; padding: 8px; background: transparent; color: inherit; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.file-parts { display: flex; align-items: center; gap: 8px; }
.file-parts > :first-child { flex: 1; min-width: 0; }
.file-progress { display: flex; flex-direction: column; gap: 4px; font-size: 12px; overflow-wrap: anywhere; }
.file-progress progress { width: 100%; }
@media (max-width: 900px) { .file-panels { grid-template-columns: minmax(0, 1fr); } }
</style>
