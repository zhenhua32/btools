<script setup lang="ts">
import { ref } from 'vue'
import { h } from 'vue'
import {
  NButton,
  NSpace,
  NText,
  NUpload,
  NDataTable,
  NTag,
  NAlert,
  NEmpty,
  NStatistic,
  NGrid,
  NGi,
  type DataTableColumns,
  type UploadFileInfo,
} from 'naive-ui'

// ---- 类型 ----

interface BookmarkNode {
  title: string
  url?: string
  /** 添加时间戳 */
  addDate?: string
  children?: BookmarkNode[]
}

interface FlatBookmark {
  title: string
  url: string
  path: string
  addDate?: string
  source: 'A' | 'B' | 'both'
}

// ---- 状态 ----

const fileA = ref<BookmarkNode[]>([])
const fileB = ref<BookmarkNode[]>([])
const fileAName = ref('')
const fileBName = ref('')
const merged = ref<FlatBookmark[]>([])
const mergeStats = ref({ total: 0, fromA: 0, fromB: 0, duplicates: 0 })
const parseError = ref('')

// ---- 解析书签 HTML ----

function parseBookmarkHtml(html: string): BookmarkNode[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  function parseDL(dl: Element): BookmarkNode[] {
    const nodes: BookmarkNode[] = []
    const items = dl.children

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.tagName !== 'DT') continue

      const anchor = item.querySelector(':scope > A')
      if (anchor) {
        nodes.push({
          title: anchor.textContent || '',
          url: anchor.getAttribute('HREF') || '',
          addDate: anchor.getAttribute('ADD_DATE') || undefined,
        })
        continue
      }

      const h3 = item.querySelector(':scope > H3')
      const subDl = item.querySelector(':scope > DL')
      if (h3) {
        const folder: BookmarkNode = {
          title: h3.textContent || '',
          addDate: h3.getAttribute('ADD_DATE') || undefined,
          children: subDl ? parseDL(subDl) : [],
        }
        nodes.push(folder)
      }
    }
    return nodes
  }

  const rootDl = doc.querySelector('DL')
  return rootDl ? parseDL(rootDl) : []
}

// ---- 展平书签树 ----

function flattenTree(nodes: BookmarkNode[], path = ''): FlatBookmark[] {
  const result: FlatBookmark[] = []
  for (const node of nodes) {
    if (node.url) {
      result.push({
        title: node.title,
        url: node.url,
        path: path || '/',
        addDate: node.addDate,
        source: 'A',
      })
    }
    if (node.children) {
      const subPath = path ? `${path} / ${node.title}` : node.title
      result.push(...flattenTree(node.children, subPath))
    }
  }
  return result
}

// ---- 文件读取 ----

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })
}

async function handleFileA(fileList: UploadFileInfo[]) {
  const fileInfo = fileList[fileList.length - 1]
  if (!fileInfo?.file) return
  try {
    parseError.value = ''
    const text = await readFile(fileInfo.file)
    fileA.value = parseBookmarkHtml(text)
    fileAName.value = fileInfo.name
    if (fileB.value.length > 0) doMerge()
  } catch (e: any) {
    parseError.value = `文件 A 解析失败: ${e.message}`
  }
}

async function handleFileB(fileList: UploadFileInfo[]) {
  const fileInfo = fileList[fileList.length - 1]
  if (!fileInfo?.file) return
  try {
    parseError.value = ''
    const text = await readFile(fileInfo.file)
    fileB.value = parseBookmarkHtml(text)
    fileBName.value = fileInfo.name
    if (fileA.value.length > 0) doMerge()
  } catch (e: any) {
    parseError.value = `文件 B 解析失败: ${e.message}`
  }
}

// ---- 合并去重 ----

function doMerge() {
  const listA = flattenTree(fileA.value).map((b) => ({ ...b, source: 'A' as const }))
  const listB = flattenTree(fileB.value).map((b) => ({ ...b, source: 'B' as const }))

  const urlMap = new Map<string, FlatBookmark>()
  let duplicates = 0

  for (const b of listA) {
    urlMap.set(b.url, b)
  }

  for (const b of listB) {
    if (urlMap.has(b.url)) {
      const existing = urlMap.get(b.url)!
      existing.source = 'both'
      duplicates++
    } else {
      urlMap.set(b.url, b)
    }
  }

  const result = Array.from(urlMap.values())
  merged.value = result
  mergeStats.value = {
    total: result.length,
    fromA: listA.length,
    fromB: listB.length,
    duplicates,
  }
}

// ---- 重建书签树 ----

function rebuildTree(flat: FlatBookmark[]): BookmarkNode[] {
  const root: BookmarkNode = { title: '', children: [] }

  for (const b of flat) {
    const parts = b.path === '/' ? [] : b.path.split(' / ')
    let current = root

    for (const part of parts) {
      if (!current.children) current.children = []
      let folder = current.children.find((c) => c.title === part && !c.url)
      if (!folder) {
        folder = { title: part, children: [] }
        current.children.push(folder)
      }
      current = folder
    }

    if (!current.children) current.children = []
    current.children.push({
      title: b.title,
      url: b.url,
      addDate: b.addDate,
    })
  }

  return root.children || []
}

// ---- 生成书签 HTML ----

