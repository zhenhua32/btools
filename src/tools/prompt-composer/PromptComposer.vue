<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
} from 'naive-ui'
import {
  clonePromptCategories,
  composePrompt,
  countAllPromptTerms,
  createRandomSelection,
  filterPromptCategories,
  findPromptCategory,
  flattenPromptCategories,
  getPromptLeafCategories,
  type PromptCategory,
  type PromptLanguage,
  type PromptTerm,
  type SelectedPrompt,
} from '@/services/prompt-composer'
import CategoryTreeNode from './CategoryTreeNode.vue'

const STORAGE_KEY = 'btools-prompt-composer-v4'
const LEGACY_STORAGE_KEYS = [
  'btools-prompt-composer-v3',
  'btools-prompt-composer-v2',
  'btools-prompt-composer-v1',
]
const DEFAULT_ENABLED_CATEGORY_IDS = [
  'subject-age',
  'subject-gender',
  'subject-industry',
  'subject-profession',
  'subject-beauty-aura',
  'subject-beauty-face',
  'scene-nature',
  'scene-time',
  'action-motion',
  'action-expression',
  'wardrobe-garment',
  'wardrobe-material',
  'camera-shot',
  'camera-focal-length',
  'lighting-source',
  'composition-structure',
  'style-medium',
  'constraints-negative',
]

const categories = ref<PromptCategory[]>(clonePromptCategories())
const enabledCategoryIds = ref([...DEFAULT_ENABLED_CATEGORY_IDS])
const activeCategoryId = ref('subject')
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
  parentId: 'root',
})

