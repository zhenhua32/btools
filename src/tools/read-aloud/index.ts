import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'read-aloud',
  name: 'AI 朗读',
  description: '用自定义音色朗读文本，边生成边播放',
  icon: 'i-carbon-volume-up',
  category: 'AI 工具',
  keywords: ['ai', '朗读', '语音', 'tts', 'mimo', '音色'],
  component: defineAsyncComponent(() => import('./ReadAloud.vue')),
})
