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
    syncForm(await getAiSettings())
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

function validateForm(): string {
  if (!formState.baseUrl.trim()) {
    return '请填写 OpenAI 兼容接口地址'
  }

  try {
    new URL(formState.baseUrl.trim())
  } catch {
    return '接口地址格式不正确，请输入完整 URL'
  }

  if (!formState.apiKey.trim()) {
    return '请填写 API Key'
  }

  if (!formState.model.trim()) {
    return '请填写模型名称'
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
          <div class="toolbar-desc">使用 OpenAI 兼容接口，配置会保存在当前浏览器本地。</div>
        </div>
        <NSpace>
          <NButton size="small" :loading="loading" @click="loadStoredSettings">重新加载</NButton>
          <NButton size="small" :loading="saving" @click="handleReset">恢复默认</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="handleSave">保存设置</NButton>
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

    <NCard size="small" title="模型配置">
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
</style>