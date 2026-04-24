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
import {
  getAiSettings,
  getMissingAiSettingLabels,
  isAiSettingsConfigured,
} from '@/services/ai-settings'
import { splitParagraphs, translateTextWithAi } from '@/services/ai-translator'
import {
  DISPLAY_MODE_OPTIONS,
  TRANSLATION_STRATEGY_OPTIONS,
  DEFAULT_AI_SETTINGS,
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
    const result = await translateTextWithAi(sourceText.value, {
      settings: cachedSettings.value,
      strategy: translationStrategy.value,
      onProgress: (message) => {
        infoMsg.value = message
      },
    })

    translatedText.value = result.text
    translatedParagraphs.value = result.paragraphs
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '翻译失败'
  } finally {
    loading.value = false
    infoMsg.value = ''
  }
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
          <div
            v-for="(row, index) in paragraphRows"
            :key="`${index}-${row.original}-${row.translated}`"
            :class="['aligned-row', index % 2 === 0 ? 'aligned-row-even' : 'aligned-row-odd']"
          >
            <div class="aligned-cell">
              <div class="paragraph-text">{{ row.original || ' ' }}</div>
            </div>
            <div class="aligned-cell">
              <div class="paragraph-text">{{ row.translated || ' ' }}</div>
            </div>
          </div>
        </div>
        <NEmpty v-else description="翻译结果会按左右对照方式显示在这里" />
      </NCard>

      <NCard v-else size="small" title="译文" class="flow-card">
        <div v-if="paragraphRows.length > 0" class="flowing-content">
          <div v-for="(row, index) in paragraphRows" :key="`${index}-${row.original}-${row.translated}`" class="flow-pair">
            <div class="flow-block flow-original">{{ row.original || ' ' }}</div>
            <div class="flow-block flow-translated">{{ row.translated || ' ' }}</div>
          </div>
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

.flow-pair {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid #f3f4f6;
}

.flow-pair:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: 0;
}

.flow-block {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  white-space: pre-wrap;
  line-height: 1.75;
}

.flow-original {
  background: #f8fafc;
}

.flow-translated {
  background: #f7fdf9;
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
  margin-bottom: 10px;
}

.aligned-row:last-child {
  margin-bottom: 0;
}

.aligned-cell {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 8px;
}

.aligned-row-even .aligned-cell {
  background: #f8fafc;
}

.aligned-row-odd .aligned-cell {
  background: #f7fbf8;
}

.paragraph-text {
  white-space: pre-wrap;
  line-height: 1.6;
  color: #111827;
}
</style>