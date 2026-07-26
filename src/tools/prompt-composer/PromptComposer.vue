<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSwitch,
} from 'naive-ui'
import {
  clonePromptCategories,
  composePrompt,
  createRandomSelection,
  DEFAULT_PROMPT_CATEGORIES,
  filterPromptCategories,
  type PromptCategory,
  type PromptLanguage,
  type PromptTerm,
  type SelectedPrompt,
} from '@/services/prompt-composer'

const STORAGE_KEY = 'btools-prompt-composer-v1'

const categories = ref<PromptCategory[]>(clonePromptCategories())
const enabledCategoryIds = ref(DEFAULT_PROMPT_CATEGORIES.map((category) => category.id))
const activeCategoryId = ref('all')
const searchQuery = ref('')
const selected = ref<SelectedPrompt[]>([])
const outputLanguage = ref<PromptLanguage>('bilingual')
const promptText = ref('')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const showCategoryManager = ref(false)
const showCategoryEditor = ref(false)
const editorMode = ref<'add' | 'edit'>('add')
const editingCategoryId = ref('')

const categoryForm = reactive({
  nameZh: '',
  nameEn: '',
  termsText: '',
})

const languageOptions: Array<{ label: string; value: PromptLanguage }> = [
  { label: '中英对照', value: 'bilingual' },
  { label: '仅中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

const filteredGroups = computed(() =>
  filterPromptCategories(categories.value, searchQuery.value, activeCategoryId.value),
)

const visibleTermCount = computed(() =>
  filteredGroups.value.reduce((total, group) => total + group.terms.length, 0),
)

const totalTermCount = computed(() =>
  categories.value.reduce((total, category) => total + category.terms.length, 0),
)

const selectedTermIds = computed(() => new Set(selected.value.map((item) => item.term.id)))

const enabledCount = computed(() =>
  categories.value.filter(
    (category) =>
      enabledCategoryIds.value.includes(category.id) && category.terms.length > 0,
  ).length,
)

watch(
  [selected, outputLanguage],
  () => {
    promptText.value = composePrompt(selected.value, outputLanguage.value)
  },
  { deep: true },
)

watch(
  [categories, enabledCategoryIds],
  () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        categories: categories.value,
        enabledCategoryIds: enabledCategoryIds.value,
      }),
    )
  },
  { deep: true },
)

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return

  try {
    const parsed = JSON.parse(saved) as {
      categories?: unknown
      enabledCategoryIds?: unknown
    }

    if (isPromptCategoryArray(parsed.categories)) {
      categories.value = clonePromptCategories(parsed.categories)
      const availableIds = new Set(categories.value.map((category) => category.id))
      enabledCategoryIds.value = Array.isArray(parsed.enabledCategoryIds)
        ? parsed.enabledCategoryIds.filter(
            (id): id is string => typeof id === 'string' && availableIds.has(id),
          )
        : categories.value.map((category) => category.id)
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
})

function isPromptCategoryArray(value: unknown): value is PromptCategory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (category) =>
        category &&
        typeof category === 'object' &&
        typeof category.id === 'string' &&
        typeof category.nameZh === 'string' &&
        typeof category.nameEn === 'string' &&
        typeof category.icon === 'string' &&
        Array.isArray(category.terms) &&
        category.terms.every(
          (item: unknown) =>
            item &&
            typeof item === 'object' &&
            typeof (item as PromptTerm).id === 'string' &&
            typeof (item as PromptTerm).zh === 'string' &&
            typeof (item as PromptTerm).en === 'string',
        ),
    )
  )
}

function selectTerm(category: PromptCategory, item: PromptTerm) {
  const existingIndex = selected.value.findIndex((entry) => entry.term.id === item.id)
  if (existingIndex >= 0) {
    selected.value.splice(existingIndex, 1)
    return
  }

  selected.value.push({
    categoryId: category.id,
    categoryNameZh: category.nameZh,
    categoryNameEn: category.nameEn,
    term: { ...item },
  })
}

