import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'prompt-optimizer',
  name: 'AI 提示词优化',
  description: '按 MiniMax-H3 官方指南生成中英文视频提示词',
  icon: 'i-carbon-magic-wand-filled',
  category: 'AI 工具',
  keywords: ['提示词', 'prompt', '优化', '润色', 'MiniMax', 'H3', '视频', 'AI'],
  component: defineAsyncComponent(() => import('./PromptOptimizer.vue')),
})
