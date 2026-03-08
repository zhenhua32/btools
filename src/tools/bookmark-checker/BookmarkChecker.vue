<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { h } from 'vue'
import {
  NButton,
  NSpace,
  NText,
  NDataTable,
  NTag,
  NProgress,
  NAlert,
  NInputNumber,
  NPopconfirm,
  NTree,
  NEmpty,
  type DataTableColumns,
  type TreeOption,
} from 'naive-ui'

// ---- 类型 ----

interface BookmarkItem {
  id: string
  title: string
  url: string
  path: string
  folderId: string
  status: 'pending' | 'checking' | 'valid' | 'invalid' | 'timeout' | 'error'
  statusCode?: number
  errorMsg?: string
  checkedAt?: number
}

interface StoredResult {
  status: 'valid' | 'invalid' | 'timeout' | 'error'
  statusCode?: number
  errorMsg?: string
  checkedAt: number
}

const STORAGE_KEY = 'bookmark-check-results'

// ---- 状态 ----

const allBookmarks = ref<BookmarkItem[]>([])
const folderTree = ref<TreeOption[]>([])
const selectedFolderId = ref<string | null>(null)
const checking = ref(false)
const loaded = ref(false)
const concurrency = ref(5)
const timeoutMs = ref(10000)
const lastCheckTime = ref<string>('')

// 当前展示的书签（按选中目录过滤）
const bookmarks = computed(() => {
  if (!selectedFolderId.value) return allBookmarks.value
  return allBookmarks.value.filter((b: BookmarkItem) => b.folderId === selectedFolderId.value)
})

// 统计（基于当前过滤后的列表）
const stats = computed(() => {
  const list = bookmarks.value
  const total = list.length
  const valid = list.filter((b: BookmarkItem) => b.status === 'valid').length
  const invalid = list.filter((b: BookmarkItem) => b.status === 'invalid' || b.status === 'timeout' || b.status === 'error').length
  const checked = list.filter((b: BookmarkItem) => b.status !== 'pending' && b.status !== 'checking').length
  return { total, valid, invalid, checked }
})

const progress = computed(() => {
  if (stats.value.total === 0) return 0
  return Math.round((stats.value.checked / stats.value.total) * 100)
})

const selectedFolderLabel = computed(() => {
  if (!selectedFolderId.value) return '全部书签'
  function find(nodes: TreeOption[]): string | null {
    for (const n of nodes) {
      if (n.key === selectedFolderId.value) return n.label as string
      if (n.children) {
        const found = find(n.children)
        if (found) return found
      }
    }
    return null
  }
  return find(folderTree.value) || '全部书签'
})

// ---- 持久化 ----

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

async function saveResults() {
  if (!hasStorage()) return
  const map: Record<string, StoredResult> = {}
  for (const b of allBookmarks.value) {
    if (b.status !== 'pending' && b.status !== 'checking') {
      map[b.id] = {
        status: b.status,
        statusCode: b.statusCode,
        errorMsg: b.errorMsg,
        checkedAt: b.checkedAt || Date.now(),
      }
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: map, [`${STORAGE_KEY}-time`]: new Date().toLocaleString() })
}

async function loadResults(): Promise<Record<string, StoredResult>> {
  if (!hasStorage()) return {}
  const data = await chrome.storage.local.get([STORAGE_KEY, `${STORAGE_KEY}-time`])
  if (data[`${STORAGE_KEY}-time`]) {
    lastCheckTime.value = data[`${STORAGE_KEY}-time`]
  }
  return (data[STORAGE_KEY] as Record<string, StoredResult>) || {}
}

function applyStoredResults(stored: Record<string, StoredResult>) {
  for (const b of allBookmarks.value) {
    const r = stored[b.id]
    if (r) {
      b.status = r.status
      b.statusCode = r.statusCode
      b.errorMsg = r.errorMsg
      b.checkedAt = r.checkedAt
    }
  }
}

// ---- 构建目录树 ----

function buildFolderTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): TreeOption[] {
  const result: TreeOption[] = []
  for (const node of nodes) {
    if (!node.url && node.children) {
      const children = buildFolderTree(node.children)
      // 统计该目录下（含子目录）的书签数
      const count = countBookmarks(node)
      result.push({
        key: node.id,
        label: `${node.title || '根目录'} (${count})`,
        children: children.length > 0 ? children : undefined,
      })
    }
  }
  return result
}

function countBookmarks(node: chrome.bookmarks.BookmarkTreeNode): number {
  let count = 0
  if (node.children) {
    for (const child of node.children) {
      if (child.url) count++
      else count += countBookmarks(child)
    }
  }
  return count
}

// 展开书签树为扁平列表（携带 folderId）
function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  pathPrefix = '',
  parentFolderId = '',
): BookmarkItem[] {
  const result: BookmarkItem[] = []
  for (const node of nodes) {
    const currentPath = pathPrefix ? `${pathPrefix} / ${node.title}` : node.title
    if (node.url) {
      result.push({
        id: node.id,
        title: node.title || '(无标题)',
        url: node.url,
        path: pathPrefix || '/',
        folderId: parentFolderId,
        status: 'pending',
      })
    }
    if (node.children) {
      result.push(...flattenBookmarks(node.children, currentPath, node.id))
    }
  }
  return result
}

// ---- 加载书签 ----

async function loadBookmarks() {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    allBookmarks.value = [
      { id: 'demo-1', title: '示例书签 (非扩展环境)', url: 'https://example.com', path: '书签栏', folderId: 'f1', status: 'pending' },
      { id: 'demo-2', title: 'GitHub', url: 'https://github.com', path: '书签栏', folderId: 'f1', status: 'pending' },
    ]
    folderTree.value = [{ key: 'f1', label: '书签栏 (2)' }]
    loaded.value = true
    return
  }

  const tree = await chrome.bookmarks.getTree()
  allBookmarks.value = flattenBookmarks(tree)
  folderTree.value = buildFolderTree(tree)
  selectedFolderId.value = null

  // 恢复上次检测记录
  const stored = await loadResults()
  if (Object.keys(stored).length > 0) {
    applyStoredResults(stored)
  }

  loaded.value = true
}

// ---- 检测 ----

async function checkOne(bookmark: BookmarkItem): Promise<void> {
  bookmark.status = 'checking'
  bookmark.errorMsg = undefined
  bookmark.statusCode = undefined

  if (!bookmark.url.startsWith('http://') && !bookmark.url.startsWith('https://')) {
    bookmark.status = 'valid'
    bookmark.checkedAt = Date.now()
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs.value)

  try {
    const resp = await fetch(bookmark.url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    bookmark.statusCode = resp.status
    bookmark.status = (resp.status === 0 || (resp.status >= 200 && resp.status < 400)) ? 'valid' : 'invalid'
  } catch (e: any) {
    clearTimeout(timer)
    if (e.name === 'AbortError') {
      bookmark.status = 'timeout'
      bookmark.errorMsg = '请求超时'
    } else {
      bookmark.status = 'error'
      bookmark.errorMsg = e.message || '网络错误'
    }
  }
  bookmark.checkedAt = Date.now()
}

let aborted = false

async function runCheckOnList(list: BookmarkItem[]) {
  checking.value = true
  aborted = false

  for (const b of list) {
    b.status = 'pending'
    b.errorMsg = undefined
    b.statusCode = undefined
  }

  const queue = [...list]
  const workers: Promise<void>[] = []

  for (let i = 0; i < concurrency.value; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0 && !aborted) {
          const item = queue.shift()!
          await checkOne(item)
        }
      })(),
    )
  }

  await Promise.all(workers)
  checking.value = false
  await saveResults()
}

// 检测当前过滤列表中的所有书签
function startCheck() {
  runCheckOnList(bookmarks.value)
}

// 检测单个书签
async function checkSingle(bookmark: BookmarkItem) {
  checking.value = true
  await checkOne(bookmark)
  checking.value = false
  await saveResults()
}

