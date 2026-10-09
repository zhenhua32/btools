# 浏览器工具集

BTools 是一个基于 Vue 3 和 Chrome Extension Manifest V3 的浏览器工具集，当前包含文本处理、计算、书签处理、AI 翻译和 AI 朗读等工具。

## 当前功能

- 文本对比
- JSON 格式化
- 编码转换
- Elo 胜率计算
- 二维码生成与识别
- 书签有效性检查
- 书签合并
- 提示词组合
	- 13 个大类别、55 个小类别、1326 条中英文原子提示词
	- 目录树浏览、跨目录搜索、自由点选与随机组合
	- 自定义大类别、小类别、词条和输出语言
- AI 翻译
	- 段落流结果展示
	- 左右对照翻译
	- OpenAI 兼容接口配置
- AI 朗读
	- 工具内文本朗读、网页划词朗读和右键朗读
	- MiMo 音色描述配置，默认“性感御姐音色”
	- 中英文分别保存试听 WAV/MP3，VoiceClone 按句自动选择参考音色
	- 导入不含密钥的音色组合 JSON，一次配置中英文声音与朗读风格
	- 按短句生成并连续播放，支持随时停止
- AI 提示词优化
	- 按 MiniMax-H3 官方指南支持 T2VA、I2VA、FL2VA、L2VA 与 Ref2VA
	- 先生成英文 H3 直用版，再复用 AI 翻译模型生成结构对应的中文审阅版
	- 非 T2VA 模式上传真实参考图片，由视觉模型基于图片内容改写

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建扩展
npm run build

# 测试
npm run test
```

## AI 翻译说明

1. 在侧边栏打开“AI 设置”，填写 Base URL、API Key、Model 和系统提示词。
2. AI 配置保存在当前浏览器本地，不会写入项目文件。
3. AI 翻译通过扩展后台代理调用 OpenAI 兼容 chat/completions 接口。
4. 为支持自定义兼容接口，扩展清单增加了较宽的网络访问权限。
5. 网页划词翻译和右键翻译支持 HTTP/HTTPS 网页（含 localhost）以及直接打开的本地 HTML 文件（`file://`）。
6. 使用本地 HTML 文件翻译前，在 `chrome://extensions`（Edge 为 `edge://extensions`）中打开 BTools 的“详情”，开启“允许访问文件网址”，并刷新本地网页；“AI 设置”中的“启用选中文本后的悬浮翻译按钮”也需要开启。
7. 更新扩展后，先在扩展管理页重新加载 BTools，再刷新需要翻译的网页。

## AI 朗读说明

1. 打开“AI 设置”中的“朗读 / 音色设计”，填写独立的朗读 API Key。默认 Base URL 为 `https://api.xiaomimimo.com/v1`，模型为 `mimo-v2.5-tts-voicedesign`，音色描述为“性感御姐音色”；音色描述可自行修改。仅使用朗读时无需配置翻译 API Key 和模型。
2. 在“AI 朗读”工具中输入文本后开始朗读，或在网页选中文本后点击悬浮朗读按钮，也可使用右键菜单中的朗读操作。“AI 设置”可单独开关悬浮朗读按钮。
3. VoiceDesign 和 VoiceClone 暂不支持实时音频分片。BTools 按短句生成音频并连续播放，首段完成后开始朗读，后续段落继续生成；VoiceDesign 独立设计每段的音色，可能略有变化，VoiceClone 则复用同一参考声音。具体能力见 [MiMo 语音合成指南](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)。
4. 点击停止按钮可停止当前朗读并取消后续生成。API Key 与音色配置保存在当前浏览器本地，朗读请求通过扩展后台发送。
5. 划词朗读与右键朗读支持 HTTP/HTTPS 网页（含 localhost）和本地 HTML 文件（`file://`）。本地文件需要在扩展详情中开启“允许访问文件网址”，重新加载扩展后刷新网页。
6. 要复用试听满意的声音，在“AI 设置”的 VoiceClone 参考音频区分别选择通用、中文或英文 WAV/MP3，上传后可直接试听或独立移除。三种参考独立保存在当前浏览器本地，单份音频 Base64 编码上限为 10 MB，实际保存还取决于浏览器本地存储空间。选择文件即保存，普通的设置保存、重置或切换模型均会保留三种参考。
7. 将模型改为 `mimo-v2.5-tts-voiceclone` 后，朗读按句的主要语言选择参考音色；中文句中嵌入短英文词时仍使用中文音色。缺少对应语言参考时使用通用参考，二者都没有时会在发起请求前提示补充。之前保存的单一参考会继续作为通用参考使用。
8. “通用朗读风格 / 语速”只描述情绪、速度和说话方式。可分别填写中文与英文朗读风格覆盖通用风格，留空则沿用通用风格。年龄、性别和音高描述用于 VoiceDesign 设计试听音色，克隆时使用“保留参考音色，自然朗读”等风格指令。
9. 点击“导入音色组合 JSON”可一次配置中文与英文参考及对应风格，并切换到 VoiceClone。组合文件只包含版本、模型、三种风格和中英文参考音频，不包含 API Key 或接口地址；导入保留已保存的接口、密钥、其他 AI 设置及通用参考。无效文件或存储不足时保留旧组合，不会将其他未保存的表单项写入设置。

