import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'rubiks-cube',
  name: '二阶魔方',
  description: '立体二阶魔方，支持旋转视角、打乱、撤销与计时',
  icon: 'i-carbon-cube',
  category: '休闲益智',
  keywords: ['2x2', '魔方', 'cube', 'rubik', '游戏'],
  component: defineAsyncComponent(() => import('./RubiksCube.vue')),
})
