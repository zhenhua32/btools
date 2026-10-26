<script setup lang="ts">
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'

const route = useRoute()
</script>

<template>
  <div class="layout" :class="{ 'layout-cube': route.name === 'rubiks-cube' }">
    <Sidebar class="layout-sidebar" />
    <main class="layout-content">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.layout-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, #e5e7eb);
  background: var(--sidebar-bg, #fafafa);
}

.layout-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  background: var(--content-bg, #ffffff);
}

.layout-cube .layout-content {
  min-width: 0;
}

@media (max-width: 768px) {
  .layout-cube .layout-sidebar {
    width: 88px;
  }

  .layout-cube .layout-content {
    padding: 10px;
  }

  .layout-cube :deep(.sidebar-header) {
    padding: 18px 4px 12px;
    text-align: center;
  }

  .layout-cube :deep(.sidebar-title) {
    font-size: 16px;
  }

  .layout-cube :deep(.sidebar-subtitle),
  .layout-cube :deep(.sidebar-search),
  .layout-cube :deep(.sidebar-item-desc),
  .layout-cube :deep(.sidebar-item-icon) {
    display: none;
  }

  .layout-cube :deep(.sidebar-list) {
    padding: 4px 3px;
    scrollbar-width: thin;
  }

  .layout-cube :deep(.sidebar-item) {
    justify-content: center;
    padding: 10px 3px;
  }

  .layout-cube :deep(.sidebar-item-name) {
    font-size: 14px;
    line-height: 1.5;
    white-space: normal;
    text-align: center;
  }
}
</style>
