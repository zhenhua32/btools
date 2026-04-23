<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
} from 'naive-ui'
import { requestAiChatCompletion } from '@/services/ai-client'
import {
  getAiSettings,
  getMissingAiSettingLabels,
  isAiSettingsConfigured,
} from '@/services/ai-settings'
import {
  DISPLAY_MODE_OPTIONS,
  TRANSLATION_STRATEGY_OPTIONS,
  DEFAULT_AI_SETTINGS,
  type AiChatMessage,
  type AiDisplayMode,
  type AiSettings,
  type TranslationStrategy,
} from '@/services/ai-types'

const router = useRouter()

const sourceText = ref('')
const translatedText = ref('')
const translatedParagraphs = ref<string[]>([])
const displayMode = ref<AiDisplayMode>(DEFAULT_AI_SETTINGS.defaultDisplayMode)
const translationStrategy = ref<TranslationStrategy>(
  DEFAULT_AI_SETTINGS.defaultTranslationStrategy,
)
const cachedSettings = ref<AiSettings>({ ...DEFAULT_AI_SETTINGS })
const errorMsg = ref('')
const infoMsg = ref('')
const loading = ref(false)
const hasInitializedDefaults = ref(false)

onMounted(() => loadSettingsSnapshot(true))
onActivated(() => loadSettingsSnapshot(false))

const canTranslate = computed(() => !!sourceText.value.trim() && !loading.value)
const canCopyResult = computed(() => !!resultText.value.trim())
const missingSettingLabels = computed(() => getMissingAiSettingLabels(cachedSettings.value))
const sourceParagraphs = computed(() => splitParagraphs(sourceText.value))
const resultParagraphs = computed(() => {
  if (translatedParagraphs.value.length > 0) {
    return translatedParagraphs.value
  }

  return splitParagraphs(translatedText.value)
})
const paragraphRows = computed(() => {
  const total = Math.max(sourceParagraphs.value.length, resultParagraphs.value.length)
  return Array.from({ length: total }, (_, index) => ({
    original: sourceParagraphs.value[index] || '',
    translated: resultParagraphs.value[index] || '',
  }))
})
const resultText = computed(() => {
  if (translatedText.value.trim()) {
    return translatedText.value
  }

  return translatedParagraphs.value.join('\n\n')
})
const flowingParagraphs = computed(() => {
  if (resultParagraphs.value.length > 0) {
    return resultParagraphs.value
  }

  return resultText.value.trim() ? [resultText.value.trim()] : []
})
const configSummary = computed(() => {
  if (!isAiSettingsConfigured(cachedSettings.value)) {
    return '模型未配置'
  }

  return `${cachedSettings.value.model} · ${cachedSettings.value.defaultTargetLanguage}`
})

async function loadSettingsSnapshot(applyDefaults: boolean) {
  try {
    cachedSettings.value = await getAiSettings()

    if (applyDefaults || (!hasInitializedDefaults.value && !sourceText.value.trim() && !translatedText.value.trim())) {
      displayMode.value = cachedSettings.value.defaultDisplayMode
      translationStrategy.value = cachedSettings.value.defaultTranslationStrategy
      hasInitializedDefaults.value = true
    }
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '读取设置失败'
  }
}

async function translateText() {
  if (!sourceText.value.trim()) {
    errorMsg.value = '请输入待翻译内容'
    return
  }

  errorMsg.value = ''
  infoMsg.value = ''

  await loadSettingsSnapshot(false)

  if (missingSettingLabels.value.length > 0) {
    errorMsg.value = `请先在设置页补全：${missingSettingLabels.value.join('、')}`
    return
  }

  loading.value = true

  try {
    if (translationStrategy.value === 'paragraph-by-paragraph') {
      await translateByParagraphs(sourceText.value)
    } else {
      await translateWholeDocument(sourceText.value)
    }
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '翻译失败'
  } finally {
    loading.value = false
    infoMsg.value = ''
  }
}

async function translateWholeDocument(text: string) {
  infoMsg.value = '正在整块翻译，请稍候...'
  const cleaned = await requestTranslatedContent(text, false)

  translatedText.value = cleaned
  translatedParagraphs.value = splitParagraphs(translatedText.value)
}

async function translateByParagraphs(text: string) {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) {
    throw new Error('未识别到可翻译的段落')
  }

  const results: string[] = []

  for (let i = 0; i < paragraphs.length; i++) {
    infoMsg.value = `正在翻译第 ${i + 1} / ${paragraphs.length} 段...`
    results.push(await requestTranslatedContent(paragraphs[i], true))
  }

  translatedParagraphs.value = results
  translatedText.value = results.join('\n\n')
}

