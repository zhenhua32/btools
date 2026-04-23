# BTools 启动指南

## 环境要求

- Node.js >= 18
- Chrome 浏览器

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建扩展
npm run build
```

## 加载到 Chrome

1. 运行 `npm run build` 生成 `dist/` 目录
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目中的 `dist` 文件夹
5. 点击工具栏中的 BTools 图标，即可在新标签页中打开工具集

## 新增工具

1. 在 `src/tools/` 下新建文件夹，如 `src/tools/my-tool/`
2. 创建 Vue 组件 `MyTool.vue` 和注册文件 `index.ts`：

```ts
// src/tools/my-tool/index.ts
import { registerTool } from '../registry'
import { defineAsyncComponent } from 'vue'

registerTool({
  id: 'my-tool',
  name: '我的工具',
  description: '工具描述',
  icon: 'i-carbon-tool-box',
  component: defineAsyncComponent(() => import('./MyTool.vue')),
})
```

3. 在 `src/tools/index.ts` 中添加一行：

```ts
import './my-tool'
```

## AI 翻译配置

项目新增了“AI 翻译”和“AI 设置”两个工具。

1. 打开侧边栏中的“AI 设置”。
2. 配置 OpenAI 兼容接口地址、API Key、模型名称和系统提示词。
3. 可设置默认目标语言、默认展示模式和默认翻译策略。
4. 保存后在“AI 翻译”中使用，支持“段落流”和“左右对照”两种结果格式。

说明：
为支持用户自定义 OpenAI 兼容接口域名，扩展在 manifest 中声明了较宽的 `host_permissions`。AI 请求由扩展后台统一转发，而不是由页面直接访问模型接口。

## 项目结构

```
src/
├── background/       # Chrome 扩展 Service Worker
├── components/       # 通用组件（侧边栏等）
├── layouts/          # 页面布局
├── router/           # Vue Router（Hash 模式）
├── styles/           # 全局样式
└── tools/            # 工具模块（可扩展）
    ├── registry.ts   # 工具注册中心
    ├── types.ts      # ToolMeta 接口定义
    ├── text-diff/    # 文本对比
    ├── json-formatter/ # JSON 格式化
    └── encoding/     # 编码转换
```
