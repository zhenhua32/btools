import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'text-compression',
  name: '文本压缩',
  description: '文本与 1 GiB 文件无损压缩为可复制文本，上传或粘贴自动解压',
  icon: 'i-carbon-zip',
  category: '文本处理',
  keywords: ['文本压缩', '文件压缩', '文件解压', '上传文件', 'zip', '解压', 'brotli', 'zstd', 'lzma', 'deflate', 'gzip', 'lz-string', 'base32768', 'base65536', 'base64', 'base91', 'compress'],
  component: defineAsyncComponent(() => import('./TextCompression.vue')),
})