async function requestTranslatedContent(text: string, singleParagraph: boolean): Promise<string> {
  const firstPass = await requestAiChatCompletion(buildMessages(text, singleParagraph), {
    temperature: 0.2,
    timeoutMs: singleParagraph ? 60000 : 90000,
  })
  const cleanedFirstPass = sanitizeTranslationOutput(text, firstPass.content)

  if (!looksLikeSourceEcho(text, cleanedFirstPass, singleParagraph)) {
    return cleanedFirstPass
  }

  const secondPass = await requestAiChatCompletion(buildMessages(text, singleParagraph, true), {
    temperature: 0,
    timeoutMs: singleParagraph ? 60000 : 90000,
  })
  const cleanedSecondPass = sanitizeTranslationOutput(text, secondPass.content)

  if (!cleanedSecondPass.trim()) {
    throw new Error('模型返回了空结果，请重试或调整提示词')
  }

  return cleanedSecondPass
}

function buildMessages(text: string, singleParagraph: boolean, retryWithoutEcho = false): AiChatMessage[] {
  const targetLanguage = cachedSettings.value.defaultTargetLanguage || '中文'
  const systemParts = [
    cachedSettings.value.systemPrompt,
    `将用户提供的文本翻译成${targetLanguage}。`,
    '保留原文的段落、换行、列表、Markdown 或代码块结构。',
    '只输出译文，不要解释，不要添加标题、备注或额外说明。',
    '绝对不要重复、复制、附带或夹带原文。输出中禁止出现未翻译的原文段落，除非是必须保留的代码、标识符或专有格式片段。',
  ].filter(Boolean)

  const retryNotice = retryWithoutEcho
    ? '你上一条回答错误地包含了原文。这次只返回译文正文，不要重复原文，不要做双语对照。\n\n'
    : ''
  const userPrompt = singleParagraph
    ? `${retryNotice}请翻译下面这一段内容，保持原意与格式，只返回译文：\n\n${text}`
    : `${retryNotice}请翻译下面的完整内容，并尽量保持原有段落结构，只返回译文：\n\n${text}`

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userPrompt },
  ]
}

function sanitizeTranslationOutput(source: string, output: string): string {
  let candidate = output.trim()
  const trimmedSource = source.trim()

  if (!candidate) {
    return ''
  }

  if (candidate.startsWith(trimmedSource)) {
    candidate = candidate.slice(trimmedSource.length).trimStart()
    candidate = candidate.replace(/^[:：\-\n\s]+/, '').trim()
  }

  const sourceParas = splitParagraphs(source)
  const outputParas = splitParagraphs(candidate)
  let leadingEchoCount = 0

  while (
    leadingEchoCount < sourceParas.length &&
    leadingEchoCount < outputParas.length &&
    normalizeComparableText(sourceParas[leadingEchoCount]) ===
      normalizeComparableText(outputParas[leadingEchoCount])
  ) {
    leadingEchoCount += 1
  }

  if (leadingEchoCount > 0) {
    const stripped = outputParas.slice(leadingEchoCount).join('\n\n').trim()
    if (stripped) {
      candidate = stripped
    }
  }

  return candidate.trim()
}

