# 第三方资源声明

Livra 自有应用代码使用根目录 MIT License。下列资源具有独立许可，不因放入开源仓库而自动变为 MIT：

| 资源 | 来源 / 许可 |
| --- | --- |
| Live2D Cubism Core | `apps/web/public/vendor/live2dcubismcore.min.js`，继承自原仓库，保留 Live2D Inc. 文件内声明；[Cubism SDK 使用许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) |
| Haru / Hiyori 模型 | Live2D/CubismWebSamples，固定 `4-r.1` tag；各模型目录附来源声明；[Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、[Sample Model Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html) |
| pixi-live2d-display 0.4.0 | [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)，MIT，UMD 构建随应用提供；完整 LICENSE 位于 vendor 目录 |
| PixiJS | [pixijs/pixijs](https://github.com/pixijs/pixijs)，MIT |
| Lucide 图标 | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)，ISC |
| React、Fastify、Vite、Zod、Marp、Marked、Undici、AJV | 各自 npm 包声明的开源许可 |
| DOMPurify | Apache-2.0 OR MPL-2.0 |

自部署或再分发时应查看各许可证适用范围；上传或配置自己的模型、音色、素材时请使用有权使用的资源。第三方依赖版本由 `package-lock.json` 固定。
