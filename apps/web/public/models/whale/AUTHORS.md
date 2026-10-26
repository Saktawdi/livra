# 作者与致谢 / Authors & Credits

## 插件本体（代码、整合、UI）

| 角色 | 署名 |
| --- | --- |
| **插件作者** —— 把模型接进 DSH Web GUI、写联动/菜单/交互/测试 | **Andersen216**（<https://github.com/Andersen216>） |

代码按 **MIT** 许可发布（见 [`LICENSE`](LICENSE)）。
署名为 **Andersen216**（与 GitHub 账号同名，主页 <https://github.com/Andersen216>），
可作为 `package.json` 的 `author` 字段与 `LICENSE` 的版权行。

## 美术素材（模型、贴图、表情、动作）

**这些素材不是 MIT，也不可以按 MIT 使用。**
鲸鱼娘这个角色形象是**三重版权链**，请三位都署名：

| 版权所有人 | 贡献 | 主页 |
| --- | --- | --- |
| **上善无形**（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | <https://space.bilibili.com/4456176> |
| **ZipZipPipe** | 加入 DeepSeek 元素的「女仆鲸鱼娘」二次设计 | <https://space.bilibili.com/4168597> |
| **氵六青** | 本仓库所用 **Live2D 模型**（绑定、动作、表情） | <https://space.bilibili.com/11272072> |

形象链：上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化。

模型包自带的《使用须知》原文（见 [`PROVENANCE.md`](PROVENANCE.md)）写明：
模型**无偿分享**，**允许**商用直播与自印物料，**禁止**任何形式的盗用与出售。
氵六青也已授权本项目转载与开源该模型。

### 但本项目是**非商业**的

Live2D 作者同意转载，并不解除角色形象本身的许可条件。所以：

- 本项目（插件代码与随附素材）**完全免费、非商业用途**：
  不收费、不带货、不接广告变现、不卖周边、不作为任何付费产品或服务的卖点。
- 改编、再分发本项目的**美术素材**时，请按
  **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)**
  （署名 — 非商业性使用 — 相同方式共享）执行，并注明上面三位版权所有人，
  同时**说明做过哪些修改**。
- 插件**代码**（`lib/`、`tools/`、`cordis.patch.yml`）走 MIT，不受 NC 限制；
  但代码里随附的模型素材仍然受上面的非商业条款约束。

## 运行时与第三方库

| 组件 | 许可 |
| --- | --- |
| Live2D Cubism Core（`live2dcubismcore.min.js`） | Live2D Inc. 版权所有，按 Live2D Cubism SDK 许可（Redistributable Code）使用 |
| PIXI.js 6.5.10（`pixi.min.js`） | MIT |
| pixi-live2d-display 0.4.0（`cubism4.min.js`） | MIT |

## 想用这个模型做别的东西？

先去 B 站找 **氵六青**（模型）与 **上善无形 / ZipZipPipe**（角色形象）确认授权范围，
别把「这个插件能免费用」理解成「这个模型可以商用」。
