<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  countPromptTerms,
  type PromptCategory,
} from '@/services/prompt-composer'

defineOptions({ name: 'CategoryTreeNode' })

const props = withDefaults(
  defineProps<{
    category: PromptCategory
    activeId: string
    depth?: number
  }>(),
  { depth: 0 },
)

const emit = defineEmits<{
  select: [categoryId: string]
}>()

const expanded = ref(props.depth === 0 && props.category.id === 'subject')
const hasChildren = computed(() => Boolean(props.category.children?.length))
const termCount = computed(() => countPromptTerms(props.category))

function containsCategory(
  category: PromptCategory,
  categoryId: string,
): boolean {
  return (
    category.id === categoryId ||
    (category.children ?? []).some((child) =>
      containsCategory(child, categoryId),
    )
  )
}

watch(
  () => props.activeId,
  (activeId) => {
    if (containsCategory(props.category, activeId)) expanded.value = true
  },
  { immediate: true },
)
</script>

<template>
  <div class="tree-node">
    <div
      :class="['tree-row', { active: activeId === category.id }]"
      :style="{ '--tree-depth': depth }"
    >
      <button
        v-if="hasChildren"
        type="button"
        class="expand-button"
        :aria-label="expanded ? '收起目录' : '展开目录'"
        :aria-expanded="expanded"
        @click.stop="expanded = !expanded"
      >
        <span
          :class="expanded ? 'i-carbon-chevron-down' : 'i-carbon-chevron-right'"
        />
      </button>
      <span v-else class="leaf-spacer" />

      <button
        type="button"
        class="node-button"
        @click="emit('select', category.id)"
      >
        <span
          :class="[
            'node-icon',
            hasChildren
              ? expanded
                ? 'i-carbon-folder-open'
                : 'i-carbon-folder'
              : category.icon,
          ]"
        />
        <span class="node-label">
          <strong>{{ category.nameZh }}</strong>
          <small>{{ category.nameEn }}</small>
        </span>
        <b>{{ termCount }}</b>
      </button>
    </div>

    <div v-if="hasChildren && expanded" class="tree-children">
      <CategoryTreeNode
        v-for="child in category.children"
        :key="child.id"
        :category="child"
        :active-id="activeId"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  min-width: 0;
  padding-left: calc(var(--tree-depth) * 13px);
  border-radius: 8px;
  color: #555467;
}

.tree-row:hover {
  background: #f1eff7;
}

.tree-row.active {
  color: #5145cd;
  background: #ece9ff;
}

.expand-button,
.leaf-spacer {
  width: 22px;
  height: 34px;
  flex: 0 0 22px;
}

.expand-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: #8f8c9d;
  background: transparent;
  cursor: pointer;
}

.expand-button:hover {
  color: #6d5dfc;
}

.node-button {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: 19px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 7px 8px 7px 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.node-icon {
  color: currentColor;
  font-size: 15px;
}

.node-label {
  min-width: 0;
}

.node-label strong,
.node-label small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label strong {
  font-size: 11px;
  font-weight: 650;
}

.node-label small {
  margin-top: 1px;
  color: #9b98a8;
  font-size: 8px;
}

.node-button b {
  color: #aaa8b7;
  font-size: 9px;
}
</style>
