<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
} from 'naive-ui'
import {
  getAiSettings,
  getMissingAiSettingLabels,
  isAiSettingsConfigured,
} from '@/services/ai-settings'
import {
  PROMPT_OPTIMIZATION_MODE_DESCRIPTIONS,
  PROMPT_OPTIMIZATION_MODE_OPTIONS,
  PROMPT_REFERENCE_IMAGE_REQUIREMENTS,
  getPromptReferenceImageLabel,
  optimizePromptWithAi,
  type PromptReferenceImage,
  type PromptOptimizationMode,
} from '@/services/prompt-optimizer'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/services/ai-types'

interface UploadedReferenceImage extends PromptReferenceImage {
  id: string
  sizeBytes: number
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_IMAGE_SIZE_BYTES = 20 * 1024 * 1024

const router = useRouter()
const sourceText = ref('')
const chinesePrompt = ref('')
const englishPrompt = ref('')
const mode = ref<PromptOptimizationMode>('T2VA')
const durationSeconds = ref<number | null>(6)
const fileInput = ref<HTMLInputElement | null>(null)
const referenceImages = ref<UploadedReferenceImage[]>([])
const settings = ref<AiSettings>({ ...DEFAULT_AI_SETTINGS })
const loading = ref(false)
const processingImages = ref(false)
const isDraggingImages = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')
let imageDragDepth = 0

const missingSettingLabels = computed(() => getMissingAiSettingLabels(settings.value))
const imageRequirement = computed(() => PROMPT_REFERENCE_IMAGE_REQUIREMENTS[mode.value])
const imageRequirementMet = computed(
  () =>
    referenceImages.value.length >= imageRequirement.value.min &&
    referenceImages.value.length <= imageRequirement.value.max,
)
const canAddReferenceImages = computed(
  () => !processingImages.value && referenceImages.value.length < imageRequirement.value.max,
)
const imageDropZoneLabel = computed(() => {
  if (processingImages.value) return '正在读取图片…'
  if (referenceImages.value.length >= imageRequirement.value.max) {
    return `已达到 ${mode.value} 模式的图片数量上限`
  }
  return '拖动图片到这里，或点击选择'
})
const canOptimize = computed(
  () =>
    !!sourceText.value.trim() &&
    !loading.value &&
    typeof durationSeconds.value === 'number' &&
    durationSeconds.value > 0 &&
    imageRequirementMet.value,
)
const hasResult = computed(() => !!chinesePrompt.value.trim() || !!englishPrompt.value.trim())
const configSummary = computed(() =>
  isAiSettingsConfigured(settings.value) ? settings.value.model : '模型未配置',
)
const modeDescription = computed(() => PROMPT_OPTIMIZATION_MODE_DESCRIPTIONS[mode.value])
const inputPlaceholder = computed(() => {
  if (mode.value === 'Ref2VA') {
    return '描述目标视频，并逐项写清参考图片、视频、音频中的人物、场景、动作或声音分别要如何使用...'
  }
  if (mode.value === 'I2VA') {
    return '描述首帧中的主体、场景与构图，以及接下来希望发生的动作、镜头和声音...'
  }
  if (mode.value === 'FL2VA') {
    return '描述首帧与尾帧的状态，以及主体、物体、镜头和光线在两帧之间如何连续变化...'
  }
  if (mode.value === 'L2VA') {
    return '描述最终帧画面，以及希望视频从怎样的前置状态逐步收敛到该画面...'
  }
  return '输入视频创意，例如主体、场景、动作、镜头、台词、声音和画面风格...'
})

onMounted(loadSettings)
onActivated(loadSettings)

watch(mode, (nextMode, previousMode) => {
  if (nextMode === previousMode) return
  chinesePrompt.value = ''
  englishPrompt.value = ''
  if (referenceImages.value.length > 0) {
    referenceImages.value = []
    infoMsg.value = '输入模式已切换，请按新模式重新上传对应的参考图片'
  }
})

async function loadSettings() {
  try {
    settings.value = await getAiSettings()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '读取 AI 设置失败'
  }
}

async function optimizePrompt() {
  if (!sourceText.value.trim()) {
    errorMsg.value = '请输入需要优化的视频创意描述'
    return
  }

  if (typeof durationSeconds.value !== 'number' || durationSeconds.value <= 0) {
    errorMsg.value = '请输入有效的视频时长'
    return
  }

  if (!imageRequirementMet.value) {
    errorMsg.value = `${mode.value} 模式${imageRequirement.value.summary}`
    return
  }

  errorMsg.value = ''
  infoMsg.value = ''
  await loadSettings()

  if (missingSettingLabels.value.length > 0) {
    errorMsg.value = `请先在设置页补全：${missingSettingLabels.value.join('、')}`
    return
  }

  loading.value = true
  try {
    const result = await optimizePromptWithAi(sourceText.value, {
      settings: settings.value,
      mode: mode.value,
      durationSeconds: durationSeconds.value,
      referenceImages: referenceImages.value,
    })
    chinesePrompt.value = result.chinesePrompt
    englishPrompt.value = result.englishPrompt
    infoMsg.value = '中英文提示词已按 MiniMax-H3 指南生成'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '提示词优化失败'
  } finally {
    loading.value = false
  }
}

function openImagePicker() {
  if (!canAddReferenceImages.value) return
  fileInput.value?.click()
}

async function handleImageSelection(event: Event) {
  const input = event.target as HTMLInputElement
  const selectedFiles = Array.from(input.files ?? [])
  input.value = ''

  await addReferenceImageFiles(selectedFiles)
}

function handleImageDragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  imageDragDepth += 1
  isDraggingImages.value = true
}

function handleImageDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = canAddReferenceImages.value ? 'copy' : 'none'
  }
}

function handleImageDragLeave(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  imageDragDepth = Math.max(0, imageDragDepth - 1)
  if (imageDragDepth === 0) {
    isDraggingImages.value = false
  }
}

async function handleImageDrop(event: DragEvent) {
  imageDragDepth = 0
  isDraggingImages.value = false
  await addReferenceImageFiles(Array.from(event.dataTransfer?.files ?? []))
}

async function addReferenceImageFiles(selectedFiles: File[]) {
  if (selectedFiles.length === 0 || processingImages.value) return

  errorMsg.value = ''
  infoMsg.value = ''
  const remainingSlots = imageRequirement.value.max - referenceImages.value.length
  if (remainingSlots <= 0) {
    errorMsg.value = `${mode.value} 模式最多上传 ${imageRequirement.value.max} 张图片`
    return
  }
  if (selectedFiles.length > remainingSlots) {
    errorMsg.value = `${mode.value} 模式还可上传 ${remainingSlots} 张图片`
    return
  }

  const unsupportedFile = selectedFiles.find((file) => !SUPPORTED_IMAGE_TYPES.has(file.type))
  if (unsupportedFile) {
    errorMsg.value = `${unsupportedFile.name} 格式不支持，请使用 JPG、PNG 或 WebP`
    return
  }

  const oversizedFile = selectedFiles.find((file) => file.size > MAX_IMAGE_SIZE_BYTES)
  if (oversizedFile) {
    errorMsg.value = `${oversizedFile.name} 超过 5 MB，请压缩后再上传`
    return
  }

  const currentTotalSize = referenceImages.value.reduce(
    (total, image) => total + image.sizeBytes,
    0,
  )
  const selectedTotalSize = selectedFiles.reduce((total, file) => total + file.size, 0)
  if (currentTotalSize + selectedTotalSize > MAX_TOTAL_IMAGE_SIZE_BYTES) {
    errorMsg.value = '参考图片总大小不能超过 20 MB'
    return
  }

  processingImages.value = true
  try {
    const nextImages = await Promise.all(
      selectedFiles.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        dataUrl: await readFileAsDataUrl(file),
        sizeBytes: file.size,
      })),
    )
    referenceImages.value.push(...nextImages)
    chinesePrompt.value = ''
    englishPrompt.value = ''
    infoMsg.value = `已添加 ${nextImages.length} 张参考图片`
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '读取参考图片失败'
  } finally {
    processingImages.value = false
  }
}

