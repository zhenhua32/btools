<script setup lang="ts">
import { ref, shallowRef, onMounted } from 'vue'
import { NButton, NSpace, NText, NSelect, NAlert } from 'naive-ui'
import * as monaco from 'monaco-editor'

const container = ref<HTMLDivElement>()
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor>()
const errorMsg = ref('')
const indentSize = ref(2)

const indentOptions = [
  { label: '2 空格', value: 2 },
  { label: '4 空格', value: 4 },
  { label: 'Tab', value: 0 },
]

const sampleJson = `{"name":"BTools","version":"1.0.0","tools":["text-diff","json-formatter","encoding"],"config":{"theme":"auto","language":"zh-CN"}}`

onMounted(() => {
  if (!container.value) return

  editor.value = monaco.editor.create(container.value, {
    value: sampleJson,
    language: 'json',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: indentSize.value || 4,
    formatOnPaste: true,
  })

  editor.value.onDidChangeModelContent(() => {
    errorMsg.value = ''
  })
})

function getEditorValue(): string {
  return editor.value?.getValue() ?? ''
}

function setEditorValue(val: string) {
  editor.value?.setValue(val)
}

function formatJson() {
  const raw = getEditorValue()
  try {
    const parsed = JSON.parse(raw)
    const indent = indentSize.value === 0 ? '\t' : indentSize.value
    const formatted = JSON.stringify(parsed, null, indent)
    setEditorValue(formatted)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `JSON 解析错误: ${e.message}`
  }
}

function minifyJson() {
  const raw = getEditorValue()
  try {
    const parsed = JSON.parse(raw)
    setEditorValue(JSON.stringify(parsed))
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `JSON 解析错误: ${e.message}`
  }
}

function validateJson() {
  const raw = getEditorValue()
  try {
    JSON.parse(raw)
    errorMsg.value = ''
    alert('JSON 格式正确 ✓')
  } catch (e: any) {
    errorMsg.value = `JSON 解析错误: ${e.message}`
  }
}

async function copyResult() {
  const val = getEditorValue()
  try {
    await navigator.clipboard.writeText(val)
  } catch {
    // fallback
    const textarea = document.createElement('textarea')
    textarea.value = val
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function clearEditor() {
  setEditorValue('')
  errorMsg.value = ''
}
</script>

<template>
  <div class="json-formatter">
    <div class="json-formatter-toolbar">
      <NSpace align="center" wrap>
        <NText strong>JSON 格式化</NText>
        <NSelect
          v-model:value="indentSize"
          :options="indentOptions"
          size="small"
          style="width: 100px"
        />
        <NButton size="small" type="primary" @click="formatJson">美化</NButton>
        <NButton size="small" @click="minifyJson">压缩</NButton>
        <NButton size="small" @click="validateJson">校验</NButton>
        <NButton size="small" @click="copyResult">复制</NButton>
        <NButton size="small" @click="clearEditor">清空</NButton>
      </NSpace>
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

    <div ref="container" class="json-formatter-editor" />
  </div>
</template>

<style scoped>
.json-formatter {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.json-formatter-toolbar {
  padding-bottom: 12px;
  flex-shrink: 0;
}

.json-formatter-editor {
  flex: 1;
  min-height: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
</style>
