import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'text-diff',
  name: '文本对比',
  description: '对比两段文本的差异',
  icon: 'i-carbon-compare',
  category: '文本处理',
  keywords: ['diff', '对比', '比较', '差异'],
  component: defineAsyncComponent(() => import('./TextDiff.vue')),
})
