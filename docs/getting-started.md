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

AI 功能包含“AI 翻译”“AI 朗读”“AI 提示词优化”和“AI 设置”。

1. 打开侧边栏中的“AI 设置”。
2. 配置 OpenAI 兼容接口地址、API Key、模型名称和系统提示词。
3. 可设置默认目标语言、默认展示模式和默认翻译策略。
4. 保存后在“AI 翻译”中使用，支持“段落流”和“左右对照”两种结果格式。

说明：
为支持用户自定义 OpenAI 兼容接口域名，扩展在 manifest 中声明了较宽的 `host_permissions`。AI 请求由扩展后台统一转发，而不是由页面直接访问模型接口。

## AI 朗读配置

1. 打开“AI 设置”中的“朗读 / 音色设计”。朗读使用独立配置，可只填写朗读 API Key，无需同时填写翻译 API Key 和模型。
2. 默认接口为 `https://api.xiaomimimo.com/v1`，默认模型为 `mimo-v2.5-tts-voicedesign`。填写 MiMo API Key，并按需修改音色描述；默认音色为“性感御姐音色”。
3. 保存设置后，在“AI 朗读”工具中输入文本并开始朗读。网页中可选中文本后点击悬浮朗读按钮，或通过右键菜单开始朗读；悬浮朗读按钮在“交互设置”中单独控制。
4. 默认 VoiceDesign 模型按短句生成并连续播放，首段完成后开始朗读，后续段落继续生成。该模型暂不提供实时音频分片，分段音色可能略有变化；具体能力参见 [MiMo 语音合成指南](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)。
5. 朗读时点击停止按钮，可立即停止播放并取消后续生成。配置保存在当前浏览器本地。
6. 本地 HTML 文件（`file://`）也可划词朗读或翻译：打开 `chrome://extensions`（Edge 使用 `edge://extensions`），进入 BTools“详情”，开启“允许访问文件网址”，再刷新本地网页。更新扩展后，先重新加载 BTools，再刷新网页。
7. 要固定试听选中的声音，分别选择通用、中文或英文参考 WAV/MP3，例如 VoiceDesign 生成的试听 WAV。选择后立即独立保存，可分别试听或移除；单份音频编码后上限为 10 MB，能否保存还受浏览器本地存储空间限制。保存或恢复 AI 设置、切换模型时均保留参考音频。
8. 将朗读模型改为 `mimo-v2.5-tts-voiceclone` 后，系统按句的主要语言自动选择中文或英文参考；中文句里嵌入短英文词时仍沿用中文音色。没有对应语言参考时使用通用参考，二者都缺少则在请求前提示补充。原有单一参考仍作为通用参考使用。
9. 可分别填写“中文朗读风格”和“英文朗读风格”，留空则使用通用朗读风格。风格用于控制语速、情绪与说话方式，设计年龄、性别或音高的描述用于 VoiceDesign 试听阶段。
10. 已有音色组合文件时，点击“导入音色组合 JSON”，选择版本 1 的 VoiceClone 组合。导入会同时保存中英文参考和三种风格，保留已保存的接口、API Key、其他 AI 设置及通用参考，并在界面显示两个试听控件。组合文件不含密钥；其他未保存的表单项不会被导入操作保存。格式错误或本地存储不足时旧组合保持可用。

## AI 提示词优化

“AI 提示词优化”复用 AI 翻译的模型配置，并依据 MiniMax-H3 官方指南改写视频创意。

1. 选择 T2VA、I2VA、FL2VA、L2VA 或 Ref2VA 输入模式。
2. 填写目标视频时长与创意描述；I2VA/L2VA 上传 1 张对应关键帧，FL2VA 按首尾顺序上传 2 张图片，Ref2VA 可上传多张参考图片。
3. 非 T2VA 模式会把图片作为多模态消息发送给当前 AI 模型，因此该模型必须支持图像理解。
4. 先生成英文 H3 直用版，再复用 AI 翻译模型生成结构对应的中文审阅版，并支持分别复制或双语复制。
5. 可选用 MiniMax-H3 官方基础写作 Skill，并可再组合一个官方风格 / 场景 Skill；选择会保存在本地。
6. 启用基础写作 Skill 后，不发送“AI 设置”中的提示词优化系统提示词，而是按当前 H3 输入模式加载基础 Skill 与对应的 Base / Ref 官方指南。
7. 未启用基础写作 Skill 时仍使用“AI 设置”中的系统提示词；风格 Skill 只提供最终提示词所需的风格约束，其中的问询、确认、媒体生成和剪辑流程不会执行。

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
