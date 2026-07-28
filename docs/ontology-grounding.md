# Ontology Grounding — 操作手册

> 迭代3：何时必须查询、何时允许纯创造

## 核心原则

**永远基于 Ontology 中的真实事实推理，禁止编造对象、关系或状态。**

## 必须查询的场景（Grounded Required）

以下场景在执行前**必须**调用 `ontology_*` 工具获取真实事实：

| 场景 | 原因 | 至少查询 |
|------|------|----------|
| 🎯 **Mission 规划** | 规划前需了解现有资源、Agent、Artifact | 1 次 `ontology_queryObjects` |
| 🔄 **跨部门任务** | 需要确认目标部门存在且活跃 | `ontology_getObject(部门ID)` |
| 📦 **Artifact 方案** | 需要引用已有 Artifact 作为基础 | `ontology_queryObjects({type:'Artifact'})` |
| 👥 **资源分配** | 需要确认 Agent 能力与信誉 | `ontology_queryObjects({type:'Agent'})` |
| 📋 **SOP 生成/更新** | 需要基于历史 Mission 数据 | `ontology_queryObjects({type:'Mission'})` |
| ✅ **Artifact 验证前** | 方案自检，确认引用真实 | `ontology_getObject(引用的ID)` |
| 🔁 **二次规划** | 需要当前 Mission 真实状态 | `ontology_getCurrentState(missionId)` |

## 可豁免的场景（Creativity Allowed）

以下场景可以**不查询** Ontology，直接使用 LLM 创造力：

| 场景 | 说明 |
|------|------|
| 🎨 **格式润色** | 纯文案美化，不改变事实 |
| 🌐 **翻译** | 语言转换，不涉及实体引用 |
| 💡 **纯创意 Brainstorm** | 头脑风暴阶段，不落地执行 |
| ✏️ **简单文案编写** | 不引用任何现有对象的文本创作 |

> ⚠️ **注意**：即使以上场景可豁免，如果最终方案要**落地执行**，仍需要经过 grounded 规划阶段。

## 输出规范

所有 grounded 推理的输出必须包含：

```json
{
  "reasoning": "基于事实的推理，引用 object id",
  "proposal": { ... },
  "referenced_object_ids": ["id1", "id2"],
  "confidence": 0.0-1.0,
  "missing_info": [],
  "needs_human_review": false
}
```

- `referenced_object_ids`：必须包含所有引用的 Ontology 对象 ID
- `missing_info`：如果查询结果不足以支持完整推理，列出缺失信息
- `needs_human_review`：引用校验失败或置信度过低时设为 `true`

## 反馈入口

通过 `CompanyFacade.submitFeedback()` 提交反馈：

```typescript
await companyFacade.submitFeedback({
  targetId: 'artifact_xxx',
  rating: 'down',       // 'up' | 'down' | 0-1
  expected: '应该输出...',
  comment: '缺少对 X 的引用',
  source: 'human',
  markAsTestCase: true, // 自动加入测试集
});
```

提交的反馈会：
1. 写入 Ontology（`Feedback` 类型）
2. 建立 `corrects` 关系到目标对象
3. 自动标记 `isTestCase`（rating=down 时）
4. 被 `FeedbackAwareLearner` 消费 → 生成改进提案

## 执行路径覆盖

当前已接入 Grounded Reasoning 的执行路径：

1. ✅ **DeliveryPlanner.planWithOntology()** — 主规划入口
2. ✅ **HierarchicalPlanner.createPlan()** — HTN 分层规划（ontology 启用时）
3. ✅ **SubAgentFork 执行引擎** — 子任务分发前

## 故障处理

| 问题 | 处理方式 |
|------|----------|
| Ontology 查询返回空 | LLM 应在 `missing_info` 中说明，不编造数据 |
| 引用的 ID 不存在 | `validateReferences` 标记缺失，`needs_human_review=true` |
| EVentStore 不可用 | Trace 事件写入失败不影响主流程，仅日志警告 |
| 投影失败 | 启动时投影失败不影响运行，后续可手动触发 `projectAll()` |

---

*最后更新：迭代3*
