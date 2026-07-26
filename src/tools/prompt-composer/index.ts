import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'prompt-composer',
  name: '提示词组合',
  description: '分类查找中英文提示词，快速组合完整 Prompt',
  icon: 'i-carbon-ai-generate',
  category: 'AI 工具',
  keywords: ['提示词', 'prompt', '组合', '随机', '绘图', 'AI', '关键词'],
  component: defineAsyncComponent(() => import('./PromptComposer.vue')),
})

