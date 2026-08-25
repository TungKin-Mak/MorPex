/**
 * ReflectionEngine 提示词资产（P1 #3 内联 prompt 收编）
 *
 * 从 cognition/ReflectionEngine.ts 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 保持逐字等价：空 taskSummary → '(无)'、无 currentPlan → '(无)'。
 */

/**
 * 构建深度反思 prompt（LLM 驱动）
 * @param taskSummary 已拼接的最近任务摘要（多行字符串，原样传入；空串时模板内回退为 '(无)'）
 * @param currentPlan 当前计划对象，未设置则为 undefined
 */
export function buildReflectionPrompt(
  taskSummary: string,
  currentPlan: { goal: string; taskCount: number } | undefined,
): string {
  return `你是一个 AI 公司的大脑，正在反思最近的执行表现。

最近任务:
${taskSummary || '(无)'}

当前计划: ${currentPlan ? `${currentPlan.goal} (${currentPlan.taskCount}个任务)` : '(无)'}

请分析:
1. 存在哪些风险？
2. 有什么改进建议？
3. 观察到什么模式？

返回 JSON 格式:
{
  "insights": [{"type": "improvement|warning|pattern|suggestion", "message": "...", "confidence": 0-1}],
  "risks": [{"description": "...", "severity": "low|medium|high", "probability": 0-1}],
  "suggestions": ["建议1", "建议2"]
}`;
}
