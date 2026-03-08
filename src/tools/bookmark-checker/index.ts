import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'bookmark-checker',
  name: '书签失效检测',
  description: '检测浏览器书签是否失效，支持批量删除',
  icon: 'i-carbon-bookmark',
  category: '浏览器工具',
  keywords: ['bookmark', '书签', '失效', '检测', '死链'],
  component: defineAsyncComponent(() => import('./BookmarkChecker.vue')),
})