function removeSelected(index: number) {
  selected.value.splice(index, 1)
}

function randomizePrompt() {
  selected.value = createRandomSelection(
    categories.value,
    enabledCategoryIds.value,
  )
}

function clearPrompt() {
  selected.value = []
  promptText.value = ''
}

async function copyPrompt() {
  if (!promptText.value.trim()) return

  try {
    await navigator.clipboard.writeText(promptText.value)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }

  window.setTimeout(() => {
    copyState.value = 'idle'
  }, 1800)
}

function isCategoryEnabled(categoryId: string): boolean {
  return enabledCategoryIds.value.includes(categoryId)
}

function setCategoryEnabled(categoryId: string, enabled: boolean) {
  if (enabled && !enabledCategoryIds.value.includes(categoryId)) {
    enabledCategoryIds.value.push(categoryId)
  } else if (!enabled) {
    enabledCategoryIds.value = enabledCategoryIds.value.filter((id) => id !== categoryId)
  }
}

function startAddCategory() {
  editorMode.value = 'add'
  editingCategoryId.value = ''
  categoryForm.nameZh = ''
  categoryForm.nameEn = ''
  categoryForm.termsText = ''
  showCategoryEditor.value = true
}

function startEditCategory(category: PromptCategory) {
  editorMode.value = 'edit'
  editingCategoryId.value = category.id
  categoryForm.nameZh = category.nameZh
  categoryForm.nameEn = category.nameEn
  categoryForm.termsText = category.terms
    .map((item) => `${item.zh} | ${item.en}`)
    .join('\n')
  showCategoryEditor.value = true
}

function parseTerms(text: string, categoryId: string): PromptTerm[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = line.indexOf('|')
      const zh = (separatorIndex >= 0 ? line.slice(0, separatorIndex) : line).trim()
      const en = (separatorIndex >= 0 ? line.slice(separatorIndex + 1) : line).trim()
      return {
        id: `${categoryId}-${Date.now()}-${index}`,
        zh,
        en: en || zh,
      }
    })
    .filter((item) => item.zh)
}

function saveCategory() {
  const nameZh = categoryForm.nameZh.trim()
  const nameEn = categoryForm.nameEn.trim() || nameZh
  if (!nameZh) return

  if (editorMode.value === 'edit') {
    const category = categories.value.find((item) => item.id === editingCategoryId.value)
    if (!category) return

    category.nameZh = nameZh
    category.nameEn = nameEn
    category.terms = parseTerms(categoryForm.termsText, category.id)

    selected.value = selected.value
      .filter((entry) => entry.categoryId !== category.id)
  } else {
    const categoryId = `custom-${Date.now()}`
    categories.value.push({
      id: categoryId,
      nameZh,
      nameEn,
      icon: 'i-carbon-bookmark-add',
      custom: true,
      terms: parseTerms(categoryForm.termsText, categoryId),
    })
    enabledCategoryIds.value.push(categoryId)
  }

  showCategoryEditor.value = false
}

function deleteCategory(category: PromptCategory) {
  const confirmed = window.confirm(`确定删除“${category.nameZh}”分类吗？可通过“恢复内置分类”重置。`)
  if (!confirmed) return

  categories.value = categories.value.filter((item) => item.id !== category.id)
  enabledCategoryIds.value = enabledCategoryIds.value.filter((id) => id !== category.id)
  selected.value = selected.value.filter((entry) => entry.categoryId !== category.id)
  if (activeCategoryId.value === category.id) activeCategoryId.value = 'all'
}

function moveCategory(index: number, offset: -1 | 1) {
  const nextIndex = index + offset
  if (nextIndex < 0 || nextIndex >= categories.value.length) return

  const reordered = [...categories.value]
  const [category] = reordered.splice(index, 1)
  reordered.splice(nextIndex, 0, category)
  categories.value = reordered
}

