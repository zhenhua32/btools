<script setup lang="ts">
import { ref, shallowRef, onMounted, watch } from 'vue'
import { NSwitch, NSpace, NButton, NText } from 'naive-ui'
import * as monaco from 'monaco-editor'

const container = ref<HTMLDivElement>()
const diffEditor = shallowRef<monaco.editor.IStandaloneDiffEditor>()
const inline = ref(false)

const originalText = ref(`{
  "name": "BTools",
  "version": "1.0.0",
  "description": "浏览器工具集"
}`)

const modifiedText = ref(`{
  "name": "BTools",
  "version": "1.1.0",
  "description": "浏览器工具集",
  "author": "开发者"
}`)

onMounted(() => {
  if (!container.value) return

  const originalModel = monaco.editor.createModel(originalText.value, 'text/plain')
  const modifiedModel = monaco.editor.createModel(modifiedText.value, 'text/plain')

  diffEditor.value = monaco.editor.createDiffEditor(container.value, {
    automaticLayout: true,
    renderSideBySide: !inline.value,
    readOnly: false,
    originalEditable: true,
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
  })

  diffEditor.value.setModel({
    original: originalModel,
    modified: modifiedModel,
  })

  // 双向同步编辑器内容
  originalModel.onDidChangeContent(() => {
    originalText.value = originalModel.getValue()
  })
  modifiedModel.onDidChangeContent(() => {
    modifiedText.value = modifiedModel.getValue()
  })
})

watch(inline, (val) => {
  diffEditor.value?.updateOptions({ renderSideBySide: !val })
})

function clearAll() {
  const model = diffEditor.value?.getModel()
  if (model) {
    model.original.setValue('')
    model.modified.setValue('')
  }
}

function swapTexts() {
  const model = diffEditor.value?.getModel()
  if (model) {
    const origVal = model.original.getValue()
    const modVal = model.modified.getValue()
    model.original.setValue(modVal)
    model.modified.setValue(origVal)
  }
}
</script>

<template>
  <div class="text-diff">
    <div class="text-diff-toolbar">
      <NSpace align="center">
        <NText strong>文本对比</NText>
        <NSwitch v-model:value="inline" size="small">
          <template #checked>内联</template>
          <template #unchecked>并排</template>
        </NSwitch>
        <NButton size="small" @click="swapTexts">交换</NButton>
        <NButton size="small" @click="clearAll">清空</NButton>
      </NSpace>
    </div>
    <div class="text-diff-labels">
      <span class="label">原始文本</span>
      <span class="label">修改后文本</span>
    </div>
    <div ref="container" class="text-diff-editor" />
  </div>
</template>

<style scoped>
.text-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.text-diff-toolbar {
  padding-bottom: 12px;
  flex-shrink: 0;
}

.text-diff-labels {
  display: flex;
  gap: 8px;
  padding-bottom: 4px;
  flex-shrink: 0;
}

.text-diff-labels .label {
  flex: 1;
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.text-diff-editor {
  flex: 1;
  min-height: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
</style>
