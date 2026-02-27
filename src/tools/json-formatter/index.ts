import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'json-formatter',
  name: 'JSON 格式化',
  description: 'JSON 美化、压缩与校验',
  icon: 'i-carbon-code',
  category: '格式化',
  keywords: ['json', '格式化', '美化', '压缩', '校验'],
  component: defineAsyncComponent(() => import('./JsonFormatter.vue')),
})