const languageOptions: Array<{ label: string; value: PromptLanguage }> = [
  { label: '中英对照', value: 'bilingual' },
  { label: '仅中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

const filteredGroups = computed(() =>
  filterPromptCategories(
    categories.value,
    searchQuery.value,
    searchQuery.value.trim() ? 'all' : activeCategoryId.value,
  ),
)

const visibleTermCount = computed(() =>
  filteredGroups.value.reduce((total, group) => total + group.terms.length, 0),
)

const totalTermCount = computed(() =>
  countAllPromptTerms(categories.value),
)

const selectedTermIds = computed(() => new Set(selected.value.map((item) => item.term.id)))

const enabledCount = computed(() =>
  getPromptLeafCategories(categories.value).filter(
    (category) =>
      enabledCategoryIds.value.includes(category.id) && category.terms.length > 0,
  ).length,
)

const rootCategoryOptions = computed(() => [
  { label: '根目录（作为大类别）', value: 'root' },
  ...categories.value.map((category) => ({
    label: `${category.nameZh} / ${category.nameEn}`,
    value: category.id,
  })),
])

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
  const currentSaved = localStorage.getItem(STORAGE_KEY)
  const legacyKey = LEGACY_STORAGE_KEYS.find((key) => localStorage.getItem(key))
  const legacySaved = legacyKey ? localStorage.getItem(legacyKey) : null
  const saved = currentSaved ?? legacySaved
  if (!saved) return

  try {
    const parsed = JSON.parse(saved) as {
      categories?: unknown
      enabledCategoryIds?: unknown
    }

    if (isPromptCategoryArray(parsed.categories) && currentSaved) {
      categories.value = clonePromptCategories(parsed.categories)
      const availableIds = new Set(
        flattenPromptCategories(categories.value).map((category) => category.id),
      )
      enabledCategoryIds.value = Array.isArray(parsed.enabledCategoryIds)
        ? parsed.enabledCategoryIds.filter(
            (id): id is string => typeof id === 'string' && availableIds.has(id),
          )
        : [...DEFAULT_ENABLED_CATEGORY_IDS]
    } else if (isPromptCategoryArray(parsed.categories)) {
      const customCategories = flattenPromptCategories(parsed.categories).filter(
        (category) => category.custom || category.id.startsWith('custom-'),
      )
      categories.value = [
        ...clonePromptCategories(),
        ...clonePromptCategories(customCategories),
      ]
      const enabledLegacyIds = Array.isArray(parsed.enabledCategoryIds)
        ? new Set(parsed.enabledCategoryIds.filter((id): id is string => typeof id === 'string'))
        : new Set<string>()
      enabledCategoryIds.value = [
        ...DEFAULT_ENABLED_CATEGORY_IDS,
        ...customCategories
          .filter((category) => enabledLegacyIds.has(category.id))
          .map((category) => category.id),
      ]
      for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
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
        ) &&
        (
          category.children === undefined ||
          isPromptCategoryArray(category.children)
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

function startAddCategory(parentId = 'root') {
  editorMode.value = 'add'
  editingCategoryId.value = ''
  categoryForm.nameZh = ''
  categoryForm.nameEn = ''
  categoryForm.termsText = ''
  categoryForm.parentId = parentId
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
    const category = findPromptCategory(categories.value, editingCategoryId.value)
    if (!category) return

    category.nameZh = nameZh
    category.nameEn = nameEn
    category.terms = parseTerms(categoryForm.termsText, category.id)

    selected.value = selected.value
      .filter((entry) => entry.categoryId !== category.id)
  } else {
    const categoryId = `custom-${Date.now()}`
    const newCategory: PromptCategory = {
      id: categoryId,
      nameZh,
      nameEn,
      icon: 'i-carbon-bookmark-add',
      custom: true,
      terms: parseTerms(categoryForm.termsText, categoryId),
    }
    const parent =
      categoryForm.parentId === 'root'
        ? undefined
        : findPromptCategory(categories.value, categoryForm.parentId)

    if (parent) {
      parent.children ??= []
      parent.children.push(newCategory)
    } else {
      categories.value.push(newCategory)
    }

    if (newCategory.terms.length > 0) enabledCategoryIds.value.push(categoryId)
  }

  showCategoryEditor.value = false
}

function deleteCategory(category: PromptCategory) {
  const confirmed = window.confirm(`确定删除“${category.nameZh}”分类吗？可通过“恢复内置分类”重置。`)
  if (!confirmed) return

  const removedIds = new Set(
    flattenPromptCategories([category]).map((item) => item.id),
  )

  function removeFromTree(items: PromptCategory[]): PromptCategory[] {
    return items
      .filter((item) => item.id !== category.id)
      .map((item) => ({
        ...item,
        children: item.children ? removeFromTree(item.children) : undefined,
      }))
  }

  categories.value = removeFromTree(categories.value)
  enabledCategoryIds.value = enabledCategoryIds.value.filter(
    (id) => !removedIds.has(id),
  )
  selected.value = selected.value.filter(
    (entry) => !removedIds.has(entry.categoryId),
  )
  if (removedIds.has(activeCategoryId.value)) activeCategoryId.value = 'all'
}

function resetCategories() {
  const confirmed = window.confirm('确定恢复全部内置分类和词条吗？自定义内容将被清除。')
  if (!confirmed) return

  categories.value = clonePromptCategories()
  enabledCategoryIds.value = [...DEFAULT_ENABLED_CATEGORY_IDS]
  activeCategoryId.value = 'subject'
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
        <p>浏览 {{ totalTermCount }} 条中英文原子词，按目录自由点选，再组合成完整 Prompt。</p>
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
            <CategoryTreeNode
              v-for="category in categories"
              :key="category.id"
              :category="category"
              :active-id="activeCategoryId"
              @select="activeCategoryId = $event"
            />
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
                  <strong>{{ group.pathZh }}</strong>
                  <span>{{ group.pathEn }}</span>
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
          <span class="enabled-count">{{ enabledCount }} 个小类别已启用</span>
        </div>

        <div class="random-callout">
          <span class="random-icon i-carbon-shuffle" />
          <div>
            <strong>不知道从哪里开始？</strong>
            <p>每个启用的小类别随机抽取一个原子词，可在分类管理中自由增减。</p>
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
      title="目录与随机分类管理"
      class="category-modal"
      :style="{ width: 'min(720px, calc(100vw - 32px))' }"
    >
      <div class="manager-intro">
        <p>目录用于组织词库；只有包含词条的小类别会参与随机组合。可为任意大类别增加子目录。</p>
        <NButton type="primary" ghost size="small" @click="startAddCategory('root')">
          <template #icon><span class="i-carbon-add" /></template>
          新增大类别
        </NButton>
      </div>

      <div class="manager-list">
        <div v-for="category in categories" :key="category.id" class="manager-group">
          <div class="manager-row manager-root-row">
            <NSwitch
              v-if="category.terms.length > 0"
              :value="isCategoryEnabled(category.id)"
              @update:value="setCategoryEnabled(category.id, $event)"
            />
            <span v-else class="manager-switch-placeholder" />
            <span class="manager-icon i-carbon-folder" />
            <div class="manager-name">
              <strong>{{ category.nameZh }}</strong>
              <small>
                {{ category.nameEn }} ·
                {{ countAllPromptTerms([category]) }} 条原子词
              </small>
            </div>
            <div class="manager-buttons">
              <button
                type="button"
                aria-label="新增子类别"
                title="新增子类别"
                @click="startAddCategory(category.id)"
              >
                <span class="i-carbon-add" />
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

          <div
            v-for="child in flattenPromptCategories(category.children ?? [])"
            :key="child.id"
            class="manager-row manager-child-row"
          >
            <NSwitch
              :value="isCategoryEnabled(child.id)"
              :disabled="child.terms.length === 0"
              @update:value="setCategoryEnabled(child.id, $event)"
            />
            <span :class="['manager-icon', child.icon]" />
            <div class="manager-name">
              <strong>{{ child.nameZh }}</strong>
              <small>{{ child.nameEn }} · {{ child.terms.length }} 条</small>
            </div>
            <div class="manager-buttons">
              <button type="button" aria-label="编辑分类" @click="startEditCategory(child)">
                <span class="i-carbon-edit" />
              </button>
              <button
                type="button"
                class="danger"
                aria-label="删除分类"
                @click="deleteCategory(child)"
              >
                <span class="i-carbon-trash-can" />
              </button>
            </div>
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
        <label v-if="editorMode === 'add'">
          <span>上级目录</span>
          <NSelect
            v-model:value="categoryForm.parentId"
            :options="rootCategoryOptions"
          />
        </label>
        <label>
          <span>中文分类名</span>
          <NInput v-model:value="categoryForm.nameZh" placeholder="例如：天气状态" />
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
            placeholder="每行一个原子词，使用“中文 | English”格式&#10;细雨 | drizzle&#10;薄雾 | mist"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
          <small>不要预先组合多个维度；例如年龄、性别、行业和职业应分别放入不同子类别。</small>
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
  grid-template-columns: 235px minmax(0, 1fr);
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

.category-nav :deep(.tree-node) {
  width: 100%;
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
  grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
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

.manager-group + .manager-group {
  border-top: 1px solid var(--line);
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

.manager-root-row {
  background: #faf9fc;
}

.manager-child-row {
  padding-left: 36px;
}

.manager-switch-placeholder {
  width: 28px;
  height: 1px;
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
    display: block;
    max-height: 280px;
    overflow-x: hidden;
    overflow-y: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .category-button {
    width: 100%;
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
