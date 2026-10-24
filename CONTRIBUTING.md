# 参与 Livra

使用 Node 22.18+（推荐 24），在仓库根目录运行 `npm ci`、`npm run dev`。Web 位于 5180，API 位于 3400。

提交改动前运行：

```sh
npm run format
npm run check
npm run build
npm audit --omit=dev --audit-level=high
```

前端变更请核验 375 / 768 / 1440 宽度、键盘焦点、空/忙/错/成功状态。交互应符合 [产品理念](docs/PRODUCT.md) 与 [设计体系](docs/DESIGN.md)，说明实际解决的问题与验证结果。

供应商和工具变更须覆盖真实的请求结构、碎片流解析、错误、取消与密钥脱敏；可使用本地模拟上游进行可重复的集成测试。测试专用数据放在临时目录，不提交凭据、个人会话或 `.data`。

新增工具在 `apps/server/src/tools.ts` 注册 schema、可用状态、执行函数和审批需求，再通过人偶 allowlist 开放；网络调用复用 `network()`。新增跨端字段先更新 `packages/shared` 的 Zod 配置与默认值。详见 [架构与扩展](docs/ARCHITECTURE.md)。

更换 Live2D 素材时保留来源与许可说明。应用代码的 MIT License 不覆盖第三方模型与 Cubism Core。
