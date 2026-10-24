# Livra · 灵伴

**与人偶同桌。** 一个有角色在场的个人 Agent 工作台：聊日常，也一起完成事情。开源、自部署，自由选择模型、声音和 Live2D 形象。

![Livra 相伴空间](docs/images/desktop-companion.png)

相伴时，人偶留在桌边；共事时，展开执行步骤和作品。切换空间保留对话上下文，工具产物可以就地打开。

## 能做什么

- **Live2D 人偶**：内置 Hiyori / Haru 官方示例，可配置人格、回复语言、动作组、情绪表情、音色、工具和可编辑记忆。支持目光跟随、点击互动与语音口型。
- **多轮 Agent**：工具执行、审批、停止、部分回复保留、历史会话和用量。支持 OpenAI Chat / Responses、Anthropic Messages、Gemini 原生协议。
- **自己的模型**：匿名 BYOK、本地兼容服务，或可选的 Sakta 登录使用账号可访问的免费模型。Sakta 可由部署者关闭。
- **创作工作室**：图像与参考图、音乐、Marp 演示文稿、可复用主题；同一组能力也注册为 Agent 工具。Agent 可以生成人偶配置卡，预览后添加。
- **声音**：Fish Audio 原生 TTS、OpenAI 兼容 TTS、浏览器朗读；人偶可覆盖全局音色与朗读语言。
- **日常操作**：明暗主题、键盘快速访问、斜杠工具、附件、草稿保留、专注计时、移动端布局和数据导入导出。

![共事与工具执行](docs/images/desktop-work.png)

上图使用明确标注的本地模拟服务验收多轮执行，不表示真实上游模型的输出质量。

## 快速启动

### Docker

```sh
git clone https://github.com/Saktawdi/livra.git
cd livra
docker compose up -d --build
```

打开 **http://localhost:3400**。没有模型密钥也能进入空间、配置人偶、编辑和保存 Marp；推理与媒体生成需要连接对应服务。

前后端独立容器：

```sh
docker compose -f compose.split.yaml up -d --build
```

此时打开 **http://localhost:5180**。Web 使用 Nginx，API 使用 Node，同源代理处理 HTTP 与 SSE。

### 本地开发

Node **22.18+**，推荐 Node 24：

```sh
npm ci
cp .env.example .env
npm run dev
```

Web：http://localhost:5180，API：http://localhost:3400。生产构建使用 `npm run build`、`npm start`。

## 连接模型与声音

1. 打开「设置 → 模型连接」，选择协议、填写 Base URL 与 API Key，拉取或手动填写模型 ID，保存连接与设置。
2. 在对话输入框选择模型。使用本机 Ollama 等私网服务时，由部署管理员设置 `ALLOW_PRIVATE_ENDPOINTS=true`；容器中使用可访问宿主机的地址。
3. Fish 选择 **Fish Audio** 预设，默认使用 `s2.1-pro`，然后在「声音」选择连接并填写音色 `reference_id`。人偶卡可以单独设置音色与语言。
4. 使用 Sakta 时，在「Sakta 账号」登录，再在对话中选择账号允许的模型。

生成图像、音乐或调用外部工具需要相应连接。音乐适配接受同步 `POST /audio/generations`，异步服务可以通过自定义 HTTP 工具接入。协议细节见 [供应商接入](docs/PROVIDERS.md)。

## 数据与部署

凭据保存在后端；SQLite 中的设置、会话、记忆和作品使用 AES-256-GCM 加密。浏览器以 HttpOnly Cookie 访问自己的匿名空间，Sakta 登录只用于模型授权。

清除 Cookie 后不会自动找回原空间；换设备前请导出。便携 JSON 导出不包含密钥，完整服务备份须同时保存数据库与 `vault.key`。当前采用单实例 SQLite，不支持多人同步或数据库多副本。

公网部署、HTTPS、访问密码、备份与 Live2D 资源替换见 [部署文档](docs/DEPLOYMENT.md)。

## 项目结构与开发检查

```text
apps/web         React + TypeScript + Vite / Live2D
apps/server      Fastify / Agent / 供应商适配 / 加密 SQLite
packages/shared  Zod 配置与跨端类型
tests            协议、Agent、语音、存储和安全集成测试
```

```sh
npm run check         # 类型检查与集成测试
npm run format:check  # 代码格式
npm run build         # Web 与 API 生产构建
node scripts/smoke.mjs http://localhost:3400
```

Smoke 使用独立匿名空间创建并清理一份验收作品。设计定位与验收证据见 [产品理念](docs/PRODUCT.md)、[设计体系](docs/DESIGN.md)、[RSI 记录](docs/RSI.md)；工具开发见 [架构文档](docs/ARCHITECTURE.md)。

## 当前边界与许可

Fish 当前使用有大小上限的音频合成后播放，未实现实时双向语音或音色克隆。Marp 可导出 Markdown / HTML，HTML 可由浏览器打印为 PDF，未内置 PPTX 转换。界面以中文为主，核心导航支持中文、英文、日文；回复语言可自定义。Agent 不包含任意主机代码执行沙箱。

应用代码使用 [MIT License](LICENSE)。Live2D Core、模型与其他第三方资源各自适用原许可证，见 [第三方声明](docs/THIRD_PARTY_NOTICES.md)。示例角色并非 Livra 原创形象。

本项目由 `ai_tools_vue` 重建。原 Vue 版本保留于 `legacy-vue-0.6.8` 标签；新旧存储不直接兼容。
