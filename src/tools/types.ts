import type { Component } from 'vue'

export interface ToolMeta {
  /** 唯一标识，如 'text-diff' */
  id: string
  /** 显示名称 */
  name: string
  /** 简要描述 */
  description: string
  /** 图标名称（UnoCSS Icons class） */
  icon: string
  /** 分类 */
  category?: string
  /** 搜索关键词 */
  keywords?: string[]
  /** 懒加载的 Vue 组件 */
  component: Component
}