function resetCategories() {
  const confirmed = window.confirm('确定恢复全部内置分类和词条吗？自定义内容将被清除。')
  if (!confirmed) return

  categories.value = clonePromptCategories()
  enabledCategoryIds.value = categories.value.map((category) => category.id)
  activeCategoryId.value = 'all'
  selected.value = []
}
</script>

<template>
  <div class="prompt-composer">
    <header class="hero">
      <div>
        <div class="eyebrow">
          <span class="eyebrow-icon i-carbon-ai-generate" />
          PROMPT STUDIO
        </div>
        <h2>把灵感，组合成完整提示词</h2>
        <p>浏览 {{ totalTermCount }} 条中英文词条，按分类自由点选，或让组合器为你制造一次意外。</p>
      </div>
      <div class="hero-actions">
        <NButton secondary @click="showCategoryManager = true">
          <template #icon><span class="i-carbon-settings-adjust" /></template>
          管理分类
        </NButton>
        <NButton
          type="primary"
          color="#6d5dfc"
          :disabled="enabledCount === 0"
          @click="randomizePrompt"
        >
          <template #icon><span class="i-carbon-shuffle" /></template>
          随机组合
        </NButton>
      </div>
    </header>

    <div class="workspace">
      <section class="library-panel">
        <div class="panel-heading">
          <div>
            <span class="step-label">01 · 灵感词库</span>
            <h3>找到想要的描述</h3>
          </div>
          <span class="result-count">{{ visibleTermCount }} 条结果</span>
        </div>

        <NInput
          v-model:value="searchQuery"
          clearable
          size="large"
          placeholder="搜索中文或英文，如：逆光、cinematic、85mm…"
          class="search-input"
        >
          <template #prefix><span class="i-carbon-search search-icon" /></template>
        </NInput>

        <div class="library-body">
          <nav class="category-nav" aria-label="提示词分类">
            <button
              type="button"
              :class="['category-button', { active: activeCategoryId === 'all' }]"
              @click="activeCategoryId = 'all'"
            >
              <span class="category-icon i-carbon-category" />
              <span>
                <strong>全部分类</strong>
                <small>All categories</small>
              </span>
              <b>{{ totalTermCount }}</b>
            </button>
            <button
              v-for="category in categories"
              :key="category.id"
              type="button"
              :class="['category-button', { active: activeCategoryId === category.id }]"
              @click="activeCategoryId = category.id"
            >
              <span :class="['category-icon', category.icon]" />
              <span>
                <strong>{{ category.nameZh }}</strong>
                <small>{{ category.nameEn }}</small>
              </span>
              <b>{{ category.terms.length }}</b>
            </button>
          </nav>

          <div class="term-browser">
            <template v-if="filteredGroups.length">
              <section
                v-for="group in filteredGroups"
                :key="group.category.id"
                class="term-group"
              >
                <div class="term-group-title">
                  <span :class="group.category.icon" />
                  <strong>{{ group.category.nameZh }}</strong>
                  <span>{{ group.category.nameEn }}</span>
                </div>
                <div class="term-grid">
                  <button
                    v-for="item in group.terms"
                    :key="item.id"
                    type="button"
                    :class="['term-card', { selected: selectedTermIds.has(item.id) }]"
                    :aria-pressed="selectedTermIds.has(item.id)"
                    @click="selectTerm(group.category, item)"
                  >
                    <span class="term-check i-carbon-checkmark" />
                    <strong>{{ item.zh }}</strong>
                    <small>{{ item.en }}</small>
                  </button>
                </div>
              </section>
            </template>
            <NEmpty v-else description="没有找到匹配的提示词，试试缩短关键词">
              <template #icon><span class="i-carbon-search-locate empty-icon" /></template>
            </NEmpty>
          </div>
        </div>
      </section>

      <aside class="composer-panel">
        <div class="composer-topline">
          <div>
            <span class="step-label light">02 · 提示词组合</span>
            <h3>组合结果</h3>
          </div>
          <span class="enabled-count">{{ enabledCount }} 个分类已启用</span>
        </div>

        <div class="random-callout">
          <span class="random-icon i-carbon-shuffle" />
          <div>
            <strong>不知道从哪里开始？</strong>
            <p>每个启用分类随机抽取一项，可在分类管理中自由增减。</p>
          </div>
          <button
            type="button"
            :disabled="enabledCount === 0"
            aria-label="随机组合提示词"
            @click="randomizePrompt"
          >
            <span class="i-carbon-arrow-right" />
          </button>
        </div>

        <div class="selection-block">
          <div class="section-label">
            <span>已选词条</span>
            <button v-if="selected.length" type="button" @click="clearPrompt">清空</button>
          </div>
          <div v-if="selected.length" class="selected-list">
            <button
              v-for="(item, index) in selected"
              :key="`${item.term.id}-${index}`"
              type="button"
              class="selected-chip"
              :title="`移除：${item.term.zh}`"
              @click="removeSelected(index)"
            >
              <small>{{ item.categoryNameZh }}</small>
              <span>{{ item.term.zh }}</span>
              <i class="i-carbon-close" />
            </button>
          </div>
          <div v-else class="selection-empty">
            <span class="i-carbon-add-alt" />
            从左侧点选词条，或点击随机组合
          </div>
        </div>

        <div class="language-row">
          <span>输出语言</span>
          <NRadioGroup v-model:value="outputLanguage" size="small">
            <NRadioButton
              v-for="option in languageOptions"
              :key="option.value"
              :value="option.value"
              :label="option.label"
            />
          </NRadioGroup>
        </div>

        <div class="output-block">
          <NInput
            v-model:value="promptText"
            type="textarea"
            placeholder="组合后的完整 Prompt 会出现在这里，也可以继续自由编辑…"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
          <div class="output-meta">
            <span>{{ promptText.length }} 字符</span>
            <span>支持自由编辑</span>
          </div>
        </div>

        <div class="composer-actions">
          <NButton
            block
            size="large"
            type="primary"
            color="#6d5dfc"
            :disabled="!promptText.trim()"
            @click="copyPrompt"
          >
            <template #icon>
              <span :class="copyState === 'copied' ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
            </template>
            {{
              copyState === 'copied'
                ? '已复制到剪贴板'
                : copyState === 'failed'
                  ? '复制失败，请手动复制'
                  : '复制完整 Prompt'
            }}
          </NButton>
          <NButton size="large" :disabled="enabledCount === 0" @click="randomizePrompt">
            <template #icon><span class="i-carbon-renew" /></template>
            换一组
          </NButton>
        </div>
      </aside>
    </div>

    <NModal
      v-model:show="showCategoryManager"
      preset="card"
      title="组合分类管理"
      class="category-modal"
      :style="{ width: 'min(720px, calc(100vw - 32px))' }"
    >
      <div class="manager-intro">
        <p>开关决定随机组合时是否使用该分类。拖动顺序由上下按钮调整，也会影响最终 Prompt 的排列。</p>
        <NButton type="primary" ghost size="small" @click="startAddCategory">
          <template #icon><span class="i-carbon-add" /></template>
          新增分类
        </NButton>
      </div>

      <div class="manager-list">
        <div
          v-for="(category, index) in categories"
          :key="category.id"
          class="manager-row"
        >
          <NSwitch
            :value="isCategoryEnabled(category.id)"
            :disabled="category.terms.length === 0"
            @update:value="setCategoryEnabled(category.id, $event)"
          />
          <span :class="['manager-icon', category.icon]" />
          <div class="manager-name">
            <strong>{{ category.nameZh }}</strong>
            <small>{{ category.nameEn }} · {{ category.terms.length }} 条</small>
          </div>
          <div class="manager-buttons">
            <button
              type="button"
              :disabled="index === 0"
              aria-label="上移分类"
              @click="moveCategory(index, -1)"
            >
              <span class="i-carbon-arrow-up" />
            </button>
            <button
              type="button"
              :disabled="index === categories.length - 1"
              aria-label="下移分类"
              @click="moveCategory(index, 1)"
            >
              <span class="i-carbon-arrow-down" />
            </button>
            <button type="button" aria-label="编辑分类" @click="startEditCategory(category)">
              <span class="i-carbon-edit" />
            </button>
            <button
              type="button"
              class="danger"
              aria-label="删除分类"
              @click="deleteCategory(category)"
            >
              <span class="i-carbon-trash-can" />
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <NButton text type="error" @click="resetCategories">恢复内置分类</NButton>
          <NButton @click="showCategoryManager = false">完成</NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="showCategoryEditor"
      preset="card"
      :title="editorMode === 'add' ? '新增提示词分类' : '编辑提示词分类'"
      :style="{ width: 'min(620px, calc(100vw - 32px))' }"
    >
      <div class="editor-form">
        <label>
          <span>中文分类名</span>
          <NInput v-model:value="categoryForm.nameZh" placeholder="例如：天气与氛围" />
        </label>
        <label>
          <span>英文分类名</span>
          <NInput v-model:value="categoryForm.nameEn" placeholder="例如：Weather & Atmosphere" />
        </label>
        <label>
          <span>分类词条</span>
          <NInput
            v-model:value="categoryForm.termsText"
            type="textarea"
            placeholder="每行一条，使用“中文 | English”格式&#10;细雨与薄雾 | light rain and mist&#10;晴朗的蓝天 | clear blue sky"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
          <small>每行一条；没有英文时可只填写一段文字。</small>
        </label>
      </div>

      <template #footer>
        <div class="modal-footer">
          <NButton @click="showCategoryEditor = false">取消</NButton>
          <NButton
            type="primary"
            color="#6d5dfc"
            :disabled="!categoryForm.nameZh.trim()"
            @click="saveCategory"
          >
            保存分类
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.prompt-composer {
  --purple: #6d5dfc;
  --purple-dark: #5145cd;
  --purple-soft: #f1efff;
  --ink: #202033;
  --muted: #6f7185;
  --line: #e8e7ef;
  min-width: 0;
  color: var(--ink);
}

