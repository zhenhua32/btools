<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NColorPicker,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSpin,
  NText,
} from 'naive-ui'
import {
  decodeQrCodeFromDataUrl,
  generateQrCodeDataUrl,
  readFileAsDataUrl,
  type QrErrorCorrectionLevel,
} from '@/services/qr-code'

const sampleText = 'https://example.com/btools?tool=qr-code'

const generateInput = ref(sampleText)
const generatedQrUrl = ref('')
const generateError = ref('')
const generating = ref(false)
const qrSize = ref<number | null>(320)
const qrMargin = ref<number | null>(2)
const darkColor = ref('#111827')
const lightColor = ref('#ffffff')
const errorCorrectionLevel = ref<QrErrorCorrectionLevel>('M')

const recognizeLoading = ref(false)
const recognizeError = ref('')
const recognizedText = ref('')
const recognizedImageUrl = ref('')
const recognizedImageWidth = ref<number | null>(null)
const recognizedImageHeight = ref<number | null>(null)
const recognizedFileName = ref('')
const fileInput = ref<HTMLInputElement>()
const pasteZone = ref<HTMLDivElement>()

const errorCorrectionOptions: Array<{
  label: string
  value: QrErrorCorrectionLevel
}> = [
  { label: 'L（约 7% 容错）', value: 'L' },
  { label: 'M（约 15% 容错）', value: 'M' },
  { label: 'Q（约 25% 容错）', value: 'Q' },
  { label: 'H（约 30% 容错）', value: 'H' },
]

const canGenerate = computed(() => generateInput.value.trim().length > 0)
const generatedStats = computed(() => ({
  textLength: generateInput.value.length,
  size: qrSize.value ?? 320,
  margin: qrMargin.value ?? 2,
}))

async function generateQrCode() {
  const content = generateInput.value.trim()
  if (!content) {
    generateError.value = '请输入需要编码的文本、链接或其他内容'
    generatedQrUrl.value = ''
    return
  }

  generating.value = true
  generateError.value = ''

  try {
    generatedQrUrl.value = await generateQrCodeDataUrl(content, {
      size: qrSize.value ?? 320,
      margin: qrMargin.value ?? 2,
      darkColor: darkColor.value,
      lightColor: lightColor.value,
      errorCorrectionLevel: errorCorrectionLevel.value,
    })
  } catch (error) {
    generateError.value = error instanceof Error ? error.message : '二维码生成失败'
    generatedQrUrl.value = ''
  } finally {
    generating.value = false
  }
}

function downloadGeneratedQr() {
  if (!generatedQrUrl.value) return

  const link = document.createElement('a')
  link.href = generatedQrUrl.value
  link.download = 'btools-qrcode.png'
  link.click()
}

function clearGenerator() {
  generateInput.value = ''
  generatedQrUrl.value = ''
  generateError.value = ''
}

async function processRecognizeImage(file: File, fileName = file.name || '图片') {
  if (!file.type.startsWith('image/')) {
    recognizeError.value = '当前只支持识别图片格式的二维码'
    return
  }

  recognizeLoading.value = true
  recognizeError.value = ''
  recognizedText.value = ''
  recognizedImageUrl.value = ''
  recognizedImageWidth.value = null
  recognizedImageHeight.value = null
  recognizedFileName.value = fileName

  try {
    const dataUrl = await readFileAsDataUrl(file)
    recognizedImageUrl.value = dataUrl

    const decoded = await decodeQrCodeFromDataUrl(dataUrl)
    recognizedText.value = decoded.text
    recognizedImageWidth.value = decoded.width
    recognizedImageHeight.value = decoded.height
  } catch (error) {
    recognizeError.value = error instanceof Error ? error.message : '二维码识别失败'
  } finally {
    recognizeLoading.value = false
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file) return

  await processRecognizeImage(file, file.name)

  if (target) {
    target.value = ''
  }
}

function getClipboardImageFile(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null

  const imageItem = Array.from(clipboardData.items).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/')
  )

  return imageItem?.getAsFile() ?? null
}

