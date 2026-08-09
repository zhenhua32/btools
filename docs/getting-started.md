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

## AI 提示词优化

“AI 提示词优化”复用 AI 翻译的模型配置，并依据 MiniMax-H3 官方指南改写视频创意。

1. 选择 T2VA、I2VA、FL2VA、L2VA 或 Ref2VA 输入模式。
2. 填写目标视频时长与创意描述；I2VA/L2VA 上传 1 张对应关键帧，FL2VA 按首尾顺序上传 2 张图片，Ref2VA 可上传多张参考图片。
3. 非 T2VA 模式会把图片作为多模态消息发送给当前 AI 模型，因此该模型必须支持图像理解。
4. 先生成英文 H3 直用版，再复用 AI 翻译模型生成结构对应的中文审阅版，并支持分别复制或双语复制。
5. 指南改写系统提示词暴露在“AI 设置”中，可自定义或恢复默认。

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
