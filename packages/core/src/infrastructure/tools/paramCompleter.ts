/**
 * paramCompleter — 原语参数补全/校验层
 *
 * 背景：50 任务实测 GLM flash 失败主因是"工具调用参数结构化不完整"——
 *   如 artifact_generation({ type: undefined })、knowledge_query({ query: '' })。
 *   即 LLM 提取出参数但关键必填字段缺失 → 原语执行失败。
 *
 * 方案：paramExtractor（LLM NL→结构化参数）提取后，按原语 inputSchema 的
 *   required 校验必填字段；缺失时二次 LLM 提取补全（prompt 带缺失字段提示）。
 * 不新增层：复用现有 inputSchema + paramExtractor 的 LLM 调用。
 */
export interface PrimitiveParamSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

/** 从 inputSchema 取必填字段列表 */
export function getRequiredParams(inputSchema: Record<string, unknown> | undefined): string[] {
  const required = (inputSchema as PrimitiveParamSchema | undefined)?.required;
  return Array.isArray(required) ? (required as string[]) : [];
}

/** 校验参数：返回缺失的必填字段（null/undefined/空串视为缺失） */
export function validatePrimitiveParams(
  inputSchema: Record<string, unknown> | undefined,
  params: Record<string, unknown>,
): string[] {
  return getRequiredParams(inputSchema).filter((k) => params[k] == null || params[k] === '');
}

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
  const base = `根据原语 "${primitiveName}" 的输入 Schema，从任务描述中提取参数并只输出 JSON 对象。\n任务: ${goal}\nSchema: ${schemaJson}\n`;
  return missing && missing.length > 0
    ? `${base}注意：以下必填参数缺失，必须补全：${missing.join(', ')}\n输出 JSON:`
    : `${base}输出 JSON:`;
}
