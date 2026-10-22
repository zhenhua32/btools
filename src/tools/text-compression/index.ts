import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'text-compression',
  name: '文本压缩',
  description: '多算法无损压缩、文本编码与自动识别解压',
  icon: 'i-carbon-zip',
  category: '文本处理',
  keywords: ['文本压缩', '解压', 'brotli', 'zstd', 'lzma', 'deflate', 'gzip', 'lz-string', 'base32768', 'base65536', 'base64', 'base91', 'compress'],
  component: defineAsyncComponent(() => import('./TextCompression.vue')),
})
