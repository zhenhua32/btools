import { createRouter, createWebHashHistory } from 'vue-router'
import { getAllTools } from '@/tools/registry'
import '@/tools' // 触发所有工具注册

const toolRoutes = getAllTools().map((tool) => ({
  path: `/tool/${tool.id}`,
  name: tool.id,
  component: tool.component,
  meta: { tool },
}))

const firstTool = getAllTools()[0]

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: firstTool ? `/tool/${firstTool.id}` : '/tool/text-diff',
    },
    ...toolRoutes,
  ],
})

export default router
