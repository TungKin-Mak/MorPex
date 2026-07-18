# Pi 兼容矩阵 (PI-COMPAT-MATRIX)

> pi-ai ↔ pi-agent-core 版本兼容关系及 MorPex Adapter 验证状态
> 最后更新: 2026-07-18

---

## 当前锁定版本

| 包 | 版本 | 类型 | 锁定方式 |
|----|------|------|------|
| `@earendil-works/pi-ai` | **0.79.10** | 精确 | `package.json`: `"0.79.10"` |
| `@earendil-works/pi-agent-core` | **0.79.10** | 精确 | `package.json`: `"0.79.10"` |
| `@earendil-works/pi-coding-agent` | **0.79.10** | 精确 | `package.json`: `"0.79.10"` |

---

## 已验证组合

| pi-ai | pi-agent-core | Adapter 版本 | 状态 | 验证日期 | 备注 |
|-------|---------------|-------------|------|------|------|
| 0.79.10 | 0.79.10 | v1 (当前) | ✅ **已验证** | 2026-07-18 | 31/31 契约测试通过 |

---

## 兼容性记录模板

升级时按此模板追加行：

```
| x.y.z   | x.y.z         | v?          | ✅/⚠️/❌ | YYYY-MM-DD | [备注] |
```

状态说明：
- ✅ **已验证** — 全部契约测试 + 集成测试通过
- ⚠️ **部分兼容** — 契约测试通过，但部分能力降级（需在备注中说明）
- ❌ **不兼容** — 契约测试失败，需要修改 Adapter mapper
- 🔄 **验证中** — 正在进行测试

---

## 能力兼容矩阵

记录每个版本组合下 Pi 后端支持的能力。

| 能力 | 0.79.10 状态 | 说明 |
|------|:--:|------|
| `streaming` | ✅ | 流式输出正常 |
| `toolCalling` | ✅ | 工具调用正常 |
| `parallelToolCalls` | ✅ | 并行工具调用支持 |
| `cancellation` | ✅ | AbortSignal 传播正常 |
| `reasoning` | ✅ | thinking/reasoning 提取正常 |
| `usageReporting` | ✅ | token usage 报告正常 |
| `checkpointResume` | ❌ | pi-agent-core 0.79.10 不支持 |
| `sessionPersistence` | ✅ | InMemorySessionRepo 正常 |
| `compaction` | ✅ | 上下文压缩正常 |

---

## 已知 API 约束

以下 pi-ai / pi-agent-core API 特性在 MorPex Adapter 中具有已知限制：

| 约束 | 影响 | 解决方案 |
|------|------|------|
| `getModel()` 泛型约束需要编译期 `KnownProvider` | Adapter 层使用 `as never` 桥接运行时字符串 | `model-resolver.ts` 通过 `isKnownProvider()` 运行时验证 |
| pi-agent-core `.d.ts` 使用 `.ts` 扩展名 | 部分 TypeScript 配置下类型解析失败 | `skipLibCheck: true` + 已知问题文档化 |
| `streamSimple()` 参数类型过于复杂 | Adapter 使用 `as any` 传递 | 受限于上游 API 设计，已最小化到 1 处 |
| `AgentHarness` 构造参数无公开 builder | Adapter 直接调用构造函数 | 升级时需检查构造函数签名变化 |

---

## 回滚路径

```bash
# 回滚到当前已验证版本
git checkout package.json package-lock.json
npm install

# 验证回滚成功
npx tsc --noEmit
npx tsx packages/adapters/__tests__/contract-tests.ts
```

---

## 升级检查清单

- [ ] 查看上游 CHANGELOG / Release Notes
- [ ] 确认 pi-ai 与 pi-agent-core 版本兼容
- [ ] 更新 `package.json` 中的精确版本
- [ ] `npm install` 生成新 lockfile
- [ ] `npx tsc --noEmit` 类型检查
- [ ] `npx tsx packages/adapters/__tests__/contract-tests.ts` 契约测试
- [ ] `npx dependency-cruiser packages/ --config .dependency-cruiser.js` 边界检查
- [ ] 手动检查 adapter mapper 文件是否需要更新
- [ ] 更新本矩阵文档
- [ ] 提交 PR（不自动合并 major 版本）
