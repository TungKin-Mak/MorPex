/**
 * paramCompleter 提示词资产（P1 #3 内联 prompt 收编·收尾批）
 *
 * 从 infrastructure/tools/paramCompleter.ts 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 零依赖（无 import）→ 无循环依赖风险；纯函数 → tree-shaking 友好。
 */

/**
 * 生成带缺失字段提示的提取 prompt（补全用）
 * @param goal 任务描述
 * @param primitiveName 原语名
 * @param schemaJson schema JSON 字符串
 * @param missing 缺失的必填字段
 */
export function buildExtractPrompt(
  goal: string,
  primitiveName: string,
  schemaJson: string,
  missing?: string[],
): string {
  const base = `根据原语 "${primitiveName}" 的输入 Schema，从任务描述中提取参数并只输出 JSON 对象。\n任务: ${goal}\nSchema: ${schemaJson}\n直接输出纯 JSON（不要 Markdown 代码块，不要多余文字）：`;
  return missing && missing.length > 0
    ? `${base}\n注意：以下必填参数缺失，必须补全：${missing.join(', ')}`
    : base;
}
