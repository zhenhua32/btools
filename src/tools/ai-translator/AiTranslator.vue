<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NGrid,
  NGi,
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
const resultParagraphs = computed(() => {
  if (translatedParagraphs.value.length > 0) {
    return translatedParagraphs.value
  }

  return splitParagraphs(translatedText.value)
})
const resultText = computed(() => {
  if (translatedText.value.trim()) {
    return translatedText.value
  }

  return translatedParagraphs.value.join('\n\n')
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
  const response = await requestAiChatCompletion(buildMessages(text, false), {
    temperature: 0.2,
    timeoutMs: 90000,
  })

  translatedText.value = response.content.trim()
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
    const response = await requestAiChatCompletion(buildMessages(paragraphs[i], true), {
      temperature: 0.2,
      timeoutMs: 60000,
    })
    results.push(response.content.trim())
  }

  translatedParagraphs.value = results
  translatedText.value = results.join('\n\n')
}

function buildMessages(text: string, singleParagraph: boolean): AiChatMessage[] {
  const targetLanguage = cachedSettings.value.defaultTargetLanguage || '中文'
  const systemParts = [
    cachedSettings.value.systemPrompt,
    `将用户提供的文本翻译成${targetLanguage}。`,
    '保留原文的段落、换行、列表、Markdown 或代码块结构。',
    '只输出译文，不要解释，不要添加标题、备注或额外说明。',
  ].filter(Boolean)

  const userPrompt = singleParagraph
    ? `请翻译下面这一段内容，保持原意与格式：\n\n${text}`
    : `请翻译下面的完整内容，并尽量保持原有段落结构：\n\n${text}`

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userPrompt },
  ]
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

    <NGrid :cols="2" :x-gap="12" class="translator-panels">
      <NGi>
        <NCard size="small" title="原文">
          <NInput
            v-model:value="sourceText"
            type="textarea"
            placeholder="输入要翻译的文本，默认译入中文..."
            :rows="18"
          />
        </NCard>
      </NGi>

      <NGi>
        <NCard v-if="displayMode === 'side-by-side'" size="small" title="译文">
          <NInput
            :value="resultText"
            type="textarea"
            placeholder="译文会显示在这里..."
            :rows="18"
            readonly
          />
        </NCard>

        <NCard v-else size="small" title="段落译文" class="paragraph-card">
          <div v-if="resultParagraphs.length > 0" class="paragraph-list">
            <div v-for="(paragraph, index) in resultParagraphs" :key="`${index}-${paragraph}`" class="paragraph-item">
              <div class="paragraph-index">第 {{ index + 1 }} 段</div>
              <div class="paragraph-text">{{ paragraph }}</div>
            </div>
          </div>
          <NEmpty v-else description="翻译结果会按段落显示在这里" />
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>

<style scoped>
.ai-translator {
  display: flex;
  flex-direction: column;
  height: 100%;
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

.translator-panels {
  flex: 1;
  min-height: 0;
}

.paragraph-card,
.paragraph-card :deep(.n-card__content) {
  height: 100%;
}

.paragraph-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 100%;
  overflow: auto;
}

.paragraph-item {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
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