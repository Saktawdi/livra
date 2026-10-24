# 部署 Livra

## Docker：一个服务

```sh
git clone https://github.com/Saktawdi/livra.git
cd livra
cp .env.example .env
docker compose up -d --build
```

打开 http://localhost:3400。示例 Live2D 资源随仓库提供，不依赖远程人偶 CDN。首次构建需要 npm 与 Docker Hub 网络。应用、搜索和推理接口在运行时按你的配置访问。

默认仅绑定宿主机回环地址。公网服务在前面配置 HTTPS 反向代理，并设置 `PUBLIC_ORIGIN=https://你的域名`。`ACCESS_PASSWORD` 可以为整个部署增加访问密码。Sakta 不参与 Livra 本地空间的身份管理。

例如使用 Caddy：

```caddy
livra.example.com {
    reverse_proxy 127.0.0.1:3400 {
        flush_interval -1
    }
}
```

## 前端与 API 独立容器

```sh
docker compose -f compose.split.yaml up -d --build
```

Web 是 Nginx 静态服务，API 是独立 Node 服务；浏览器通过同源 `/api` 代理访问。默认 Web 绑定 http://localhost:5180，API 只在容器网络内开放。可修改端口映射。此模式不要同时启动默认 Compose，以免端口或数据卷混淆。

SSE 代理须关闭缓冲，并给长请求留足时间；示例 `deploy/nginx.conf` 已处理。TLS 放在入口代理层。默认应用部署在域名根路径。

## Node 部署与开发

需要 Node **22.18+**，推荐 Node 24 LTS：

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

开发使用 `npm run dev`，Web 为 http://localhost:5180，API 为 http://localhost:3400。`npm run check` 进行类型与集成检查。

`apps/web` 可以单独执行 `npm run build -w @livra/web`，将 `apps/web/dist` 放到静态服务器；配置同源 `/api` 反向代理指向 `apps/server`。需要不同源时，在构建前设置根 `.env` 的 `VITE_API_URL`，并在服务端设置 `PUBLIC_ORIGIN` 为**前端**来源。Cookie 使用 SameSite=Lax，推荐同一站点；跨站点的第三方 Cookie 限制不适用这种部署方式，改用同源代理。

| 配置                      | 默认与用途                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `HOST` / `PORT`           | Node 默认 `127.0.0.1:3400`；容器使用 `0.0.0.0`                                          |
| `DATA_DIR`                | 根目录 `.data`；容器 `/app/data`                                                        |
| `PUBLIC_ORIGIN`           | 公网 HTTPS 来源，同时启用 Secure Cookie                                                 |
| `ACCESS_PASSWORD`         | 可选的部署访问密码                                                                      |
| `SAKTA_BASE_URL`          | 默认 `https://api.sakta.top`；也接受以 `/v1` 结尾的地址并保留部署前缀；空字符串关闭接入 |
| `SEARXNG_URL`             | 可选的部署默认搜索地址，SearXNG 需启用 JSON                                             |
| `ALLOW_PRIVATE_ENDPOINTS` | 默认 false；开启后允许 Ollama、内网搜索和自定义工具                                     |
| `TRUST_PROXY`             | 默认不信任转发头；填写可信代理 IP/CIDR 或 `loopback`，逗号分隔                          |
| `VITE_API_URL`            | 仅构建时使用；空表示同源                                                                |

## 数据、密钥与备份

- SQLite、WAL 与 `vault.key` 都在数据目录。设置、凭据、聊天和作品使用 AES-256-GCM 加密；密钥和数据库同机，不能抵御已取得主机权限的攻击者。
- **整目录备份**应停止写入后复制数据卷，保留 `vault.key` 与数据库。丢失密钥无法解密。不要提交数据目录到 Git。
- 应用「数据与用量 → 导出数据」可导出可移植 JSON。导出不含 API Key、搜索密钥与 Sakta Token，恢复后需重新配置凭据。导入会合并聊天、作品与记忆，替换人偶和偏好；先备份当前空间。
- 每个浏览器以 HttpOnly Cookie 持有自己的匿名空间。Sakta 登录只是模型授权，不会把不同设备的数据自动同步。清除 Cookie 会失去原空间入口；更换设备前请导出。
- 当前为单实例 SQLite 架构；不要多副本并发共享一个数据库文件。

## Live2D 资源

内置 Hiyori / Haru / Mark / Natori / Rice 及 DS 鲸鱼娘。管理员可以把自己有权使用的模型完整目录放到 `apps/web/public/models/<名称>/` 后重新构建；人偶卡填写 `/models/<名称>/<名称>.model3.json`，配置动作组和表情名。外部 HTTP(S) 模型须自行配置 CORS。Core 脚本只允许 `/vendor/` 本地路径。

`npm run setup:live2d` 从 Live2D 官方固定 tag `4-r.1` 恢复示例文件，并恢复鲸鱼娘。`npm run setup:whale` 单独恢复鲸鱼娘固定版本及署名文件，并将 44 种表情注册到模型清单。鲸鱼娘美术资源使用 **CC BY-NC-SA 4.0**（署名、非商业、相同方式共享），不适用应用代码的 MIT 许可。模型、Core 和应用代码适用不同许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。

形象库另支持同步公开远端来源，默认连接官方精选、hacxy 和 fghrsh。目录由服务器按工作区缓存，模型资源由浏览器按需加载，因此服务器需要能访问 GitHub API/目录 CDN，浏览器需要能访问资源域名。网络受限时可在“形象库 → 管理来源”停用来源，本地示例仍可使用。自定义来源可填写 GitHub 仓库/子目录或静态 `model_list.json`；使用范围会随收藏和 Agent 作品保留。Cubism 2 与 4 的运行时均随应用提供；Cubism 5 尚未支持。

## 旧版本

原 Vue 版本保存在 `legacy-vue-0.6.8` 标签。Livra 的服务端存储、接口与人偶卡格式均已重做，不直接读取旧浏览器缓存，也不沿用旧 `.env`。需要回看旧版本可在独立目录 checkout 此标签。