.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding: 24px 28px;
  border: 1px solid #e4e0ff;
  border-radius: 18px;
  background:
    radial-gradient(circle at 86% 15%, rgb(130 111 255 / 0.18), transparent 30%),
    linear-gradient(120deg, #fbfaff 0%, #f3f0ff 100%);
}

.hero::after {
  position: absolute;
  right: 34%;
  bottom: -54px;
  width: 150px;
  height: 150px;
  border: 28px solid rgb(109 93 252 / 0.06);
  border-radius: 50%;
  content: '';
  pointer-events: none;
}

.eyebrow,
.step-label {
  color: var(--purple);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
}

.eyebrow-icon {
  font-size: 15px;
}

.hero h2 {
  margin: 5px 0 7px;
  font-size: clamp(24px, 2.2vw, 34px);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.hero p {
  color: var(--muted);
  font-size: 13px;
}

.hero-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.75fr);
  gap: 18px;
  align-items: start;
}

.library-panel,
.composer-panel {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 34px rgb(31 31 51 / 0.05);
}

.library-panel {
  min-width: 0;
  padding: 22px;
}

.panel-heading,
.composer-topline,
.section-label,
.language-row,
.modal-footer,
.manager-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading h3,
.composer-topline h3 {
  margin-top: 2px;
  font-size: 19px;
}

