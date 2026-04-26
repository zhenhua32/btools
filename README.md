# 浏览器工具集

BTools 是一个基于 Vue 3 和 Chrome Extension Manifest V3 的浏览器工具集，当前包含文本处理、书签处理和 AI 翻译等工具。

## 当前功能

- 文本对比
- JSON 格式化
- 编码转换
- 书签有效性检查
- 书签合并
- AI 翻译
	- 段落流结果展示
	- 左右对照翻译
	- OpenAI 兼容接口配置

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
