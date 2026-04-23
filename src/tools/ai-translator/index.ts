import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'ai-translator',
  name: 'AI 翻译',
  description: '支持段落流与左右对照两种翻译结果格式',
  icon: 'i-carbon-language',
  category: 'AI 工具',
  keywords: ['ai', '翻译', 'translator', 'openai', '对照翻译'],
  component: defineAsyncComponent(() => import('./AiTranslator.vue')),
})