function removeReferenceImage(index: number) {
  referenceImages.value.splice(index, 1)
  chinesePrompt.value = ''
  englishPrompt.value = ''
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error(`无法读取图片：${file.name}`))
    }
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`))
    reader.readAsDataURL(file)
  })
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

async function copyText(text: string, label: string) {
  if (!text.trim()) return

  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  infoMsg.value = `${label}已复制`
}

function copyBilingual() {
  const content = [
    '中文提示词',
    chinesePrompt.value,
    '',
    'English Prompt',
    englishPrompt.value,
  ].join('\n')
  return copyText(content, '中英文提示词')
}

function clearAll() {
  sourceText.value = ''
  chinesePrompt.value = ''
  englishPrompt.value = ''
  referenceImages.value = []
  errorMsg.value = ''
  infoMsg.value = ''
}

function openSettings() {
  router.push('/tool/ai-settings')
}
</script>

<template>
  <div class="prompt-optimizer">
    <div class="optimizer-toolbar">
      <div class="toolbar-main-row">
        <NSpace align="center">
          <NText strong>AI 提示词优化</NText>
          <NTag size="small" type="info">{{ configSummary }}</NTag>
        </NSpace>
        <NSpace wrap>
          <NButton size="small" @click="openSettings">AI 设置</NButton>
          <NButton size="small" :disabled="!hasResult" @click="copyBilingual">复制双语</NButton>
          <NButton size="small" @click="clearAll">清空</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="loading"
            :disabled="!canOptimize"
            @click="optimizePrompt"
          >
            优化并生成双语
          </NButton>
        </NSpace>
      </div>
      <NSpace align="center" wrap class="mode-row">
        <div class="control-field">
          <span class="control-label">生成模式</span>
          <NSelect
            v-model:value="mode"
            :options="PROMPT_OPTIMIZATION_MODE_OPTIONS"
            class="mode-select"
          />
        </div>
        <div class="control-field">
          <span class="control-label">目标视频时长</span>
          <NInputNumber
            v-model:value="durationSeconds"
            :min="0.1"
            :max="300"
            :step="0.5"
            class="duration-input"
          >
            <template #suffix>秒</template>
          </NInputNumber>
        </div>
      </NSpace>
      <div class="toolbar-desc">
        模型会按目标秒数安排镜头、动作、台词和声音；复用 AI 翻译的模型配置。
      </div>
    </div>

    <NAlert v-if="missingSettingLabels.length > 0" type="warning" class="status-alert">
      需要先在设置页补全：{{ missingSettingLabels.join('、') }}
    </NAlert>
    <NAlert type="info" class="status-alert">
      {{ modeDescription }}
    </NAlert>
    <NAlert
      v-if="mode !== 'T2VA' && !imageRequirementMet"
      type="warning"
      class="status-alert"
    >
      {{ imageRequirement.summary }}上传后会以图片中的真实内容为准，当前模型需要支持图像理解。
    </NAlert>
    <NAlert
      v-if="errorMsg"
      type="error"
      closable
      class="status-alert"
      @close="errorMsg = ''"
    >
      {{ errorMsg }}
    </NAlert>
    <NAlert
      v-if="infoMsg"
      type="success"
      closable
      class="status-alert"
      @close="infoMsg = ''"
    >
      {{ infoMsg }}
    </NAlert>

    <NCard v-if="mode !== 'T2VA'" size="small" title="参考图片" class="reference-card">
      <template #header-extra>
        <NTag size="small" type="info">需要视觉模型</NTag>
      </template>

      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        :multiple="imageRequirement.max > 1"
        @change="handleImageSelection"
      />

      <div
        class="image-drop-zone"
        :class="{
          'image-drop-zone--active': isDraggingImages && canAddReferenceImages,
          'image-drop-zone--disabled': !canAddReferenceImages,
        }"
        role="button"
        :tabindex="canAddReferenceImages ? 0 : -1"
        :aria-disabled="!canAddReferenceImages"
        @click="openImagePicker"
        @keydown.enter.prevent="openImagePicker"
        @keydown.space.prevent="openImagePicker"
        @dragenter.prevent="handleImageDragEnter"
        @dragover.prevent="handleImageDragOver"
        @dragleave.prevent="handleImageDragLeave"
        @drop.prevent="handleImageDrop"
      >
        <strong>{{ imageDropZoneLabel }}</strong>
        <NText depth="3">
          {{ imageRequirement.summary }}支持 JPG、PNG、WebP，单张不超过 5 MB。
        </NText>
      </div>

      <div v-if="referenceImages.length" class="reference-grid">
        <div v-for="(image, index) in referenceImages" :key="image.id" class="reference-item">
          <img :src="image.dataUrl" :alt="getPromptReferenceImageLabel(mode, index)" />
          <div class="reference-meta">
            <NText strong>{{ getPromptReferenceImageLabel(mode, index) }}</NText>
            <span :title="image.name">{{ image.name }}</span>
            <span>{{ formatFileSize(image.sizeBytes) }}</span>
          </div>
          <NButton size="tiny" tertiary type="error" @click="removeReferenceImage(index)">
            移除
          </NButton>
        </div>
      </div>
      <NEmpty v-else description="尚未上传参考图片" class="reference-empty" />
    </NCard>

    <NCard size="small" title="创意描述" class="source-card">
      <NInput
        v-model:value="sourceText"
        type="textarea"
        :placeholder="inputPlaceholder"
        :autosize="{ minRows: 10, maxRows: 22 }"
      />
    </NCard>

    <div v-if="hasResult" class="result-grid">
      <NCard size="small" title="中文提示词（审阅版）">
        <template #header-extra>
          <NButton size="tiny" @click="copyText(chinesePrompt, '中文提示词')">复制中文</NButton>
        </template>
        <NInput
          v-model:value="chinesePrompt"
          type="textarea"
          :autosize="{ minRows: 18, maxRows: 36 }"
        />
      </NCard>

      <NCard size="small" title="English Prompt（H3 直用版）">
        <template #header-extra>
          <NButton size="tiny" @click="copyText(englishPrompt, '英文提示词')">Copy English</NButton>
        </template>
        <NInput
          v-model:value="englishPrompt"
          type="textarea"
          :autosize="{ minRows: 18, maxRows: 36 }"
        />
      </NCard>
    </div>

    <NCard v-else size="small" class="empty-card">
      <NEmpty description="优化后的中英文提示词会显示在这里" />
    </NCard>
  </div>
</template>

<style scoped>
.prompt-optimizer {
  display: flex;
  flex-direction: column;
}

.optimizer-toolbar {
  padding-bottom: 12px;
}

.toolbar-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
}

.toolbar-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mode-row {
  margin-top: 10px;
}

.control-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-label {
  flex-shrink: 0;
  font-size: 12px;
  color: #6b7280;
}

.mode-select {
  width: 230px;
}

.duration-input {
  width: 130px;
}

.status-alert {
  margin-bottom: 8px;
}

.source-card {
  margin-bottom: 12px;
}

.reference-card {
  margin-bottom: 12px;
}

.file-input {
  display: none;
}

.image-drop-zone {
  display: flex;
  min-height: 92px;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 16px;
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  color: #334155;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.image-drop-zone:not(.image-drop-zone--disabled):hover,
.image-drop-zone:not(.image-drop-zone--disabled):focus-visible,
.image-drop-zone--active {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgb(59 130 246 / 12%);
  outline: none;
}

.image-drop-zone--active {
  border-style: solid;
}

.image-drop-zone--disabled {
  border-color: #e2e8f0;
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
  box-shadow: none;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.reference-item {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.reference-item img {
  width: 88px;
  height: 66px;
  border-radius: 6px;
  object-fit: cover;
  background: #e5e7eb;
}

.reference-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #6b7280;
}

.reference-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-empty {
  padding: 12px 0 4px;
}

.source-card :deep(textarea),
.result-grid :deep(textarea) {
  resize: vertical;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  line-height: 1.65;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.empty-card {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1100px) {
  .toolbar-main-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
