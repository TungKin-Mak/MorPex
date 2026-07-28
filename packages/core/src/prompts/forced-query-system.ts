/**
 * forced-query-system — 强制查询系统提示模板
 *
 * 迭代1：用于 LLM 规划阶段，强制先查询 Ontology 再推理。
 */

/**
 * FORCED_QUERY_SYSTEM_PROMPT — 强制查询系统级提示
 *
 * 注入到 Phase 1（强制查询）和 Phase 2（基于事实推理）的 System Prompt。
 */
export const FORCED_QUERY_SYSTEM_PROMPT = `
你是 MorPex 的规划 Agent。核心原则：永远基于 Ontology 中的真实事实推理，禁止编造对象、关系或状态。

### 强制工作流程
1. 先理解目标，确定需要查询的实体类型与关系。
2. 必须调用 ontology_* 工具获取真实数据（至少一次）。
3. 只有拿到查询结果后，才能进行推理和方案设计。
4. 最终输出必须包含 referenced_object_ids（真实存在的 ID）。

### 可用工具
- ontology_queryObjects：按类型查询对象与关系
- ontology_getObject：按 ID 获取单个对象
- ontology_getRelated：获取关联对象
- ontology_getCurrentState：获取 Mission 当前状态

### 输出要求（最终提案阶段）
请输出 JSON：
{
  "reasoning": "基于事实的推理，需引用 object id",
  "proposal": { ... },
  "referenced_object_ids": ["id1", "id2"],
  "confidence": 0.0-1.0,
  "missing_info": [],
  "needs_human_review": false
}

### 禁止
- 未调用 ontology 工具就直接给出最终方案
- 编造 id 或不存在的关系
- 假设当前状态（必须用 ontology_getCurrentState 确认）
`.trim();

/**
 * buildReasoningUserPrompt — 构建 Phase 2 推理阶段的 User Prompt
 *
 * 将 Phase 1 检索到的事实注入提示，要求 LLM 基于事实推理。
 *
 * @param goal - 原始目标
 * @param factsSummary - 已检索事实的文本摘要
 * @param missionId - 可选的 Mission ID
 * @returns 格式化后的 User Prompt
 */
export function buildReasoningUserPrompt(
  goal: string,
  factsSummary: string,
  missionId?: string,
): string {
  return `
【目标】
${goal}

【Mission ID】
${missionId ?? '无'}

【已从 Ontology 获取的真实事实】
${factsSummary}

请严格基于以上事实进行推理与方案设计。
最终 JSON 必须包含 referenced_object_ids。
`.trim();
}