function stopCheck() {
  aborted = true
  checking.value = false
}

// ---- 删除 ----

async function removeInvalid() {
  const invalidItems = bookmarks.value.filter(
    (b: BookmarkItem) => b.status === 'invalid' || b.status === 'timeout' || b.status === 'error',
  )

  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    for (const item of invalidItems) {
      try { await chrome.bookmarks.remove(item.id) } catch { /* skip */ }
    }
  }

  const removeIds = new Set(invalidItems.map((b: BookmarkItem) => b.id))
  allBookmarks.value = allBookmarks.value.filter((b: BookmarkItem) => !removeIds.has(b.id))
  await saveResults()
}

async function removeSingle(bookmark: BookmarkItem) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    try { await chrome.bookmarks.remove(bookmark.id) } catch { /* skip */ }
  }
  const idx = allBookmarks.value.indexOf(bookmark)
  if (idx !== -1) allBookmarks.value.splice(idx, 1)
  await saveResults()
}

// ---- 目录树选择 ----

function onTreeSelect(keys: Array<string | number>) {
  selectedFolderId.value = keys.length > 0 ? String(keys[0]) : null
}

// ---- 表格列 ----

const statusMap: Record<string, { type: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending: { type: 'default', label: '待检测' },
  checking: { type: 'info', label: '检测中...' },
  valid: { type: 'success', label: '有效' },
  invalid: { type: 'error', label: '失效' },
  timeout: { type: 'warning', label: '超时' },
  error: { type: 'error', label: '错误' },
}

const columns: DataTableColumns<BookmarkItem> = [
  {
    title: '标题',
    key: 'title',
    width: 200,
    ellipsis: { tooltip: true },
  },
  {
    title: 'URL',
    key: 'url',
    ellipsis: { tooltip: true },
    render(row: BookmarkItem) {
      return h('a', {
        href: row.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: 'color: #2563eb; text-decoration: none;',
      }, row.url)
    },
  },
  {
    title: '路径',
    key: 'path',
    width: 160,
    ellipsis: { tooltip: true },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    filterOptions: Object.entries(statusMap).map(([value, { label }]) => ({ label, value })),
    filter(value: string | number, row: BookmarkItem) {
      return row.status === value.toString()
    },
    render(row: BookmarkItem) {
      const info = statusMap[row.status]
      return h(NTag, { type: info.type, size: 'small' }, { default: () => info.label })
    },
  },
  {
    title: '详情',
    key: 'detail',
    width: 130,
    render(row: BookmarkItem) {
      if (row.statusCode) return `HTTP ${row.statusCode}`
      if (row.errorMsg) return row.errorMsg
      return ''
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row: BookmarkItem) {
      const btns: ReturnType<typeof h>[] = []

      // 单独检测按钮
      if (row.status !== 'checking') {
        btns.push(
          h(NButton, {
            size: 'tiny',
            quaternary: true,
            disabled: checking.value,
            onClick: () => checkSingle(row),
          }, { default: () => '检测' }),
        )
      }

      // 删除按钮（仅失效项）
      if (row.status === 'invalid' || row.status === 'timeout' || row.status === 'error') {
        btns.push(
          h(NPopconfirm, { onPositiveClick: () => removeSingle(row) }, {
            trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '删除' }),
            default: () => '确认删除此书签？',
          }),
        )
      }

      return h(NSpace, { size: 4 }, { default: () => btns })
    },
  },
]

// ---- 生命周期 ----

onMounted(() => {
  loadBookmarks()
})
</script>

