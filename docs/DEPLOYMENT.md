# 部署 Livra

Livra 的会话、设置、凭据、记忆和作品保存在浏览器 IndexedDB；Agent 与工具也在浏览器执行。默认宿主只提供静态文件和同源网络传输。开发与生产复用同一传输模块，供应商无需专门开放网页 CORS。

## 本地开发

需要 Node **22.18+**，推荐 Node 24：

```sh
npm ci
cp .env.example .env
npm run dev
```

打开 **http://localhost:5180**。模型、语音和工具连接在界面中配置，无需另起 API 服务。

## 生产启动

```sh
npm run build
npm start
```

默认地址 **http://localhost:3400**。`HOST` / `PORT` 可在根 `.env` 或进程环境中配置。使用随项目提供的宿主可保留统一的流式传输、参考图上传、音频下载和远端模型资源加载能力。

## Docker

```sh
docker compose up -d --build
```

默认只映射到宿主机回环地址 **http://localhost:3400**。容器启动的是静态宿主，不运行旧版 Fastify 业务服务。数据在访问者的浏览器中，不需要为新版本挂载 SQLite 数据卷。以前的数据卷不会因配置更新而自动删除。

可选 Nginx 静态入口：

```sh
docker compose -f compose.split.yaml up -d --build
```

打开 **http://localhost:5180**。Nginx 的 `/__livra_transport` 转给 Node，HTTP 与 SSE 关闭代理缓冲；其余请求直接提供静态文件。TLS 可放在入口反向代理，长请求需要至少 900 秒读取超时。公网个人部署的访问控制应由入口代理配置。

## 网络与代理

传输模块支持 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`，Windows 未显式配置时读取当前用户的系统代理。localhost 默认绕过代理。TUN 代理返回的 `198.18.0.0/15` 地址不会再被旧业务层的私网检查误拦截。

请求只允许 HTTP(S)，拒绝 URL 中的用户名密码，跨来源重定向会删除认证头，浏览器 Cookie 不会传给供应商。同源接口保留上游状态码与错误，网络失败返回连接原因；聊天流按块传递，取消会中止上游。远端 Live2D 清单、纹理、模型与动作也复用此层。

| 配置 | 用途 |
| --- | --- |
| `HOST` / `PORT` | Node 静态宿主地址，默认 `127.0.0.1:3400` |
| `HTTP_PROXY` / `HTTPS_PROXY` | 上游 HTTP / HTTPS 代理 |
| `NO_PROXY` | 额外绕过代理的主机或域名 |

容器无法通过 `localhost` 访问宿主机上的 Ollama 或代理，需使用容器可达的宿主机地址。

## 数据与迁移

浏览器、来源域名和端口共同决定数据空间。清除站点数据会删除当前空间；换设备、浏览器或端口前请在「数据与用量」导出。便携导出不包含连接密钥，导入后重新填写凭据；头像、会话分组、颜色和收展状态随备份保留。当前不提供跨设备同步。

旧版加密 SQLite 与 `vault.key` 仍可用于读取原空间。已有本地升级入口会检查原来的会话 Cookie，仅迁移对应空间，原数据库保留。默认静态宿主不会公开原数据。

## Live2D 资源

内置 Hiyori / Haru / Mark / Natori / Rice 及 DS 鲸鱼娘。可将有权使用的完整模型目录放到 `apps/web/public/models/<名称>/` 后重新构建；人偶卡填写 `/models/<名称>/<名称>.model3.json`。也可使用远端 HTTP(S) 模型地址，相关资源通过同源传输加载。Core 脚本只允许 `/vendor/` 本地路径。

`npm run setup:live2d` 恢复 Live2D 官方固定 `4-r.1` 示例和鲸鱼娘，`npm run setup:whale` 单独恢复鲸鱼娘及署名文件。鲸鱼娘美术资源使用 **CC BY-NC-SA 4.0**，不适用应用代码的 MIT 许可。完整声明见 [第三方声明](THIRD_PARTY_NOTICES.md)。支持 Cubism 2 / 3 / 4；Cubism 5 尚未支持。

## 开发检查

`npm run check` 执行类型检查和单元、协议回归；`npm run format:check` 检查格式；`npm run build` 生成页面。页面功能由使用者手动验收，CI 不启动页面执行自动验收流程。

旧 Vue 版本保存在 `legacy-vue-0.6.8` 标签；旧版服务可通过 `npm run legacy:server` 单独运行。
