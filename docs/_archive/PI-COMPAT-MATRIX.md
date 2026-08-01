# Pi 兼容矩阵 (PI-COMPAT-MATRIX)

> pi-ai ↔ pi-agent-core 版本兼容关系及 PiBridge 验证状态
> 最后更新: 2026-07-23

---

## 当前锁定版本

| 包 | 版本 | 类型 | 锁定方式 |
|----|------|------|------|
| `@earendil-works/pi-ai` | **0.81.1** | 精确 | `package.json` |
| `@earendil-works/pi-agent-core` | **0.81.1** | 精确 | `package.json` |
| `@earendil-works/pi-coding-agent` | **0.81.1** | 精确 | `package.json` |

---

## 已验证组合

| pi-ai | pi-agent-core | Bridge | 状态 | 验证日期 | 备注 |
|-------|---------------|--------|------|------|------|
| 0.81.1 | 0.81.1 | **PiBridge (v11)** | ✅ **已验证** | 2026-07-23 | 8/8 生产检查 + 20/20 系统测试 + 31/31 EventMesh |
| 0.79.10 | 0.80.10 | pi-utils (v10) | ✅ | 2026-07-18 | 旧版，已升级 |

---

## v0.81.x 主要变更

| 变更 | 旧 API (0.79.x) | 新 API (0.81.x) |
|------|----------------|-----------------|
| 模型获取 | `getModel(p, id)` 全局函数 | `models.getModel(p, id)` 实例方法 |
| Provider 列表 | `getProviders()` → `string[]` | `models.getProviders()` → `Provider[]` |
| 推理调用 | `getApiProvider(api).stream()` | `models.complete(model, ctx)` |
| `KnownProvider` | 类型存在 | 已移除 |
| `ThinkingLevel` | 5 级 | 6 级（+`max`） |
| 兼容层 | — | `@earendil-works/pi-ai/compat` |

## PiBridge 隔离层（v11 新增）

```
PiBridge.ts — 唯一运行时导入 pi-ai + pi-agent-core
  ├── generateText() — AI 推理
  ├── listModels() / findModel() — 模型发现
  ├── createAgentHarness() — Agent 创建
  ├── static uuidv7() / createNodeEnv() / createSessionRepo()
  └── static clamps / thinking levels
```

升级时**只需改 PiBridge.ts**，业务代码零修改。

---

## 能力兼容矩阵

| 能力 | 0.81.1 状态 | 说明 |
|------|:--:|------|
| `models.complete()` | ✅ | 非流式推理正常 |
| `models.getModel()` | ✅ | 模型发现正常 |
| `builtinModels()` | ✅ | 38 providers 自动注册 |
| `AgentHarness` | ✅ | Agent 创建正常 |
| `InMemorySessionRepo` | ✅ | Session 仓库正常 |
| `NodeExecutionEnv` | ✅ | 执行环境正常 |
| `uuidv7` | ✅ | UUID 生成正常 |
| `clampThinkingLevel` | ✅ | 推理深度钳制正常 |

---

## 升级检查清单

- [ ] 查看上游 CHANGELOG / Release Notes
- [ ] `npm install @earendil-works/pi-ai@latest @earendil-works/pi-agent-core@latest`
- [ ] `npx tsc --noEmit` 类型检查
- [ ] 检查 PiBridge.ts 是否需要更新
- [ ] `node scripts/production-check.cjs` 8/8
- [ ] `npx tsx tests/run-all.ts` 20/20
- [ ] 更新本文档