<template>
  <div class="bookmark-checker">
    <!-- 工具栏 -->
    <div class="bookmark-toolbar">
      <NSpace align="center" wrap>
        <NText strong>书签失效检测</NText>
        <NButton size="small" @click="loadBookmarks" :disabled="checking">
          重新加载
        </NButton>
        <template v-if="loaded">
          <NText depth="3">并发数:</NText>
          <NInputNumber
            v-model:value="concurrency"
            size="small"
            :min="1"
            :max="20"
            :style="{ width: '90px' }"
            :disabled="checking"
          />
          <NText depth="3">超时(ms):</NText>
          <NInputNumber
            v-model:value="timeoutMs"
            size="small"
            :min="3000"
            :max="30000"
            :step="1000"
            :style="{ width: '110px' }"
            :disabled="checking"
          />
          <NButton
            v-if="!checking"
            size="small"
            type="primary"
            @click="startCheck"
            :disabled="bookmarks.length === 0"
          >
            检测{{ selectedFolderId ? '此目录' : '全部' }}
          </NButton>
          <NButton v-else size="small" type="warning" @click="stopCheck">
            停止检测
          </NButton>
          <NPopconfirm
            v-if="stats.invalid > 0 && !checking"
            @positive-click="removeInvalid"
          >
            <template #trigger>
              <NButton size="small" type="error">
                删除失效 ({{ stats.invalid }})
              </NButton>
            </template>
            确认删除当前列表中所有失效书签？此操作不可撤销。
          </NPopconfirm>
        </template>
      </NSpace>
      <div v-if="lastCheckTime" style="margin-top: 4px">
        <NText depth="3" style="font-size: 12px">上次检测: {{ lastCheckTime }}</NText>
      </div>
    </div>

    <!-- 统计 -->
    <div v-if="loaded && bookmarks.length > 0" class="bookmark-stats">
      <NSpace align="center">
        <NTag :bordered="false" size="small">{{ selectedFolderLabel }}</NTag>
        <NText>共 {{ stats.total }} 个书签</NText>
        <NTag type="success" size="small">有效 {{ stats.valid }}</NTag>
        <NTag type="error" size="small">失效 {{ stats.invalid }}</NTag>
        <NText depth="3">已检测: {{ stats.checked }} / {{ stats.total }}</NText>
      </NSpace>
      <NProgress
        v-if="checking || stats.checked > 0"
        type="line"
        :percentage="progress"
        :status="checking ? 'info' : stats.invalid > 0 ? 'warning' : 'success'"
        style="margin-top: 8px"
      />
    </div>

    <!-- 主体：左树 + 右表 -->
    <div v-if="loaded" class="bookmark-body">
      <!-- 目录树 -->
      <div class="bookmark-tree">
        <div class="tree-header">
          <NText depth="2" style="font-size: 13px">书签目录</NText>
          <NButton
            text
            size="tiny"
            type="primary"
            v-if="selectedFolderId"
            @click="selectedFolderId = null"
          >
            显示全部
          </NButton>
        </div>
        <NTree
          :data="folderTree"
          :selected-keys="selectedFolderId ? [selectedFolderId] : []"
          selectable
          block-line
          :default-expand-all="true"
          @update:selected-keys="onTreeSelect"
          style="font-size: 13px"
        />
      </div>

      <!-- 书签表格 -->
      <div class="bookmark-table">
        <NDataTable
          v-if="bookmarks.length > 0"
          :columns="columns"
          :data="bookmarks"
          :max-height="'calc(100vh - 260px)'"
          :scroll-x="850"
          size="small"
          :bordered="false"
          virtual-scroll
        />
        <NEmpty v-else description="该目录下没有书签" style="margin-top: 40px" />
      </div>
    </div>

    <NAlert v-if="!loaded" type="info" style="margin-top: 12px">
      正在加载书签...
    </NAlert>
  </div>
</template>

<style scoped>
.bookmark-checker {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bookmark-toolbar {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.bookmark-stats {
  padding: 12px 0 0;
}

.bookmark-body {
  display: flex;
  flex: 1;
  margin-top: 12px;
  overflow: hidden;
  gap: 12px;
}

.bookmark-tree {
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border-color, #e5e7eb);
  padding-right: 12px;
}

.tree-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.bookmark-table {
  flex: 1;
  overflow: hidden;
}
</style>
