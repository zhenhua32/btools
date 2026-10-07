<script setup lang="ts">
import { computed, onDeactivated, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NInput, NSpace, NText } from 'naive-ui'
import { createReadAloudSession, type ReadAloudSession, type ReadAloudStatus } from '@/services/read-aloud-client'

const router = useRouter()
const sourceText = ref('')
const status = ref<ReadAloudStatus | 'idle'>('idle')
const errorMsg = ref('')
const lastFinishedText = ref('')
let session: ReadAloudSession | undefined
let generation = 0

const active = computed(() => status.value === 'loading' || status.value === 'playing' || status.value === 'blocked')
const canReplay = computed(() => status.value === 'finished' && !errorMsg.value && !!lastFinishedText.value.trim())
const statusText = computed(() => ({
  idle: '',
  loading: '正在生成语音，收到音频后自动开始播放…',
  playing: '正在朗读…',
  blocked: '浏览器需要一次点击才能播放语音，请点击“开始播放”。',
  finished: '朗读完成',
}[status.value]))

function stop() {
  generation++
  session?.stop()
  session = undefined
  status.value = 'idle'
}

function readAloud() {
  startReadAloud(sourceText.value)
}

function replay() {
  startReadAloud(lastFinishedText.value)
}

function startReadAloud(text: string) {
  stop()
  errorMsg.value = ''
  const currentGeneration = generation
  // Keep this synchronous: audio is unlocked in this click handler.
  session = createReadAloudSession(text, {
    onStatus: (value) => {
      if (generation !== currentGeneration) return
      status.value = value
      if (value === 'finished') {
        lastFinishedText.value = text
        session = undefined
      }
    },
    onError: (message) => {
      if (generation !== currentGeneration) return
      status.value = 'idle'
      errorMsg.value = message
      session = undefined
    },
  })
}

onDeactivated(stop)
onUnmounted(stop)
</script>

<template>
  <div class="read-aloud">
    <NSpace justify="space-between" align="center" wrap>
      <NText strong>AI 朗读</NText>
      <NSpace>
        <NButton size="small" @click="router.push('/tool/ai-settings')">打开 AI 设置</NButton>
        <NButton v-if="active" size="small" @click="stop">停止朗读</NButton>
        <NButton v-if="status === 'blocked'" size="small" type="primary" @click="session?.resume()">开始播放</NButton>
        <NButton v-if="canReplay" size="small" type="primary" @click="replay">重新朗读</NButton>
        <NButton
          size="small"
          :type="canReplay || status === 'blocked' ? 'default' : 'primary'"
          :disabled="!sourceText.trim() || active"
          @click="readAloud"
        >开始朗读</NButton>
      </NSpace>
    </NSpace>
    <p class="read-aloud-desc">音色和接口在 AI 设置中配置。默认使用性感御姐音色，按短句生成，首段完成后开始播放。</p>
    <NAlert v-if="errorMsg" type="error" closable @close="errorMsg = ''">
      {{ errorMsg }}
      <NButton size="tiny" text type="primary" @click="router.push('/tool/ai-settings')">打开 AI 设置</NButton>
    </NAlert>
    <NAlert v-if="statusText" type="info" role="status">{{ statusText }}</NAlert>
    <NCard size="small" title="朗读文本">
      <NInput
          v-model:value="sourceText"
          type="textarea"
          placeholder="输入要朗读的文本，或在网页上选中文字后点击朗读…"
          :autosize="{ minRows: 16 }"
      />
    </NCard>
  </div>
</template>

<style scoped>
.read-aloud { display: flex; flex-direction: column; gap: 12px; }
.read-aloud-desc { margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6; }
</style>
