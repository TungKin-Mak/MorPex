/**
 * DeliveryPlanner 提示词资产（P1 #3 内联 prompt 收编第四批）
 *
 * 从 cognition/planning/DeliveryPlanner.ts quickPlan 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 零依赖（无 import）→ 无循环依赖风险；纯函数 → tree-shaking 友好。
 */

/**
 * 构建 quick 分解 prompt（PiBridge 轻量 LLM 调用 ~200 tokens）
 * @param goal 任务目标原文
 */
export function buildQuickDecomposePrompt(goal: string): string {
  return `将以下任务分解为 2-5 个具体步骤。返回严格 JSON 数组（不要 markdown）：

任务: "${goal}"

格式: [{"step":"步骤描述","capability":"所需能力"}]

能力可选: analyze/design/code/test/write/research/review/deploy
规则: 简单任务 1-2 步，中等任务 3-4 步。只输出 JSON 数组。`;
}
