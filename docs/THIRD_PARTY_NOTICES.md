# 第三方资源声明

Livra 自有应用代码使用根目录 MIT License。下列资源具有独立许可，不因放入开源仓库而自动变为 MIT：

| 资源                                                 | 来源 / 许可                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live2D Cubism Core                                   | `apps/web/public/vendor/live2dcubismcore.min.js`，继承自原仓库，保留 Live2D Inc. 文件内声明；[Cubism SDK 使用许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)                                                              |
| Live2D Cubism 2 Core                                 | `apps/web/public/vendor/live2d.min.js`，取自 [live2d-widget 固定版本](https://github.com/stevenjoezhang/live2d-widget/blob/34b27cc8bcbac20e56344429e890b9bad885d002/dist/live2d.min.js)，保留文件开头的原 SDK 许可链接和可再分发代码声明；不适用 Livra 的 MIT 许可 |
| Haru / Hiyori / Mark / Natori / Rice 模型            | Live2D/CubismWebSamples，固定 `4-r.1` tag；各模型目录附来源声明；[Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、[Sample Model Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)          |
| pixi-live2d-display 0.4.0                            | [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)，MIT，UMD 构建随应用提供；完整 LICENSE 位于 vendor 目录                                                                                                                              |
| PixiJS                                               | [pixijs/pixijs](https://github.com/pixijs/pixijs)，MIT                                                                                                                                                                                                             |
| Lucide 图标                                          | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)，ISC                                                                                                                                                                                                 |
| React、Fastify、Vite、Zod、Marp、Marked、Undici、AJV | 各自 npm 包声明的开源许可                                                                                                                                                                                                                                          |
| DOMPurify                                            | Apache-2.0 OR MPL-2.0                                                                                                                                                                                                                                              |

自部署或再分发时应查看各许可证适用范围；上传或配置自己的模型、音色、素材时请使用有权使用的资源。第三方依赖版本由 `package-lock.json` 固定。

DS 鲸鱼娘（DeepSeek 大肥鱼）来自 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d/tree/f977bef508690e75ba6535cd8f4ce18e7f6ba9b0)，固定版本 `f977bef508690e75ba6535cd8f4ce18e7f6ba9b0`。美术作者为 **上善无形 / ZipZipPipe / 氵六青**；模型与贴图、表情、动作等美术资源适用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)，包含署名、非商业及相同方式共享要求。上游仓库的 MIT 只覆盖代码，不能用于替代美术许可。素材目录保留 `NOTICE.md`、`PROVENANCE.md`、`AUTHORS.md` 和 `LIVRA-NOTICE.md`。Livra 将上游清单中的 44 种表情注册进 `FileReferences.Expressions`，此修改同样遵循资源许可。

随行伙伴的交互参考了 [ankesu/dsh-live2d-pet](https://github.com/ankesu/dsh-live2d-pet) 的真实会话事件、工作状态优先和拖动收起方式；Livra 的 React 界面与状态连接在本仓库实现。

远端目录默认连接 Live2D 官方、hacxy 和 fghrsh，模型按需从各来源加载。hacxy 和 fghrsh 的素材仅供学习或非商业使用；此范围会显示在形象预览、来源管理及 Agent 结果中。收藏保留出处，不改变素材授权。运行时使用 `pixi-live2d-display-all-0.4.0.min.js` 的 Cubism 2/4 合并构建，沿用上表的 MIT 许可。
