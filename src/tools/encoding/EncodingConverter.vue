<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  NInput,
  NSelect,
  NButton,
  NSpace,
  NText,
  NGrid,
  NGi,
  NAlert,
  NCard,
} from 'naive-ui'

type EncodingMode = 'base64' | 'url' | 'hex' | 'unicode'

const mode = ref<EncodingMode>('base64')
const input = ref('')
const output = ref('')
const errorMsg = ref('')

const modeOptions = [
  { label: 'Base64', value: 'base64' },
  { label: 'URL 编码', value: 'url' },
  { label: 'Hex (十六进制)', value: 'hex' },
  { label: 'Unicode 转义', value: 'unicode' },
]

const modeDescription = computed(() => {
  const map: Record<EncodingMode, string> = {
    base64: '将文本与 Base64 编码互转',
    url: '对 URL 中的特殊字符进行编码/解码',
    hex: '将文本转为十六进制表示，或从十六进制还原',
    unicode: '将文本转为 Unicode 转义序列 (\\uXXXX)，或还原',
  }
  return map[mode.value]
})

// ---- 编码函数 ----

function encodeBase64(text: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

function decodeBase64(text: string): string {
  const binary = atob(text.trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const decoder = new TextDecoder()
  return decoder.decode(bytes)
}

function encodeUrl(text: string): string {
  return encodeURIComponent(text)
}

function decodeUrl(text: string): string {
  return decodeURIComponent(text.trim())
}

function encodeHex(text: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')
}

function decodeHex(text: string): string {
  const hexStr = text.trim().replace(/\s+/g, '')
  if (hexStr.length % 2 !== 0) throw new Error('十六进制字符串长度必须为偶数')
  const bytes = new Uint8Array(hexStr.length / 2)
  for (let i = 0; i < hexStr.length; i += 2) {
    const byte = parseInt(hexStr.substring(i, i + 2), 16)
    if (isNaN(byte)) throw new Error(`无效的十六进制字符: ${hexStr.substring(i, i + 2)}`)
    bytes[i / 2] = byte
  }
  return new TextDecoder().decode(bytes)
}

function encodeUnicode(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.codePointAt(0)!
      if (code > 0xffff) {
        return `\\u{${code.toString(16).toUpperCase()}}`
      }
      return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
    })
    .join('')
}

function decodeUnicode(text: string): string {
  return text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, p1, p2) => {
    const code = parseInt(p1 || p2, 16)
    return String.fromCodePoint(code)
  })
}

// ---- 操作 ----

function doEncode() {
  errorMsg.value = ''
  try {
    const text = input.value
    if (!text) {
      output.value = ''
      return
    }
    switch (mode.value) {
      case 'base64':
        output.value = encodeBase64(text)
        break
      case 'url':
        output.value = encodeUrl(text)
        break
      case 'hex':
        output.value = encodeHex(text)
        break
      case 'unicode':
        output.value = encodeUnicode(text)
        break
    }
  } catch (e: any) {
    errorMsg.value = `编码错误: ${e.message}`
  }
}

function doDecode() {
  errorMsg.value = ''
  try {
    const text = input.value
    if (!text) {
      output.value = ''
      return
    }
    switch (mode.value) {
      case 'base64':
        output.value = decodeBase64(text)
        break
      case 'url':
        output.value = decodeUrl(text)
        break
      case 'hex':
        output.value = decodeHex(text)
        break
      case 'unicode':
        output.value = decodeUnicode(text)
        break
    }
  } catch (e: any) {
    errorMsg.value = `解码错误: ${e.message}`
  }
}

async function copyOutput() {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = output.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function swapInputOutput() {
  const tmp = input.value
  input.value = output.value
  output.value = tmp
}

function clearAll() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
}
</script>

<template>
  <div class="encoding-converter">
    <div class="encoding-toolbar">
      <NSpace align="center" wrap>
        <NText strong>编码转换</NText>
        <NSelect
          v-model:value="mode"
          :options="modeOptions"
          size="small"
          style="width: 160px"
        />
        <NButton size="small" type="primary" @click="doEncode">编码 →</NButton>
        <NButton size="small" type="info" @click="doDecode">← 解码</NButton>
        <NButton size="small" @click="swapInputOutput">交换</NButton>
        <NButton size="small" @click="copyOutput">复制结果</NButton>
        <NButton size="small" @click="clearAll">清空</NButton>
      </NSpace>
      <div class="encoding-desc">{{ modeDescription }}</div>
    </div>

    <NAlert
      v-if="errorMsg"
      type="error"
      closable
      style="margin-bottom: 8px"
      @close="errorMsg = ''"
    >
      {{ errorMsg }}
    </NAlert>

    <NGrid :cols="2" :x-gap="12" class="encoding-panels">
      <NGi>
        <NCard size="small" title="输入">
          <NInput
            v-model:value="input"
            type="textarea"
            placeholder="在此输入要编码/解码的内容..."
            :rows="16"
            style="font-family: monospace"
          />
        </NCard>
      </NGi>
      <NGi>
        <NCard size="small" title="输出">
          <NInput
            v-model:value="output"
            type="textarea"
            placeholder="结果将显示在这里..."
            :rows="16"
            readonly
            style="font-family: monospace"
          />
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>

<style scoped>
.encoding-converter {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.encoding-toolbar {
  padding-bottom: 12px;
  flex-shrink: 0;
}

.encoding-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
}

.encoding-panels {
  flex: 1;
  min-height: 0;
}
</style>
