<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getAllTools } from '@/tools/registry'
import { NInput } from 'naive-ui'

const router = useRouter()
const route = useRoute()
const searchQuery = ref('')

const tools = getAllTools()

const filteredTools = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return tools
  return tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q) ||
      tool.keywords?.some((k) => k.toLowerCase().includes(q))
  )
})

function navigateTo(toolId: string) {
  router.push(`/tool/${toolId}`)
}

function isActive(toolId: string): boolean {
  return route.path === `/tool/${toolId}`
}
</script>

<template>
  <nav class="sidebar">
    <div class="sidebar-header">
      <h1 class="sidebar-title">BTools</h1>
      <span class="sidebar-subtitle">浏览器工具集</span>
    </div>

    <div class="sidebar-search">
      <NInput
        v-model:value="searchQuery"
        placeholder="搜索工具..."
        clearable
        size="small"
      />
    </div>

    <ul class="sidebar-list">
      <li
        v-for="tool in filteredTools"
        :key="tool.id"
        :class="['sidebar-item', { active: isActive(tool.id) }]"
        @click="navigateTo(tool.id)"
      >
        <span class="sidebar-item-icon" :class="tool.icon" />
        <div class="sidebar-item-text">
          <span class="sidebar-item-name">{{ tool.name }}</span>
          <span class="sidebar-item-desc">{{ tool.description }}</span>
        </div>
      </li>
    </ul>

    <div v-if="filteredTools.length === 0" class="sidebar-empty">
      未找到匹配的工具
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px 16px 8px;
}

.sidebar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #4f46e5;
}

.sidebar-subtitle {
  font-size: 12px;
  color: #9ca3af;
}

.sidebar-search {
  padding: 8px 12px;
}

.sidebar-list {
  list-style: none;
  margin: 0;
  padding: 4px 8px;
  flex: 1;
  overflow-y: auto;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: #f3f4f6;
}

.sidebar-item.active {
  background: #eef2ff;
  color: #4f46e5;
}

.sidebar-item-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.sidebar-item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar-item-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-desc {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-empty {
  padding: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}
</style>
