<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NText,
  NSwitch,
} from 'naive-ui'
import { getAiSettings, resetAiSettings, saveAiSettings } from '@/services/ai-settings'
import {
  getReadAloudVoiceReferences,
  saveReadAloudVoiceReference,
  importReadAloudVoiceBundle,
  validateReadAloudVoiceBundle,
  MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH,
  type ReadAloudVoiceReferences,
  type ReadAloudVoiceLanguage,
} from '@/services/read-aloud-voice-reference'
import {
  DEFAULT_AI_SETTINGS,
  DISPLAY_MODE_OPTIONS,
  TRANSLATION_STRATEGY_OPTIONS,
  type AiSettings,
} from '@/services/ai-types'

const formState = reactive<AiSettings>({ ...DEFAULT_AI_SETTINGS })
const errorMsg = ref('')
const successMsg = ref('')
const saving = ref(false)
const loading = ref(false)
const voiceReferences = ref<ReadAloudVoiceReferences>({ default: null, zh: null, en: null })
const savingReference = ref(false)
const bundleFileInput = ref<HTMLInputElement | null>(null)
const referenceSlots: Array<{ language: ReadAloudVoiceLanguage; label: string }> = [
  { language: 'default', label: '通用' },
  { language: 'zh', label: '中文' },
  { language: 'en', label: '英文' },
]
const isVoiceCloneModel = computed(() => formState.ttsModel.trim().toLowerCase().includes('voiceclone'))
const timeoutSeconds = computed<number | null>({
  get: () => Math.max(1, Math.round(formState.requestTimeoutMs / 1000)),
  set: (value: number | null) => {
    formState.requestTimeoutMs = typeof value === 'number' && value > 0 ? Math.round(value * 1000) : 0
  },
})

onMounted(loadStoredSettings)
onActivated(loadStoredSettings)

async function loadStoredSettings() {
  loading.value = true
  errorMsg.value = ''

  try {
    const [settings, storedReference] = await Promise.allSettled([
      getAiSettings(),
      getReadAloudVoiceReferences(),
    ])
    if (settings.status === 'rejected') throw settings.reason
    syncForm(settings.value)
    if (storedReference.status === 'rejected') throw storedReference.reason
    voiceReferences.value = storedReference.value
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '读取设置失败'
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  errorMsg.value = ''
  successMsg.value = ''

  const validationError = validateForm()
  if (validationError) {
    errorMsg.value = validationError
    return
  }

  saving.value = true

  try {
    const saved = await saveAiSettings({ ...formState })
    syncForm(saved)
    successMsg.value = 'AI 设置已保存到当前浏览器本地'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '保存设置失败'
  } finally {
    saving.value = false
  }
}

async function handleReset() {
  errorMsg.value = ''
  successMsg.value = ''
  saving.value = true

  try {
    syncForm(await resetAiSettings())
    successMsg.value = '已恢复默认设置'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '重置设置失败'
  } finally {
    saving.value = false
  }
}

function syncForm(settings: AiSettings) {
  Object.assign(formState, settings)
}

async function handleReferenceUpload(event: Event, language: ReadAloudVoiceLanguage) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMsg.value = ''
  successMsg.value = ''
  savingReference.value = true

  try {
    const mimeType = getReferenceFileMimeType(file)
    if (Math.ceil(file.size / 3) * 4 > MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH) {
      throw new Error('参考音频编码后不能超过 10 MB，请选择更短的 WAV 或 MP3 文件')
    }
    const result = await readFileAsDataUrl(file)
    const encodedAudio = result.slice(result.indexOf(',') + 1)
    const reference = { name: file.name, dataUrl: `data:${mimeType};base64,${encodedAudio}` }
    await saveReadAloudVoiceReference(reference, language)
    voiceReferences.value[language] = reference
    successMsg.value = '参考音频已保存，使用 VoiceClone 模型时将复用此音色'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '保存参考音频失败'
  } finally {
    savingReference.value = false
    input.value = ''
  }
}

async function handleReferenceRemove(language: ReadAloudVoiceLanguage) {
  errorMsg.value = ''
  successMsg.value = ''
  savingReference.value = true
  try {
    await saveReadAloudVoiceReference(null, language)
    voiceReferences.value[language] = null
    successMsg.value = '参考音频已移除'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '移除参考音频失败'
  } finally {
    savingReference.value = false
  }
}