.result-count,
.enabled-count {
  padding: 5px 9px;
  border-radius: 999px;
  background: #f5f4f8;
  color: var(--muted);
  font-size: 11px;
}

.search-input {
  margin: 17px 0;
}

.search-icon {
  color: var(--purple);
  font-size: 18px;
}

.library-body {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  min-height: 560px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

.category-nav {
  max-height: 680px;
  overflow-y: auto;
  padding: 8px;
  border-right: 1px solid var(--line);
  background: #faf9fc;
}

.category-button {
  width: 100%;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 10px 8px;
  border: 0;
  border-radius: 9px;
  color: #4b4c5e;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: 0.15s ease;
}

.category-button:hover {
  background: #f1eff7;
}

.category-button.active {
  color: var(--purple-dark);
  background: #ece9ff;
}

.category-button > span:nth-child(2) {
  min-width: 0;
}

.category-button strong,
.category-button small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-button strong {
  font-size: 12px;
  font-weight: 650;
}

.category-button small {
  margin-top: 1px;
  color: #9999a8;
  font-size: 9px;
}

.category-button b {
  color: #aaa8b7;
  font-size: 10px;
}

.category-icon {
  color: currentColor;
  font-size: 17px;
}

.term-browser {
  max-height: 680px;
  overflow-y: auto;
  padding: 16px;
}

.term-group + .term-group {
  margin-top: 22px;
}

.term-group-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  color: #3c3c4d;
  font-size: 12px;
}

