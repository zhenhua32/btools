import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'bookmark-merger',
  name: '书签合并',
  description: '导入两个书签文件，合并去重后导出',
  icon: 'i-carbon-join-inner',
  category: '浏览器工具',
  keywords: ['bookmark', '书签', '合并', '去重', 'merge', '导入', '导出'],
  component: defineAsyncComponent(() => import('./BookmarkMerger.vue')),
})
