<script setup lang="ts">
import Sidebar from '@/components/Sidebar.vue'
</script>

<template>
  <div class="layout">
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
</style>
