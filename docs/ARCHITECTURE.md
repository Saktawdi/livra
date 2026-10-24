# 架构与工具扩展

```text
React Web / Live2D
      ├─ IndexedDB：设置、凭据、会话、分组、记忆与作品
      ├─ 浏览器运行时：Agent / 工具 / Provider / Marp
      └─ 同源传输（Vite 或静态宿主）→ 上游 HTTP / SSE / 二进制资源
```

`apps/web` 负责交互及 IndexedDB 存储，`packages/runtime` 在浏览器执行 Agent、供应商适配、语音、工具和 Marp。`packages/shared` 以 Zod 定义配置、默认人偶和跨端类型。凭据保存在当前浏览器，按请求传给所选服务。

`scripts/network-relay.mjs` 由 Vite 与生产静态宿主共用，只传输请求和响应字节，支持系统代理、SSE、multipart、二进制和取消。它不运行 Agent，也不保存设置。跨来源重定向会移除认证头；网页 Cookie 不发给上游。`apps/server` 保留旧版实现和原数据库读取能力，不参与默认启动。

## Agent 生命周期

每次运行保存用户消息后，以本地事件回调发送 `start`、`reasoning`、`delta`、`tool-start`、`approval`、`tool-end`、`artifact`、`emotion`、`usage` 和 `done/error`。浏览器将工具结果交回模型，直到得到最终回答。最多 12 轮、每轮 16 次工具、运行 15 分钟。不同会话可并行，同一会话一次执行一个 Agent。停止会取消上游，保留部分回答并修复后续协议上下文。

人偶拥有系统提示、回复语言、声音、Live2D 配置、工具 allowlist 和自己的长期记忆。全局语言、人偶语言、模型返回的结构化情绪与客户端状态共同影响体验；工具结果是数据，不作为系统指令。`set_emotion` 使用固定枚举，不从回复里解析任意代码。

## 内置工具

| 工具 | 行为 |
| --- | --- |
| `list_tools` | 发现当前人偶允许且已配置的能力 |
| `set_emotion` | 更新人偶表情 / 参数 |
| `remember` | 写入当前人偶记忆 |
| `web_search` | SearXNG / Tavily 搜索与来源 |
| `generate_image` | 图像生成、参考图与作品存储 |
| `generate_music` | 同步音频生成与作品存储 |
| `create_slides` | Marp Markdown 渲染与保存 |
| `create_marp_theme` | 保存 AI 生成的 Marp CSS 主题 |
| `create_persona` | 设计人格、语言、音色、工具与 Live2D 配置卡 |

默认在生成媒体、写入记忆、调用外部工具前请求确认。人偶编辑器控制允许哪些工具；没有上游配置的工具标记不可用。工作室中点击生成或保存属于明确的手动执行。人偶生成产物须由用户预览安装，不会自动替换当前伙伴，也不会凭空创建 Live2D 模型二进制文件。

Marp 主题须包含 `/* @theme theme-name */`，Markdown frontmatter 选择 `theme: theme-name`。运行时为自定义主题继承内置 default 基础排版，再应用主题 CSS；输入拒绝 import、URL 与活动样式。已保存主题可在工作室直接选择复用。预览 iframe 使用 sandbox，Markdown 不启用原生 HTML。支持下载 Markdown、主题 CSS、完整 HTML，并由浏览器打印为 PDF；未内置 PPTX 转换器。

## 注册 HTTP 工具

在工具箱添加名称、描述、POST 地址、可选 Bearer 密钥和输入 JSON Schema，然后在人偶卡启用。例如：

```json
{
  "name": "weather_lookup",
  "title": "查看天气",
  "description": "查询某座城市的天气，返回日期和数据来源。",
  "endpoint": "https://your-service.example.com/weather",
  "inputSchema": {
    "type": "object",
    "properties": {"city": {"type": "string", "maxLength": 100}},
    "required": ["city"],
    "additionalProperties": false
  },
  "enabled": true
}
```

运行时以 JSON POST 发送模型生成的参数，AJV 校验输入，返回的 JSON 作为工具结果。网络请求最长 15 分钟，并受所属 Agent 的取消和总时限控制；结果最大 1 MB，送入模型的单次结果最多 20000 字符。返回结果可供 Agent 解释，文件作品存储需要扩展工具注册表。不要把外部返回的文字当作新的授权。

扩展能力时，在 `packages/runtime/src/tools.ts` 的注册表添加 schema、可用状态、审批需求与 execute 实现，复用 `artifact()` 保存作品。通过 `network()` 发起外部请求，复用统一传输、超时和取消。内置工具名不可被自定义工具覆盖。

## 当前边界

本版本提供受控的 HTTP / 创作工具执行，不提供任意主机 Shell、无人监管的浏览器控制或代码沙箱。记忆为可管理的文本事实，不是向量检索。界面主要为中文，核心导航支持中文、英文、日文；回复语言可以任意配置。供应商计费、额度、模型能力与内容政策由所选服务决定。
