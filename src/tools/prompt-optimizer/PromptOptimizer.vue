<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
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
  optimizePromptWithAi,
  type PromptOptimizationMode,
} from '@/services/prompt-optimizer'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/services/ai-types'

const router = useRouter()
const sourceText = ref('')
const chinesePrompt = ref('')
const englishPrompt = ref('')
const mode = ref<PromptOptimizationMode>('T2VA')
const durationSeconds = ref<number | null>(6)
const settings = ref<AiSettings>({ ...DEFAULT_AI_SETTINGS })
const loading = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')

const missingSettingLabels = computed(() => getMissingAiSettingLabels(settings.value))
const canOptimize = computed(
  () =>
    !!sourceText.value.trim() &&
    !loading.value &&
    typeof durationSeconds.value === 'number' &&
    durationSeconds.value > 0,
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
          <NSelect
            v-model:value="mode"
            :options="PROMPT_OPTIMIZATION_MODE_OPTIONS"
            class="mode-select"
          />
          <NInputNumber
            v-model:value="durationSeconds"
            :min="0.1"
            :max="300"
            :step="0.5"
            class="duration-input"
          >
            <template #suffix>秒</template>
          </NInputNumber>
      </NSpace>
      <div class="toolbar-desc">
        复用 AI 翻译的模型配置；英文版可直接用于 H3，中文版用于审阅和调整。
      </div>
    </div>

    <NAlert v-if="missingSettingLabels.length > 0" type="warning" class="status-alert">
      需要先在设置页补全：{{ missingSettingLabels.join('、') }}
    </NAlert>
    <NAlert type="info" class="status-alert">
      {{ modeDescription }}
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