仓库提供 [P1 中文 + C1「柔滑含笑」英文音色组合示例](examples/read-aloud/P1-C1-voice-preset.json)，可在 AI 设置中直接导入。

本地试听脚本 `scripts/mimo-voice-audition.mjs` 可生成不同方向的音色试听。在已被 Git 忽略的 `.mimo-audition.local.json` 中配置 `baseUrl`、`apiKey` 和可选的 `timeoutMs`，然后运行 `node scripts/mimo-voice-audition.mjs --config .mimo-audition.local.json --out "<绝对输出目录>"`。通过 `--preset` 选择配方：

- `default`：四款中英双语设计试听，以及使用同一份 A 音频的中英文克隆对照。
- `c-young`：三款年轻、活泼的柔滑女声，以及使用同一份 C2 音频的中英克隆对照。
- `c-mandarin`：三款清透、明快的年轻中文女声，以及使用同一份 Z2 中文音频的中英克隆对照。
- `playful-reference`：指定本地 WAV/MP3，使用同一参考音频生成自然、含笑俏皮、柔滑从容的中文朗读，以及一段英文验证。

`playful-reference` 需要增加 `--reference "<本地音频路径>" --reference-source "<公开来源页面 URL>"`，可用 `--reference-title "<音频标题>"` 标注片段。参考音频独立于生成配方，所有请求复用同一份音频，清单记录来源和文件校验值，不包含音频编码。

不同配方使用不同输出目录。输出目录包含 WAV 和记录提示词、朗读文本的 `manifest.json`；重复运行会校验并跳过已有样本。音色定稿后可删除临时配置。脚本离线测试运行 `node --test scripts/mimo-voice-audition.node-check.mjs`。

## AI 提示词优化说明

1. 复用“AI 设置”中的 Base URL、API Key、Model 和请求超时配置。
2. 在“AI 提示词优化”中选择 H3 输入模式、填写视频时长和创意描述。
3. I2VA/L2VA 上传 1 张对应关键帧，FL2VA 按首尾顺序上传 2 张图片，Ref2VA 可上传多张参考图；所选模型需要支持图像理解。
4. 生成结果包含中文审阅版和英文直用版。
5. 可选用 MiniMax-H3 官方基础写作 Skill，并可再组合一个官方风格 / 场景 Skill；选择会保存在本地。
6. 启用基础写作 Skill 后，不发送“AI 设置”中的提示词优化系统提示词，而是按当前 H3 输入模式加载基础 Skill 与对应的 Base / Ref 官方指南。
7. 未启用基础写作 Skill 时仍使用“AI 设置”中的系统提示词；风格 Skill 只提供最终提示词所需的风格约束，其中的问询、确认、媒体生成和剪辑流程不会执行。