async function handleRecognizePaste(event: ClipboardEvent) {
  const file = getClipboardImageFile(event.clipboardData)
  if (!file) {
    recognizeError.value = '剪贴板中没有图片，请先复制二维码图片再重试'
    return
  }

  event.preventDefault()
  await processRecognizeImage(file, file.name || '剪贴板图片')
}

async function readClipboardImage() {
  recognizeError.value = ''

  if (!navigator.clipboard?.read) {
    pasteZone.value?.focus()
    recognizeError.value = '当前环境不支持主动读取剪贴板，请点击下方粘贴区后按 Ctrl+V'
    return
  }

  try {
    const clipboardItems = await navigator.clipboard.read()

    for (const clipboardItem of clipboardItems) {
      const imageType = clipboardItem.types.find((type) => type.startsWith('image/'))
      if (!imageType) continue

      const imageBlob = await clipboardItem.getType(imageType)
      const extension = imageType.split('/')[1] || 'png'
      const file = new File([imageBlob], `clipboard-image.${extension}`, {
        type: imageType,
      })

      await processRecognizeImage(file, '剪贴板图片')
      return
    }

    recognizeError.value = '剪贴板中没有图片，请先复制二维码图片再重试'
  } catch {
    pasteZone.value?.focus()
    recognizeError.value = '读取剪贴板失败，请点击下方粘贴区后按 Ctrl+V'
  }
}

function focusPasteZone() {
  pasteZone.value?.focus()
}

async function copyRecognizedText() {
  if (!recognizedText.value) return

  try {
    await navigator.clipboard.writeText(recognizedText.value)
  } catch {
    recognizeError.value = '浏览器拒绝了剪贴板写入，请手动复制识别结果'
  }
}

async function useRecognizedText() {
  if (!recognizedText.value) return
  generateInput.value = recognizedText.value
  await generateQrCode()
}

function clearRecognizer() {
  recognizeError.value = ''
  recognizedText.value = ''
  recognizedImageUrl.value = ''
  recognizedImageWidth.value = null
  recognizedImageHeight.value = null
  recognizedFileName.value = ''
}

function resetAll() {
  clearGenerator()
  clearRecognizer()
}

onMounted(() => {
  void generateQrCode()
})
</script>

