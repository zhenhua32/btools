import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'elo-winrate',
  name: 'Elo 胜率计算',
  description: '根据双方 Elo 分数计算理论胜率，并可按目标胜率反推分差',
  icon: 'i-carbon-calculator',
  category: '计算工具',
  keywords: ['elo', '胜率', 'rating', '积分', '天梯', '分差', '概率'],
  component: defineAsyncComponent(() => import('./EloWinrateTool.vue')),
})