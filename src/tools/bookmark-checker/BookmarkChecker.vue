<script setup lang="ts">
import { ref, computed } from 'vue'
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
  type DataTableColumns,
} from 'naive-ui'

interface BookmarkItem {
  id: string
  title: string
  url: string
  path: string
  status: 'pending' | 'checking' | 'valid' | 'invalid' | 'timeout' | 'error'
  statusCode?: number
  errorMsg?: string
}

const bookmarks = ref<BookmarkItem[]>([])
const checking = ref(false)
const loaded = ref(false)
const concurrency = ref(5)
const timeoutMs = ref(10000)

// 统计
const stats = computed(() => {
  const total = bookmarks.value.length
  const valid = bookmarks.value.filter((b: BookmarkItem) => b.status === 'valid').length
  const invalid = bookmarks.value.filter((b: BookmarkItem) => b.status === 'invalid' || b.status === 'timeout' || b.status === 'error').length
  const checked = bookmarks.value.filter((b: BookmarkItem) => b.status !== 'pending' && b.status !== 'checking').length
  return { total, valid, invalid, checked }
})

const progress = computed(() => {
  if (stats.value.total === 0) return 0
  return Math.round((stats.value.checked / stats.value.total) * 100)
})

// 展开书签树为扁平列表
function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  pathPrefix = '',
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
        status: 'pending',
      })
    }
    if (node.children) {
      result.push(...flattenBookmarks(node.children, currentPath))
    }
  }
  return result
}

// 加载书签
async function loadBookmarks() {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    bookmarks.value = [
      {
        id: 'demo-1',
        title: '示例书签 (非扩展环境无法读取书签)',
        url: 'https://example.com',
        path: '书签栏',
        status: 'pending',
      },
    ]
    loaded.value = true
    return
  }

  const tree = await chrome.bookmarks.getTree()
  bookmarks.value = flattenBookmarks(tree)
  loaded.value = true
}

// 检测单个书签
async function checkOne(bookmark: BookmarkItem): Promise<void> {
  bookmark.status = 'checking'
  bookmark.errorMsg = undefined
  bookmark.statusCode = undefined

  // 跳过非 http(s) 协议
  if (!bookmark.url.startsWith('http://') && !bookmark.url.startsWith('https://')) {
    bookmark.status = 'valid'
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

    // no-cors 模式下 status 为 0 代表有响应（opaque response）
    if (resp.status === 0 || (resp.status >= 200 && resp.status < 400)) {
      bookmark.status = 'valid'
    } else {
      bookmark.status = 'invalid'
    }
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
}

// 并发控制检测
let aborted = false

async function startCheck() {
  checking.value = true
  aborted = false

  // 重置所有状态
  for (const b of bookmarks.value) {
    b.status = 'pending'
    b.errorMsg = undefined
    b.statusCode = undefined
  }

  const queue = [...bookmarks.value]
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
}

function stopCheck() {
  aborted = true
  checking.value = false
}

// 删除失效书签
async function removeInvalid() {
  const invalidItems = bookmarks.value.filter(
    (b: BookmarkItem) => b.status === 'invalid' || b.status === 'timeout' || b.status === 'error',
  )

  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    for (const item of invalidItems) {
      try {
        await chrome.bookmarks.remove(item.id)
      } catch {
        // 可能已被手动删除
      }
    }
  }

  bookmarks.value = bookmarks.value.filter(
    (b: BookmarkItem) => b.status !== 'invalid' && b.status !== 'timeout' && b.status !== 'error',
  )
}

// 删除单个书签
async function removeSingle(bookmark: BookmarkItem) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    try {
      await chrome.bookmarks.remove(bookmark.id)
    } catch {
      // 忽略
    }
  }
  const idx = bookmarks.value.indexOf(bookmark)
  if (idx !== -1) bookmarks.value.splice(idx, 1)
}

// 表格列定义
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
    width: 180,
    ellipsis: { tooltip: true },
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
    filterOptions: [
      { label: '有效', value: 'valid' },
      { label: '失效', value: 'invalid' },
      { label: '超时', value: 'timeout' },
      { label: '错误', value: 'error' },
      { label: '待检测', value: 'pending' },
      { label: '检测中', value: 'checking' },
    ],
    filter(value: string | number, row: BookmarkItem) {
      return row.status === value.toString()
    },
    render(row: BookmarkItem) {
      const map: Record<string, { type: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
        pending: { type: 'default', label: '待检测' },
        checking: { type: 'info', label: '检测中...' },
        valid: { type: 'success', label: '有效' },
        invalid: { type: 'error', label: '失效' },
        timeout: { type: 'warning', label: '超时' },
        error: { type: 'error', label: '错误' },
      }
      const info = map[row.status]
      return h(NTag, { type: info.type, size: 'small' }, { default: () => info.label })
    },
  },
  {
    title: '详情',
    key: 'detail',
    width: 150,
    render(row: BookmarkItem) {
      if (row.statusCode) return `HTTP ${row.statusCode}`
      if (row.errorMsg) return row.errorMsg
      return ''
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(row: BookmarkItem) {
      if (row.status === 'invalid' || row.status === 'timeout' || row.status === 'error') {
        return h(
          NPopconfirm,
          { onPositiveClick: () => removeSingle(row) },
          {
            trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '删除' }),
            default: () => '确认删除此书签？',
          },
        )
      }
      return ''
    },
  },
]

// 需要导入 h 函数用于 render
import { h } from 'vue'
</script>

<template>
  <div class="bookmark-checker">
    <div class="bookmark-toolbar">
      <NSpace align="center" wrap>
        <NText strong>书签失效检测</NText>
        <NButton size="small" @click="loadBookmarks" :disabled="checking">
          {{ loaded ? '重新加载' : '加载书签' }}
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
            开始检测
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
                删除全部失效 ({{ stats.invalid }})
              </NButton>
            </template>
            确认删除所有失效书签？此操作不可撤销。
          </NPopconfirm>
        </template>
      </NSpace>
    </div>

    <div v-if="loaded && bookmarks.length > 0" class="bookmark-stats">
      <NSpace align="center">
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

    <NAlert
      v-if="!loaded"
      type="info"
      style="margin-top: 12px"
    >
      点击「加载书签」读取浏览器书签，然后开始检测失效链接。
    </NAlert>

    <NDataTable
      v-if="loaded"
      :columns="columns"
      :data="bookmarks"
      :max-height="'calc(100vh - 220px)'"
      :scroll-x="800"
      size="small"
      :bordered="false"
      style="margin-top: 12px"
      virtual-scroll
    />
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
</style>