async function handleVoiceBundleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMsg.value = ''
  successMsg.value = ''
  savingReference.value = true
  try {
    if (file.size > MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH * 2 + 100_000) {
      throw new Error('音色组合文件过大，请选择较小的参考音频组合')
    }
    const text = await readFileAsText(file)
    let inputBundle: unknown
    try { inputBundle = JSON.parse(text) } catch { throw new Error('音色组合文件不是有效的 JSON') }
    const bundle = validateReadAloudVoiceBundle(inputBundle)
    const imported = await importReadAloudVoiceBundle(bundle)
    // Keep unrelated unsaved form edits local; the importer merges stored settings.
    Object.assign(formState, {
      ttsModel: imported.ttsModel,
      ttsVoiceDescription: imported.ttsVoiceDescription,
      ttsChineseVoiceDescription: imported.ttsChineseVoiceDescription,
      ttsEnglishVoiceDescription: imported.ttsEnglishVoiceDescription,
    })
    voiceReferences.value = { ...voiceReferences.value, ...bundle.references }
    successMsg.value = '中英文音色组合已导入，可分别试听；接口地址和 API Key 保持不变'
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '导入音色组合失败'
  } finally {
    savingReference.value = false
    input.value = ''
  }
}

function getReferenceFileMimeType(file: File): 'audio/wav' | 'audio/mpeg' {
  const mimeType = file.type.toLowerCase()
  if (['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'].includes(mimeType) ||
    (!mimeType && /\.wav$/iu.test(file.name))) return 'audio/wav'
  if (['audio/mpeg', 'audio/mp3'].includes(mimeType) ||
    (!mimeType && /\.mp3$/iu.test(file.name))) return 'audio/mpeg'
  throw new Error('参考音频仅支持 WAV 或 MP3 文件')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取参考音频失败，请重新选择文件'))
    }
    reader.onerror = () => reject(new Error('读取参考音频失败，请重新选择文件'))
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取音色组合失败，请重新选择文件'))
    }
    reader.onerror = () => reject(new Error('读取音色组合失败，请重新选择文件'))
    reader.readAsText(file)
  })
}

function validateForm(): string {
  for (const [label, value] of [
    ['翻译接口地址', formState.baseUrl],
    ['朗读接口地址', formState.ttsBaseUrl],
  ]) {
    if (!value?.trim()) continue

    try {
      const url = new URL(value.trim())
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return `${label}需要使用 HTTP 或 HTTPS`
      }
    } catch {
      return `${label}格式不正确，请输入完整 URL`
    }
  }

  if (!formState.promptOptimizerSystemPrompt.trim()) {
    return '请填写提示词优化系统提示词'
  }

  if (!formState.defaultTargetLanguage.trim()) {
    return '请填写默认目标语言'
  }

  if (!(formState.requestTimeoutMs > 0)) {
    return '请求超时时间必须大于 0 秒'
  }

  return ''
}
</script>