function looksLikeSourceEcho(source: string, output: string, singleParagraph: boolean): boolean {
  const normalizedSource = normalizeComparableText(source)
  const normalizedOutput = normalizeComparableText(output)

  if (!normalizedOutput) {
    return true
  }

  if (normalizedOutput === normalizedSource) {
    return true
  }

  if (!singleParagraph && normalizedOutput.startsWith(normalizedSource)) {
    return true
  }

  const sourceParas = splitParagraphs(source)
  const outputParas = splitParagraphs(output)
  let sharedLeadingParas = 0

  while (
    sharedLeadingParas < sourceParas.length &&
    sharedLeadingParas < outputParas.length &&
    normalizeComparableText(sourceParas[sharedLeadingParas]) ===
      normalizeComparableText(outputParas[sharedLeadingParas])
  ) {
    sharedLeadingParas += 1
  }

  return singleParagraph ? sharedLeadingParas > 0 : sharedLeadingParas >= 1
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

async function copyResult() {
  if (!resultText.value.trim()) {
    return
  }

  try {
    await navigator.clipboard.writeText(resultText.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = resultText.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function clearAll() {
  sourceText.value = ''
  translatedText.value = ''
  translatedParagraphs.value = []
  errorMsg.value = ''
  infoMsg.value = ''
}

function openSettings() {
  router.push('/tool/ai-settings')
}
</script>

<template>
  <div class="ai-translator">
    <div class="translator-toolbar">
      <NSpace align="center" wrap justify="space-between">
        <NSpace align="center" wrap>
          <NText strong>AI 翻译</NText>
          <NTag size="small" type="info">{{ configSummary }}</NTag>
          <NSelect v-model:value="displayMode" :options="DISPLAY_MODE_OPTIONS" style="width: 140px" />
          <NSelect
            v-model:value="translationStrategy"
            :options="TRANSLATION_STRATEGY_OPTIONS"
            style="width: 190px"
          />
        </NSpace>
        <NSpace>
          <NButton size="small" @click="openSettings">打开设置</NButton>
          <NButton size="small" :disabled="!canCopyResult" @click="copyResult">复制译文</NButton>
          <NButton size="small" @click="clearAll">清空</NButton>
          <NButton size="small" type="primary" :loading="loading" :disabled="!canTranslate" @click="translateText">
            开始翻译
          </NButton>
        </NSpace>
      </NSpace>
      <div class="toolbar-desc">
        默认译入 {{ cachedSettings.defaultTargetLanguage || '中文' }}。结果支持段落流与左右对照两种格式。
      </div>
    </div>

    <NAlert v-if="missingSettingLabels.length > 0" type="warning" style="margin-bottom: 8px">
      需要先在设置页补全：{{ missingSettingLabels.join('、') }}
    </NAlert>

    <NAlert v-if="errorMsg" type="error" closable style="margin-bottom: 8px" @close="errorMsg = ''">
      {{ errorMsg }}
    </NAlert>

    <NAlert v-if="infoMsg" type="info" style="margin-bottom: 8px">
      {{ infoMsg }}
    </NAlert>

    <div class="translator-content">
      <NCard size="small" title="原文" class="source-card">
        <NInput
          v-model:value="sourceText"
          type="textarea"
          placeholder="输入要翻译的文本，默认译入中文..."
          :autosize="{ minRows: 18 }"
          class="source-input"
        />
      </NCard>

      <NCard v-if="displayMode === 'side-by-side'" size="small" title="原文 / 译文对照" class="paragraph-card">
        <div v-if="paragraphRows.length > 0" class="aligned-paragraphs">
          <div class="aligned-header">
            <div class="aligned-title">原文</div>
            <div class="aligned-title">译文</div>
          </div>
          <div v-for="(row, index) in paragraphRows" :key="`${index}-${row.original}-${row.translated}`" class="aligned-row">
            <div class="aligned-cell">
              <div class="paragraph-index">第 {{ index + 1 }} 段</div>
              <div class="paragraph-text">{{ row.original || ' ' }}</div>
            </div>
            <div class="aligned-cell">
              <div class="paragraph-index">第 {{ index + 1 }} 段</div>
              <div class="paragraph-text">{{ row.translated || ' ' }}</div>
            </div>
          </div>
        </div>
        <NEmpty v-else description="翻译结果会按左右对照方式显示在这里" />
      </NCard>

      <NCard v-else size="small" title="译文" class="flow-card">
        <div v-if="flowingParagraphs.length > 0" class="flowing-content">
          <p v-for="(paragraph, index) in flowingParagraphs" :key="`${index}-${paragraph}`" class="flowing-paragraph">
            {{ paragraph }}
          </p>
        </div>
        <NEmpty v-else description="译文会以自然段落流方式显示在这里" />
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.ai-translator {
  display: flex;
  flex-direction: column;
}

.translator-toolbar {
  padding-bottom: 12px;
  flex-shrink: 0;
}

.toolbar-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
}

.translator-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-card {
  flex-shrink: 0;
}

.source-input :deep(textarea) {
  resize: vertical;
}

.flowing-content {
  color: #111827;
  line-height: 1.75;
}

.flowing-paragraph {
  margin: 0 0 16px;
  white-space: pre-wrap;
}

.flowing-paragraph:last-child {
  margin-bottom: 0;
}

.aligned-paragraphs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.aligned-header,
.aligned-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.aligned-header {
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}

.aligned-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.aligned-row {
  padding-bottom: 10px;
  border-bottom: 1px solid #f3f4f6;
}

.aligned-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.aligned-cell {
  min-width: 0;
}

.paragraph-index {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.paragraph-text {
  white-space: pre-wrap;
  line-height: 1.6;
  color: #111827;
}
</style>