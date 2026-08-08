import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'ai-settings',
  name: 'AI 设置',
  description: '配置 OpenAI 兼容接口、翻译与提示词优化规则',
  icon: 'i-carbon-settings',
  category: 'AI 工具',
  keywords: ['ai', 'openai', '模型', '设置', 'api key', 'base url', '系统提示词', 'MiniMax'],
  component: defineAsyncComponent(() => import('./AiSettings.vue')),
})
