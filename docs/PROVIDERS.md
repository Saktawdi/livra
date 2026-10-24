# 模型与声音连接

无需 Livra 账号：在「偏好设置 → 模型连接」添加自己的服务和密钥，勾选或手动填写模型，并保存设置。密钥保存在服务端，界面只返回是否已配置。更换 Base URL 时请确认该地址属于你信任的服务。

## 对话 / Agent

| 协议 | Base URL 示例 | 请求路径 |
| --- | --- | --- |
| OpenAI Chat 兼容 | `https://api.openai.com/v1` | `chat/completions` |
| OpenAI Responses | `https://api.openai.com/v1` | `responses` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `messages` |
| Gemini 原生 | `https://generativelanguage.googleapis.com/v1beta` | `models/<id>:streamGenerateContent` |
| Ollama | `http://localhost:11434/v1` | Chat 兼容，需要管理员允许内网 |

模型列表可拉取、搜索并勾选，也可手动填写。实际的工具、图片输入、推理档位和模型权限由上游决定。Anthropic thinking 签名、Gemini thoughtSignature 与 Responses 加密推理项保留在服务端协议历史，用于后续工具轮次。

Sakta 是独立的可选登录适配：账号密码通过后端发送至 Sakta 的 form 登录接口，Token 留在后端；模型使用 `/v1/models` 与 `/v1/chat/completions`。可用免费模型与额度由账号权限决定。该适配不使用 Responses。

## Fish Audio

1. 添加模型连接，点击 **Fish Audio** 预设，填入你的 Fish API Key。
2. 默认 Base URL 为 `https://api.fish.audio/v1`，用途为语音合成，协议为 Fish Audio。
3. 推荐选择 `s2.1-pro`；其他内置型号包括 `s2.1-pro-free`、`drama-3` 和 `s2-pro`。内置列表不代表密钥权限已验证。
4. 在「声音」选择此语音模型，填写默认音色 **reference_id**；人偶卡可以覆盖音色与朗读语言。留空音色时使用服务默认声音。
5. 保存后，点击助手消息的朗读按钮，或开启自动朗读。

后端调用 `POST /v1/tts`，使用 Bearer 鉴权和 **model 请求头**，JSON 使用 `text`、`reference_id`、`format: mp3`、`prosody.speed`、`latency` 与可选 `language`。不把 Fish 音色替换为 OpenAI 的 `alloy`。语言标签只影响文本归一化（数字、日期等读法），不会改变模型音色或口音；混合语言推荐 auto。

目前支持单音色 TTS、0.5–2.0× 语速、均衡/音质偏好、停止请求，以及播放音量驱动的 Live2D 口型。服务返回音频流，Livra 有界收集为 MP3 后播放（上限 10 MB、4000 字符）；尚未提供 token 级实时语音、音色克隆或多人对话合成。

接口依据 [Fish 官方 TTS 文档](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) 与用户提供的文档校对。真实语音质量和账号额度需要你配置有效密钥后验证。

## 其他语音

OpenAI 兼容协议使用 `POST /audio/speech`，发送 `model`、`input`、`voice`、`speed` 与 `response_format: mp3`。空音色默认为 `alloy`。不选语音连接时使用浏览器 SpeechSynthesis，浏览器朗读无法读取真实音量，口型使用近似动画。

麦克风使用浏览器的 SpeechRecognition。支持程度与识别服务由浏览器决定；开启前会请求权限。它与 Fish TTS 是独立能力。

## 图像与音乐

图像支持 OpenAI Images 兼容接口，以及 Gemini 原生 `generateContent`。参考图分别走 multipart `images/edits` 或 Gemini `inlineData`。上游须支持所选尺寸与模型；不承诺任意 Chat 接口都能生图。

内置音乐适配使用明确的同步协议：

```http
POST <Base URL>/audio/generations
Authorization: Bearer <你的密钥>
Content-Type: application/json

{"model":"your-model","prompt":"曲风和编排","lyrics":"可选歌词","duration":30}
```

响应示例：

```json
{"data":[{"audio_url":"https://example.com/output.mp3"}]}
```

也接受 `data[0].url` 或 `data[0].b64_json`。Livra 下载音频后保存作品，不依赖临时链接长期有效。异步任务类音乐服务请通过自定义 HTTP 工具或自己的适配网关接入；此接口没有宣称兼容 Suno 的非官方端点。