<template>
  <div class="ai-settings">
    <div class="ai-settings-toolbar">
      <NSpace align="center" justify="space-between">
        <div>
          <NText strong>AI 设置</NText>
          <div class="toolbar-desc">翻译与朗读可分别配置接口，配置会保存在当前浏览器本地。</div>
        </div>
        <NSpace>
          <NButton size="small" :loading="loading" :disabled="savingReference" @click="loadStoredSettings">重新加载</NButton>
          <NButton size="small" :loading="saving" :disabled="savingReference" @click="handleReset">恢复默认</NButton>
          <NButton size="small" type="primary" :loading="saving" :disabled="savingReference" @click="handleSave">保存设置</NButton>
        </NSpace>
      </NSpace>
    </div>

    <NAlert v-if="errorMsg" type="error" closable style="margin-bottom: 12px" @close="errorMsg = ''">
      {{ errorMsg }}
    </NAlert>

    <NAlert
      v-if="successMsg"
      type="success"
      closable
      style="margin-bottom: 12px"
      @close="successMsg = ''"
    >
      {{ successMsg }}
    </NAlert>

    <NCard size="small" title="翻译 / 文本模型配置">
      <NForm label-placement="top">
        <NFormItem label="Base URL / 接口地址">
          <NInput
            v-model:value="formState.baseUrl"
            placeholder="例如：https://api.openai.com/v1"
          />
        </NFormItem>

        <NFormItem label="API Key">
          <NInput
            v-model:value="formState.apiKey"
            type="password"
            placeholder="输入 OpenAI 兼容接口的 API Key"
            show-password-on="mousedown"
          />
        </NFormItem>

        <NFormItem label="Model / 模型名称">
          <NInput
            v-model:value="formState.model"
            placeholder="例如：gpt-4.1-mini 或 qwen-plus"
          />
        </NFormItem>

        <NFormItem label="系统提示词 / 模型上下文">
          <NInput
            v-model:value="formState.systemPrompt"
            type="textarea"
            placeholder="给模型的固定上下文提示词"
            :autosize="{ minRows: 4, maxRows: 8 }"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="朗读 / 音色设计" class="settings-section">
      <NForm label-placement="top">
        <NFormItem label="朗读 Base URL / 接口地址">
          <NInput
            v-model:value="formState.ttsBaseUrl"
            placeholder="https://api.xiaomimimo.com/v1"
          />
        </NFormItem>

        <NFormItem label="朗读 API Key">
          <NInput
            v-model:value="formState.ttsApiKey"
            type="password"
            placeholder="输入 MiMo 语音接口的 API Key"
            show-password-on="mousedown"
          />
          <template #feedback>
            朗读使用独立的 API Key；仅使用朗读时无需填写翻译模型配置。
          </template>
        </NFormItem>

        <NFormItem label="朗读 Model / 模型名称">
          <NInput
            v-model:value="formState.ttsModel"
            placeholder="mimo-v2.5-tts-voicedesign"
          />
        </NFormItem>

        <NFormItem :label="isVoiceCloneModel ? '通用朗读风格 / 语速' : '音色描述'">
          <NInput
            v-model:value="formState.ttsVoiceDescription"
            type="textarea"
            placeholder="例如：性感御姐音色"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
          <template #feedback>
            <template v-if="isVoiceCloneModel">
              VoiceClone 复用参考音频的说话人音色。这里只描述情绪、语速与朗读方式，例如“保留参考音色，语速舒缓、自然朗读”；性别、年龄和音高描述请用于 VoiceDesign 音色设计。首段合成后开始播放，该模型暂不支持实时音频分片。
            </template>
            <template v-else>
              描述声音的性别、音高、情绪与说话方式，默认“性感御姐音色”。VoiceDesign 按短句生成并连续播放，首段完成后即可开始朗读；该模型暂不提供实时音频分片，逐段音色可能略有变化。可随时停止。
            </template>
          </template>
        </NFormItem>

        <template v-if="isVoiceCloneModel">
          <NFormItem label="中文朗读风格（可选）">
            <NInput
              v-model:value="formState.ttsChineseVoiceDescription"
              type="textarea"
              placeholder="留空使用通用朗读风格"
              :autosize="{ minRows: 2, maxRows: 5 }"
            />
          </NFormItem>
          <NFormItem label="英文朗读风格（可选）">
            <NInput
              v-model:value="formState.ttsEnglishVoiceDescription"
              type="textarea"
              placeholder="留空使用通用朗读风格"
              :autosize="{ minRows: 2, maxRows: 5 }"
            />
          </NFormItem>
        </template>

        <NFormItem label="导入音色组合">
          <NButton
            size="small"
            :loading="savingReference"
            :disabled="loading || saving"
            @click="bundleFileInput?.click()"
          >导入音色组合 JSON</NButton>
          <input
            ref="bundleFileInput"
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="选择音色组合文件"
            @change="handleVoiceBundleImport"
          />
          <template #feedback>
            一次导入中文与英文参考音色和朗读风格，立即保存并切换为 VoiceClone 模型。组合文件不含密钥，导入会保留已保存的接口、API Key 和其他 AI 设置。
          </template>
        </NFormItem>

        <NFormItem
          v-for="slot in referenceSlots"
          :key="slot.language"
          :label="`VoiceClone ${slot.label}参考音频`"
        >
          <div class="voice-reference">
            <input
              :aria-label="`选择${slot.label}参考音频`"
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              :disabled="savingReference || loading || saving"
              @change="handleReferenceUpload($event, slot.language)"
            />
            <template v-if="voiceReferences[slot.language]">
              <NText>{{ voiceReferences[slot.language]!.name }}</NText>
              <audio
                :src="voiceReferences[slot.language]!.dataUrl"
                controls
                preload="none"
                :aria-label="`${slot.label}参考音频试听`"
              />
              <NButton size="small" :loading="savingReference" @click="handleReferenceRemove(slot.language)">
                移除{{ slot.label }}参考音频
              </NButton>
            </template>
          </div>
          <template #feedback>
            <template v-if="slot.language === 'default'">通用参考在没有对应语言参考时使用，兼容之前保存的单一音色。</template>
            <template v-else>朗读{{ slot.label }}句子时优先使用此参考音色，缺少时使用通用参考。</template>
            选择 WAV/MP3 即保存；单份音频的 Base64 编码最多 10 MB，能否保存还取决于浏览器本地存储空间。保存、恢复 AI 设置或切换模型均会保留三种参考音频。
          </template>
        </NFormItem>
        <NText depth="3">
          VoiceClone 按每句的主要语言自动选择音色；中文句中嵌入短英文词时仍使用中文音色。缺少语言参考和通用参考时，会在请求前提示补充参考音频。
        </NText>
      </NForm>
    </NCard>

    <NCard size="small" title="提示词优化" class="settings-section">
      <NForm label-placement="top">
        <NFormItem label="MiniMax-H3 指南改写系统提示词">
          <NInput
            v-model:value="formState.promptOptimizerSystemPrompt"
            type="textarea"
            placeholder="用于将用户描述改写为 MiniMax-H3 英文正式提示词"
            :autosize="{ minRows: 10, maxRows: 24 }"
          />
          <template #feedback>
            此提示词用于第一步生成英文 H3 正式提示词；随后会复用 AI 翻译模型生成中文审阅版。可按需修改，恢复默认可还原内置指南。
          </template>
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="翻译默认值" class="settings-section">
      <NForm label-placement="top">
        <NFormItem label="默认目标语言">
          <NInput v-model:value="formState.defaultTargetLanguage" placeholder="例如：中文" />
        </NFormItem>

        <NFormItem label="默认展示模式">
          <NSelect
            v-model:value="formState.defaultDisplayMode"
            :options="DISPLAY_MODE_OPTIONS"
          />
        </NFormItem>

        <NFormItem label="默认翻译策略 (网页翻译使用逐段翻译)">
          <NSelect
            v-model:value="formState.defaultTranslationStrategy"
            :options="TRANSLATION_STRATEGY_OPTIONS"
          />
        </NFormItem>

        <NFormItem label="并发数 (逐段翻译时控制并发)">
          <NInputNumber
            v-model:value="formState.concurrencyLimit"
            :min="1"
            :max="10"
            placeholder="默认: 3"
          />
        </NFormItem>

        <NFormItem label="请求超时（秒）">
          <NInputNumber
            v-model:value="timeoutSeconds"
            :min="1"
            :max="3600"
            placeholder="默认: 300"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="交互设置" class="settings-section">
      <NForm label-placement="top">
        <NFormItem label="启用流式输出 (打字机效果)">
          <NSwitch v-model:value="formState.enableStreaming" />
        </NFormItem>

        <NFormItem label="启用选中文本后的悬浮翻译按钮">
          <NSwitch v-model:value="formState.enableSelectionButton" />
          <template #feedback>
            翻译或朗读本地 HTML 文件时，请先在浏览器扩展管理页的 BTools 详情中开启“允许访问文件网址”，然后刷新本地页面。
          </template>
        </NFormItem>

        <NFormItem label="启用选中文本后的悬浮朗读按钮">
          <NSwitch v-model:value="formState.enableSelectionReadAloudButton" />
        </NFormItem>

        <NFormItem label="划选文本时按住 Ctrl 或 Command 键直接触发翻译">
          <NSwitch v-model:value="formState.enableCtrlSelection" />
        </NFormItem>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.ai-settings {
  max-width: 880px;
}

.ai-settings-toolbar {
  padding-bottom: 12px;
}

.toolbar-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
}

.settings-section {
  margin-top: 12px;
}

.voice-reference {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}

.voice-reference audio {
  width: min(100%, 420px);
}
</style>