<template>
  <div class="qr-code-tool">
    <div class="qr-toolbar">
      <NSpace align="center" wrap>
        <NText strong>二维码</NText>
        <NButton size="small" @click="generateInput = sampleText; generateQrCode()">
          恢复示例
        </NButton>
        <NButton size="small" @click="resetAll">全部清空</NButton>
      </NSpace>
    </div>

    <NGrid cols="1 s:1 m:2" responsive="screen" :x-gap="16" :y-gap="16">
      <NGi>
        <NCard title="生成二维码" size="small" class="tool-card">
          <div class="card-body">
            <NForm label-placement="top">
              <NFormItem label="内容">
                <NInput
                  v-model:value="generateInput"
                  type="textarea"
                  placeholder="输入文本、链接、联系方式或其他任意内容"
                  :autosize="{ minRows: 5, maxRows: 10 }"
                />
              </NFormItem>

              <NGrid cols="1 s:2" responsive="screen" :x-gap="12">
                <NGi>
                  <NFormItem label="输出尺寸（px）">
                    <NInputNumber v-model:value="qrSize" :min="128" :max="1024" :step="32" />
                  </NFormItem>
                </NGi>
                <NGi>
                  <NFormItem label="留白边距">
                    <NInputNumber v-model:value="qrMargin" :min="0" :max="16" :step="1" />
                  </NFormItem>
                </NGi>
              </NGrid>

              <NGrid cols="1 s:2" responsive="screen" :x-gap="12">
                <NGi>
                  <NFormItem label="深色模块">
                    <NColorPicker v-model:value="darkColor" :show-alpha="false" />
                  </NFormItem>
                </NGi>
                <NGi>
                  <NFormItem label="浅色背景">
                    <NColorPicker v-model:value="lightColor" :show-alpha="false" />
                  </NFormItem>
                </NGi>
              </NGrid>

              <NFormItem label="纠错级别">
                <NSelect v-model:value="errorCorrectionLevel" :options="errorCorrectionOptions" />
              </NFormItem>
            </NForm>

            <NSpace wrap>
              <NButton type="primary" :disabled="!canGenerate" :loading="generating" @click="generateQrCode">
                生成
              </NButton>
              <NButton :disabled="!generatedQrUrl" @click="downloadGeneratedQr">下载 PNG</NButton>
              <NButton @click="clearGenerator">清空生成区</NButton>
            </NSpace>

            <NAlert v-if="generateError" type="error" closable @close="generateError = ''">
              {{ generateError }}
            </NAlert>

            <div class="preview-panel">
              <NSpin :show="generating">
                <div v-if="generatedQrUrl" class="preview-content">
                  <img :src="generatedQrUrl" alt="二维码预览" class="preview-image" />
                  <p class="meta-text">
                    {{ generatedStats.textLength }} 字符 · {{ generatedStats.size }}px · 边距 {{ generatedStats.margin }}
                  </p>
                </div>
                <NEmpty v-else description="输入内容后生成二维码" />
              </NSpin>
            </div>
          </div>
        </NCard>
      </NGi>

      <NGi>
        <NCard title="识别二维码" size="small" class="tool-card">
          <div class="card-body">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden-file-input"
              @change="handleFileInputChange"
            />

            <NSpace align="center" wrap>
              <NButton type="primary" ghost @click="openFilePicker">选择图片</NButton>
              <NButton @click="readClipboardImage">读取剪贴板图片</NButton>
              <NButton @click="focusPasteZone">点击后 Ctrl+V</NButton>
              <NButton :disabled="!recognizedImageUrl && !recognizedText" @click="clearRecognizer">
                清空识别区
              </NButton>
            </NSpace>

            <NText depth="3" class="helper-text">
              支持上传本地截图、读取已复制到剪贴板的图片，或点击下方区域后直接按 Ctrl+V 粘贴。
            </NText>

            <NAlert v-if="recognizeError" type="error" closable @close="recognizeError = ''">
              {{ recognizeError }}
            </NAlert>

            <div
              ref="pasteZone"
              class="preview-panel paste-panel"
              tabindex="0"
              @click="focusPasteZone"
              @paste="handleRecognizePaste"
            >
              <NSpin :show="recognizeLoading">
                <div v-if="recognizedImageUrl" class="preview-content">
                  <img :src="recognizedImageUrl" alt="待识别二维码图片" class="preview-image" />
                  <p class="meta-text">
                    {{ recognizedFileName || '已选择图片' }}
                    <span v-if="recognizedImageWidth && recognizedImageHeight">
                      · {{ recognizedImageWidth }} × {{ recognizedImageHeight }}
                    </span>
                  </p>
                </div>
                <div v-else class="paste-empty-state">
                  <NEmpty description="选择图片，或把复制到剪贴板的二维码图片粘贴到这里" />
                  <p class="meta-text">点击此区域后按 Ctrl+V，也可以直接使用“读取剪贴板图片”。</p>
                </div>
              </NSpin>
            </div>

            <NForm label-placement="top">
              <NFormItem label="识别结果">
                <NInput
                  :value="recognizedText"
                  type="textarea"
                  readonly
                  placeholder="识别结果会显示在这里"
                  :autosize="{ minRows: 5, maxRows: 10 }"
                />
              </NFormItem>
            </NForm>

            <NSpace wrap>
              <NButton :disabled="!recognizedText" @click="copyRecognizedText">复制结果</NButton>
              <NButton :disabled="!recognizedText" @click="useRecognizedText">填入生成器</NButton>
            </NSpace>
          </div>
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>

<style scoped>
.qr-code-tool {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qr-toolbar {
  flex-shrink: 0;
}

.tool-card {
  height: 100%;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.helper-text,
.meta-text {
  font-size: 12px;
  color: #6b7280;
}

.preview-panel {
  min-height: 260px;
  border: 1px dashed #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hidden-file-input {
  display: none;
}

.paste-panel {
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.paste-panel:hover,
.paste-panel:focus {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 0.12);
}

.preview-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.paste-empty-state {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.preview-image {
  max-width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}

@media (max-width: 768px) {
  .preview-panel {
    min-height: 220px;
  }
}
</style>