.term-group-title > span:first-child {
  color: var(--purple);
  font-size: 15px;
}

.term-group-title > span:last-child {
  color: #aaa8b5;
  font-size: 10px;
}

.term-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.term-card {
  position: relative;
  min-width: 0;
  padding: 11px 30px 11px 12px;
  border: 1px solid #e9e7ee;
  border-radius: 10px;
  color: #343443;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.term-card:hover {
  border-color: #bfb8ff;
  box-shadow: 0 5px 14px rgb(73 60 181 / 0.08);
  transform: translateY(-1px);
}

.term-card.selected {
  border-color: var(--purple);
  background: #f7f5ff;
  box-shadow: inset 0 0 0 1px var(--purple);
}

.term-card strong,
.term-card small {
  display: block;
}

.term-card strong {
  font-size: 12px;
  line-height: 1.45;
}

.term-card small {
  margin-top: 4px;
  color: #9291a0;
  font-size: 10px;
  line-height: 1.35;
}

.term-check {
  position: absolute;
  top: 11px;
  right: 10px;
  display: none;
  color: var(--purple);
}

.term-card.selected .term-check {
  display: block;
}

.empty-icon {
  font-size: 30px;
}

.composer-panel {
  position: sticky;
  top: 0;
  overflow: hidden;
  padding: 22px;
}

.step-label.light {
  color: #b2aaff;
}

