# 远端 Live2D 形象库调研

核验日期：2026-10-24。范围为 Livra 当前使用的 Live2D 形象；结论来自项目维护者的仓库、目录和实际资源请求。

## 结论

远端形象库可以接入，社区已有成熟做法。没有发现一个统一覆盖所有模型、版本和授权的官方目录 API，但可以适配现有静态目录、GitHub 资源树和模型 CDN。

本次已补齐**远端目录发现与同步**。形象库和 Agent 共享已启用来源的目录，支持按来源搜索、预览和收藏；同时保留五个本地官方示例。目录适配器支持 GitHub 仓库/子目录，以及静态 `model_list.json`。

## 已核验来源

| 来源                                                                  | 已存在的目录/资源方式                                                                            | 对 Livra 的价值和接入条件                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples) | 官方资源树中的 `.model3.json`、`.moc3`、纹理和动作文件                                           | 优先作为官方来源。当前固定的 `4-r.1` 有五个模型；`4-r.7` 有六个，多出 Mao。模型具有官方素材使用条款。                                       |
| [fghrsh/live2d_api](https://github.com/fghrsh/live2d_api)             | 根目录 `model_list.json`、每个模型的 `index.json`、换装列表 `textures.cache`；可直接使用静态 CDN | 已有目录格式，适合做首个通用适配器。核验版本有七个顶层分组、27 个模型配置，换装另计。仓库已归档，模型采用旧 Cubism 2 格式，需要补齐运行时。 |
| [hacxy/l2d-models](https://github.com/hacxy/l2d-models)               | 仓库 `models/` 资源树；维护者提供 `model.hacxy.cn` CDN 和在线查看器                              | 有现成浏览器加载地址，包含 Cubism 2 和 3+ 格式。仓库中找到十个 `.model3.json`，可以建立目录适配；README 未提供统一目录 API。                |
| [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)       | 大型模型资源树                                                                                   | 社区使用较广，核验时约 3.47k stars；作者说明多数从游戏提取，不保证配置正确。适合提供来源发现与按条目校验，需要保留原始出处和使用范围。      |
| [imuncle/live2d](https://github.com/imuncle/live2d)                   | Cubism 2/3 资源目录；Cubism 3 演示使用 `charData.js` 索引                                        | 可作为补充源，但不是统一模型 API。核验树中有 41 个 `.model3.json`；README 中历史总数口径不同，不能直接当作可用模型数。                      |

社区库的代码许可证不等于模型素材许可证。fghrsh、hacxy、imuncle 的 README 均限定模型学习或非商业用途；Eikanya 也提示不要商用。产品目录应显示来源和使用范围，不能将这些来源统一标成“免费商用”。

### 已有成熟目录用法

[live2d-widget 的模型管理器](https://github.com/stevenjoezhang/live2d-widget/blob/34b27cc8bcbac20e56344429e890b9bad885d002/src/model.ts) 会读取：

```text
{sourceBase}/model_list.json
{sourceBase}/model/{modelPath}/index.json
{sourceBase}/model/{modelPath}/textures.cache
```

其中 `model_list.json` 的 `models` 元素可以是路径字符串或一组路径；数组用于同组切换。模型配置与贴图换装需要分别解析，不能把每张服装纹理都当成独立人偶。

[维护者 README](https://github.com/stevenjoezhang/live2d-widget#readme) 已说明，1.0 起可以仅靠静态资源提供模型，无需专门部署 PHP API；默认 CDN 指向 fghrsh 的资源库。该前端目前支持按模型版本加载不同运行时。它是远端目录方案的参考实现，本身不是素材模型库。

## 实际可达性与兼容性

本地 Cubism 4 Core 查询结果为 **4.2.4**，支持的最高 MOC 格式枚举为 4（Cubism 4.2）。本次另补齐本地 Cubism 2 Core 和双版本渲染构建，适配旧口型/表情参数 ID。选用远端形象时会核验实际模型文件头，拒绝需要 Cubism 5 的文件，并从配置读取真实动作组。

| 实测项目                        | 结果                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| fghrsh 固定提交的 jsDelivr 目录 | `model_list.json` 返回 200，响应允许跨域 `*`；Pio 的 `.moc` 和纹理也返回 200、允许跨域                   |
| 官方固定 `4-r.1` 的 Hiyori      | 模型 JSON、`.moc3`、纹理均返回 200，响应允许跨域 `*`                                                     |
| 官方 `4-r.7` 的 Mao             | 模型 JSON、`.moc3`、纹理均返回 200；使用项目现有 Core 成功创建模型并执行更新，112 个参数、224 个绘制对象 |
| hacxy CDN 的 Senko              | 模型 JSON、`.moc3`、纹理均返回 200；使用项目现有 Core 成功创建模型并执行更新，212 个参数、263 个绘制对象 |

调研阶段的 Core 核验在 Node VM 中执行。接入后另在隔离的应用数据中，用真实公网资源验证了 Mao（Cubism 4）、Pio（Cubism 2）、Senko 的 WebGL 展示，以及收藏后从“我的形象”复用；Senko 同时通过 390 × 844 手机布局检查。HTTP/CORS 结果是当次探测结果。

验证用地址：

- [fghrsh 固定提交目录](https://fastly.jsdelivr.net/gh/fghrsh/live2d_api@02dc5b3aaf5cee35455c816596820055c5363205/model_list.json)
- [Mao 模型配置](https://raw.githubusercontent.com/Live2D/CubismWebSamples/4-r.7/Samples/Resources/Mao/Mao.model3.json)
- [Senko 模型配置](https://model.hacxy.cn/Senko_Normals/senko.model3.json)
- [官方 4-r.7 素材许可说明](https://github.com/Live2D/CubismWebSamples/blob/4-r.7/LICENSE.md)
- [pixi-live2d-display 的 Core 与版本要求](https://github.com/guansss/pixi-live2d-display#requirements)

本次核验的资源树版本：

| 来源             | 版本                                                |
| ---------------- | --------------------------------------------------- |
| 官方现用示例     | `4-r.1`，`118ba957197f1b7806aa9c448c95efc7113e1d5d` |
| 官方新增候选 Mao | `4-r.7`                                             |
| fghrsh           | `02dc5b3aaf5cee35455c816596820055c5363205`          |
| hacxy            | `09e0df14ac8e7b29d170a57f4ce939f68d66197b`          |
| imuncle          | `b5caf5390c8c226f19c817ea37d5bc4452d85209`          |

官方当前 `develop` 已包含 Cubism 5.3 的样例工程，资源树有八个模型；不能将移动分支直接用作当前 4.2.4 Core 的默认资源源。

## 建议的 Livra 接入方式

1. **引入模型来源。** 支持官方精选来源、社区来源和用户自定义来源。先实现静态 `model_list.json` 与 GitHub 资源目录两种适配器，统一输出名称、模型 URL、来源、版本、使用范围、动作和表情信息；固定资源版本。
2. **让 Agent 能发现远端形象。** 扩展 `list_live2d_models`，分页搜索已启用来源的缓存目录，返回稳定 ID 与兼容状态。`create_persona` 按 ID 解析并校验所需模型，避免仍然只能选择内置和用户已手动保存的形象。
3. **提供完整加载状态。** 首次同步显示骨架和“正在获取形象”；刷新时保留已缓存目录。来源失败有单独的重试入口；条目失败不将整个形象库清空。按需加载单个人偶预览，避免同时创建大量 WebGL 画布。
4. **把版本兼容性落实到条目。** 当前可先接入核验过的 Cubism 3/4 资源；补充固定版本的 Cubism 2 Core，并适配旧参数 ID、口型和动作后，再开放旧模型。Cubism 5 单独验证。解析动作组实际名称，不能给所有来源写死 `Idle` / `TapBody`。
5. **连接收藏与复用。** 选择远端形象后保存来源与模型配置，进入“我的形象”，供后续创建人偶复用。来源地址和模型引用采用现有出站校验，限制目录体积、并发和超时，远端目录不能指定执行脚本。

优先顺序：官方精选与 hacxy 的兼容条目先形成可浏览的远端来源；补齐 Cubism 2 后接入 fghrsh 静态目录；Eikanya、imuncle 作为可选补充来源。这样能扩大实际可用的选择范围，并让 Agent 与用户看到同一份来源目录。

## 已实现的接口与缓存

- `GET /api/live-models/sources/:id`：按来源获取目录；`?refresh=1` 手动刷新。前端逐个来源加载，保留其他来源的结果；首载提供骨架和同步状态。
- `GET /api/live-models/catalog`：合并本地、收藏和已启用远端来源的目录与同步状态。旧 `/api/live-models` 保留本地目录响应，兼容已有调用。
- `POST /api/live-models/resolve`，传入 `{ id }`：读取选中模型配置、验证文件头并推断动作组，返回可保存的完整配置。
- Agent 的 `list_live2d_models` 默认查询同一合并目录；支持 `source`、`query`、`offset`、`limit`。`create_persona` 调用同一个解析过程，作品保留形象出处与使用范围。
- 缓存按工作区和来源配置隔离，保存到现有加密数据库，六小时内复用；请求合并，更新失败时保留缓存并显示“更新失败”。停用来源后不再参与远端搜索，已收藏的形象仍可使用。
- 手机形象列表支持横向浏览与方向键切换；来源管理与添加表单使用完整内容区域。模型预览资源加载超过 30 秒会显示重试入口。
- GitHub 子目录直接请求该子树，避免为一个角色扫描整个大型仓库；每个来源最多返回 500 个条目，截断状态可见。单次远端请求限时 12 秒，目录限 6 MB，配置限 500 KB。

初次真实同步获取了官方精选 1 个新增条目、hacxy 20 个条目、fghrsh 27 个条目，共 48 个远端条目；这不是所有条目均已逐个渲染验收的声明。

新增回归测试位于 `tests/live-models.test.ts`，涵盖目录解析、路径编码、动作组、缓存回退、来源变更、停用、工作区隔离、不兼容文件，以及 UI/Agent 目录一致性与作品来源保留。

验收记录：[检查结果](verification/remote-live2d.json)、[Mao](images/remote-model-mao.png)、[Pio](images/remote-model-pio.png)、[Senko](images/remote-model-senko.png)、[手机预览](images/remote-model-mobile.png)。