function generateBookmarkHtml(nodes: BookmarkNode[], indent = 1): string {
  const pad = '    '.repeat(indent)
  let html = ''

  for (const node of nodes) {
    if (node.url) {
      const addDate = node.addDate ? ` ADD_DATE="${node.addDate}"` : ''
      html += `${pad}<DT><A HREF="${escapeHtml(node.url)}"${addDate}>${escapeHtml(node.title)}</A>\n`
    } else if (node.children) {
      const addDate = node.addDate ? ` ADD_DATE="${node.addDate}"` : ''
      html += `${pad}<DT><H3${addDate}>${escapeHtml(node.title)}</H3>\n`
      html += `${pad}<DL><p>\n`
      html += generateBookmarkHtml(node.children, indent + 1)
      html += `${pad}</DL><p>\n`
    }
  }

  return html
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportBookmarks() {
  const tree = rebuildTree(merged.value)
  const content = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${generateBookmarkHtml(tree)}
</DL><p>
`
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bookmarks_merged.html'
  a.click()
  URL.revokeObjectURL(url)
}

// ---- 表格列 ----

const sourceTagMap = {
  A: { type: 'info' as const, label: '文件 A' },
  B: { type: 'success' as const, label: '文件 B' },
  both: { type: 'warning' as const, label: '重复' },
}

const columns: DataTableColumns<FlatBookmark> = [
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
    render(row: FlatBookmark) {
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
    title: '来源',
    key: 'source',
    width: 100,
    filterOptions: [
      { label: '文件 A', value: 'A' },
      { label: '文件 B', value: 'B' },
      { label: '重复', value: 'both' },
    ],
    filter(value: string | number, row: FlatBookmark) {
      return row.source === value.toString()
    },
    render(row: FlatBookmark) {
      const info = sourceTagMap[row.source]
      return h(NTag, { type: info.type, size: 'small' }, { default: () => info.label })
    },
  },
]

function clearAll() {
  fileA.value = []
  fileB.value = []
  fileAName.value = ''
  fileBName.value = ''
  merged.value = []
  mergeStats.value = { total: 0, fromA: 0, fromB: 0, duplicates: 0 }
  parseError.value = ''
}
</script>

<template>
  <div class="bookmark-merger">
    <!-- 工具栏 -->
    <div class="merger-toolbar">
      <NSpace align="center" wrap>
        <NText strong>书签合并</NText>
        <NButton size="small" @click="clearAll">重置</NButton>
        <NButton
          v-if="merged.length > 0"
          size="small"
          type="primary"
          @click="exportBookmarks"
        >
          导出合并后的书签
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="parseError" type="error" style="margin-top: 12px" closable @close="parseError = ''">
      {{ parseError }}
    </NAlert>

    <!-- 文件上传区 -->
    <div class="upload-area">
      <div class="upload-card">
        <NText depth="2" style="font-size: 13px; margin-bottom: 8px; display: block">
          书签文件 A {{ fileAName ? `(${fileAName})` : '' }}
        </NText>
        <NUpload
          accept=".html,.htm"
          :max="1"
          :default-upload="false"
          @update:file-list="handleFileA"
        >
          <NButton size="small">选择文件</NButton>
        </NUpload>
        <NText v-if="fileA.length > 0" depth="3" style="font-size: 12px; margin-top: 4px; display: block">
          已解析，含 {{ flattenTree(fileA).length }} 个书签
        </NText>
      </div>

      <div class="upload-card">
        <NText depth="2" style="font-size: 13px; margin-bottom: 8px; display: block">
          书签文件 B {{ fileBName ? `(${fileBName})` : '' }}
        </NText>
        <NUpload
          accept=".html,.htm"
          :max="1"
          :default-upload="false"
          @update:file-list="handleFileB"
        >
          <NButton size="small">选择文件</NButton>
        </NUpload>
        <NText v-if="fileB.length > 0" depth="3" style="font-size: 12px; margin-top: 4px; display: block">
          已解析，含 {{ flattenTree(fileB).length }} 个书签
        </NText>
      </div>
    </div>

    <!-- 合并统计 -->
    <div v-if="merged.length > 0" class="merge-stats">
      <NGrid :cols="4" :x-gap="12">
        <NGi>
          <NStatistic label="文件 A" :value="mergeStats.fromA" />
        </NGi>
        <NGi>
          <NStatistic label="文件 B" :value="mergeStats.fromB" />
        </NGi>
        <NGi>
          <NStatistic label="重复项">
            <NText type="warning">{{ mergeStats.duplicates }}</NText>
          </NStatistic>
        </NGi>
        <NGi>
          <NStatistic label="合并后">
            <NText type="success">{{ mergeStats.total }}</NText>
          </NStatistic>
        </NGi>
      </NGrid>
    </div>

    <!-- 合并结果表格 -->
    <div v-if="merged.length > 0" class="merge-table">
      <NDataTable
        :columns="columns"
        :data="merged"
        :max-height="'calc(100vh - 380px)'"
        :scroll-x="700"
        size="small"
        :bordered="false"
        virtual-scroll
      />
    </div>

    <NEmpty
      v-else-if="fileA.length === 0 || fileB.length === 0"
      description="请导入两个书签 HTML 文件进行合并"
      style="margin-top: 60px"
    />
  </div>
</template>

<style scoped>
.bookmark-merger {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.merger-toolbar {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.upload-area {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.upload-card {
  flex: 1;
  padding: 16px;
  border: 1px dashed var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: #fafafa;
}

.merge-stats {
  margin-top: 16px;
  padding: 12px 16px;
  background: #fafafa;
  border-radius: 8px;
}

.merge-table {
  flex: 1;
  margin-top: 12px;
  overflow: hidden;
}
</style>
