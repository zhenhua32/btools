## Plan: BTools — Chrome 浏览器工具集插件

基于 **Vue 3 + TypeScript + Vite + Manifest V3** 构建一个 Chrome 扩展，以独立标签页形式提供可扩展的开发工具集。核心工具包含文本对比、JSON 格式化、编码转换三项。采用「工具注册中心」架构，新增工具只需新建文件夹 + 一行 import，实现高度可扩展。

**Steps**

1. **项目脚手架初始化**
   - 运行 `npm create vite@latest . -- --template vue-ts` 初始化项目
   - 安装核心依赖：`vue`, `vue-router`, `monaco-editor`, `@guolao/vue-monaco-editor`, `naive-ui`, `iconv-lite`
   - 安装开发依赖：`typescript`, `vite`, `@vitejs/plugin-vue`, `vite-plugin-monaco-editor`, `vue-tsc`, `@types/chrome`, `unocss`

2. **Vite 构建配置**
   - 创建 `vite.config.ts`，配置 Vue 插件、`@` 路径别名、Monaco Editor worker 插件、UnoCSS
   - `build.rollupOptions.input` 配置双入口：`index.html`（SPA 主页面）+ `src/background/service-worker.ts`（后台脚本）
   - 构建输出到 `dist/` 目录

3. **Manifest V3 配置**
   - 创建 `public/manifest.json`：版本号 `1.0.0`，声明 `background.service_worker`，仅申请 `storage` 权限
   - **不设置** `action.default_popup`，使点击图标触发 `onClicked` 事件
   - 配置 CSP：`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`（Monaco worker 需要）
   - 准备 `public/icons/` 下的 16/48/128 图标

4. **Service Worker 后台脚本**
   - 创建 `src/background/service-worker.ts`
   - 监听 `chrome.action.onClicked`，调用 `chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })` 打开新标签页

5. **工具插件化架构（核心）**
   - 创建 `src/tools/types.ts`：定义 `ToolMeta` 接口（`id`, `name`, `description`, `icon`, `category`, `keywords`, `component`）
   - 创建 `src/tools/registry.ts`：实现工具注册中心（`registerTool`, `getAllTools`, `getToolById`）
   - 创建 `src/tools/index.ts`：统一 import 所有工具模块的入口文件
   - **新增工具的标准流程**：① 在 `src/tools/` 下新建文件夹 → ② 编写 Vue 组件 + `index.ts` 注册文件 → ③ 在 `src/tools/index.ts` 加一行 import

6. **Vue SPA 框架搭建**
   - `src/main.ts`：创建 Vue 应用，挂载 Router、Naive UI
   - `src/router/index.ts`：使用 **Hash 模式**（Chrome Extension 强制），从 registry 自动生成工具路由 `/tool/:id`，默认重定向到第一个工具
   - `src/layouts/ToolLayout.vue`：左侧导航栏（工具列表 + 搜索）+ 右侧 `<router-view>` 内容区
   - `src/components/Sidebar.vue`：遍历 `getAllTools()` 渲染导航项，支持关键词搜索过滤

7. **工具一：文本对比** (`src/tools/text-diff/`)
   - `TextDiff.vue`：使用 Monaco Editor 的 `DiffEditor` 模式
   - 提供左右两个输入区域，实时高亮差异
   - 支持内联/并排两种对比模式切换

8. **工具二：JSON 格式化** (`src/tools/json-formatter/`)
   - `JsonFormatter.vue`：使用 Monaco Editor（JSON 语言模式），自带语法校验
   - 功能：格式化（美化）、压缩、校验、复制结果
   - 支持自定义缩进（2/4 空格、Tab）

9. **工具三：编码转换** (`src/tools/encoding/`)
   - `EncodingConverter.vue`：Naive UI 表单组件
   - 支持 Base64 编解码（`btoa/atob`）、URL 编解码（`encodeURIComponent/decodeURIComponent`）
   - 支持 UTF-8 / GBK 等字符编码转换（`iconv-lite`）、十六进制互转

10. **全局样式与主题**
    - 配置 UnoCSS（`uno.config.ts`）
    - 全局样式 `src/styles/global.css`：响应式布局、暗色/亮色主题支持（可利用 Naive UI 主题切换）

11. **TypeScript 配置**
    - `tsconfig.json`：配置路径别名 `@/*` → `src/*`，包含 Chrome API 类型 `@types/chrome`

**项目结构**

```
btools/
├── public/
│   ├── manifest.json
│   └── icons/  (16/48/128.png)
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/index.ts
│   ├── layouts/ToolLayout.vue
│   ├── components/
│   │   ├── Sidebar.vue
│   │   └── common/
│   ├── tools/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── index.ts
│   │   ├── text-diff/
│   │   ├── json-formatter/
│   │   └── encoding/
│   ├── background/service-worker.ts
│   ├── composables/
│   ├── styles/global.css
│   └── types/index.ts
├── index.html
├── vite.config.ts
├── tsconfig.json
├── uno.config.ts
└── package.json
```

**Verification**

- `npm run build` 成功产出 `dist/` 目录
- 在 `chrome://extensions` 开发者模式下加载 `dist/` 文件夹
- 点击扩展图标 → 打开新标签页 → 左侧导航显示三个工具
- 文本对比：输入两段文本，diff 高亮正确显示
- JSON 格式化：粘贴 JSON → 格式化/压缩/校验均正常
- 编码转换：Base64、URL 编码、GBK 编码转换结果正确

**Decisions**

- **纯 Vite 构建**而非 `@crxjs/vite-plugin` 或 `vite-plugin-web-extension`：本项目仅有独立标签页 SPA + 简单 service worker，无 content script / popup，纯 Vite 更简单可控
- **Monaco Editor** 同时承担文本对比 + JSON 格式化：一套编辑器解决两个工具，避免引入多个库
- **Naive UI** 作为 UI 组件库：体积更小、Vue 3 原生支持、API 简洁
- **Hash Router**：Chrome Extension 页面不支持 HTML5 History 模式，必须使用
- **最小权限**：仅申请 `storage`，不需要 `activeTab` 等权限，有利于上架审核
