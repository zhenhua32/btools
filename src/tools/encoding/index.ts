import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'encoding',
  name: '编码转换',
  description: 'Base64、URL、Hex 编解码',
  icon: 'i-carbon-character-whole-number',
  category: '编码转换',
  keywords: ['base64', 'url', 'hex', '编码', '解码', 'encode', 'decode'],
  component: defineAsyncComponent(() => import('./EncodingConverter.vue')),
})
