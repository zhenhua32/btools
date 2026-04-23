import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'ai-settings',
  name: 'AI 设置',
  description: '配置 OpenAI 兼容接口与默认翻译策略',
  icon: 'i-carbon-settings',
  category: 'AI 工具',
  keywords: ['ai', 'openai', '模型', '设置', 'api key', 'base url'],
  component: defineAsyncComponent(() => import('./AiSettings.vue')),
})