.composer-topline {
  margin: -22px -22px 0;
  padding: 21px 22px 18px;
  color: #fff;
  background:
    radial-gradient(circle at 90% 10%, rgb(255 255 255 / 0.16), transparent 24%),
    linear-gradient(135deg, #26233e, #36304e);
}

.composer-topline .enabled-count {
  color: #d9d5ef;
  background: rgb(255 255 255 / 0.1);
}

.random-callout {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
  padding: 13px;
  border: 1px solid #ded9ff;
  border-radius: 12px;
  background: linear-gradient(135deg, #f6f4ff, #fbfaff);
}

.random-icon {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  background: var(--purple);
  font-size: 17px;
}

.random-callout strong {
  font-size: 12px;
}

.random-callout p {
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
}

.random-callout button,
.manager-buttons button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.random-callout button {
  width: 30px;
  height: 30px;
  color: var(--purple);
  background: #eae6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.selection-block {
  margin-bottom: 17px;
}

.section-label,
.language-row {
  margin-bottom: 9px;
  color: #545466;
  font-size: 11px;
  font-weight: 650;
}

.section-label button {
  border: 0;
  color: var(--purple);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}

.selected-list {
  display: flex;
  max-height: 178px;
  flex-wrap: wrap;
  gap: 7px;
  overflow-y: auto;
  padding-right: 2px;
}

.selected-chip {
  display: inline-grid;
  grid-template-columns: auto auto;
  gap: 1px 6px;
  align-items: center;
  max-width: 100%;
  padding: 6px 8px;
  border: 1px solid #e2defd;
  border-radius: 9px;
  color: #48435e;
  background: #f7f5ff;
  text-align: left;
  cursor: pointer;
}

.selected-chip small {
  grid-column: 1;
  color: #918aa8;
  font-size: 8px;
}

.selected-chip span {
  grid-column: 1;
  overflow: hidden;
  font-size: 10px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-chip i {
  grid-column: 2;
  grid-row: 1 / 3;
  color: #9b95b2;
}

.selection-empty {
  display: flex;
  min-height: 74px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px dashed #d9d6e1;
  border-radius: 10px;
  color: #a09eac;
  font-size: 11px;
}

.language-row {
  margin-top: 4px;
}

.output-block {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #fafafa;
}

.output-block :deep(.n-input) {
  --n-border: 0 !important;
  --n-border-hover: 0 !important;
  --n-border-focus: 0 !important;
  --n-box-shadow-focus: none !important;
  border-radius: 0;
  background: transparent;
}

.output-block :deep(textarea) {
  font-size: 12px;
  line-height: 1.7;
}

.output-meta {
  display: flex;
  justify-content: space-between;
  padding: 7px 11px;
  border-top: 1px solid var(--line);
  color: #aaa8b4;
  font-size: 9px;
}

.composer-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px;
  margin-top: 14px;
}

.category-modal {
  max-height: calc(100vh - 48px);
}

.manager-intro {
  margin-bottom: 14px;
}

.manager-intro p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.manager-list {
  max-height: 54vh;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
}

.manager-row {
  display: grid;
  grid-template-columns: auto 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
}

.manager-row + .manager-row {
  border-top: 1px solid var(--line);
}

.manager-icon {
  color: var(--purple);
  font-size: 18px;
}

.manager-name strong,
.manager-name small {
  display: block;
}

.manager-name strong {
  font-size: 13px;
}

.manager-name small {
  margin-top: 2px;
  color: #9997a5;
  font-size: 10px;
}

.manager-buttons {
  display: flex;
  gap: 4px;
}

.manager-buttons button {
  width: 28px;
  height: 28px;
  color: #6d6b78;
  background: #f4f3f6;
}

.manager-buttons button:hover {
  color: var(--purple);
  background: #eeebff;
}

.manager-buttons button.danger:hover {
  color: #d03050;
  background: #fff0f3;
}

.editor-form {
  display: grid;
  gap: 15px;
}

.editor-form label > span {
  display: block;
  margin-bottom: 6px;
  color: #555465;
  font-size: 12px;
  font-weight: 650;
}

.editor-form label > small {
  display: block;
  margin-top: 5px;
  color: #9b99a5;
  font-size: 10px;
}

@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .composer-panel {
    position: static;
  }
}

@media (max-width: 760px) {
  .hero {
    align-items: flex-start;
    flex-direction: column;
    padding: 20px;
  }

  .hero-actions {
    width: 100%;
  }

  .library-panel {
    padding: 15px;
  }

  .library-body {
    grid-template-columns: 1fr;
  }

  .category-nav {
    display: flex;
    max-height: none;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .category-button {
    width: 155px;
    flex: 0 0 auto;
  }

  .term-browser {
    max-height: none;
  }

  .term-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .hero-actions,
  .composer-actions,
  .manager-intro {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions :deep(.n-button) {
    flex: 1;
  }

  .composer-actions {
    grid-template-columns: 1fr;
  }

  .language-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .manager-row {
    grid-template-columns: auto 20px minmax(0, 1fr);
  }

  .manager-buttons {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
