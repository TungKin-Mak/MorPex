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
  const base = `根据原语 "${primitiveName}" 的输入 Schema，从任务描述中提取参数并只输出 JSON 对象。\n任务: ${goal}\nSchema: ${schemaJson}\n直接输出纯 JSON（不要 Markdown 代码块，不要多余文字）：`;
  return missing && missing.length > 0
    ? `${base}\n注意：以下必填参数缺失，必须补全：${missing.join(', ')}`
    : base;
}

/**
 * 生成类原语判断（路径分配方案 B）
 * 生成类（artifact_generation）：用户要求"做东西"（报表/代码/文档）——内容由原语内 LLM 生成，
 * 不需要参数提取；操作类（file/shell/api/knowledge）：需明确参数（path/command/url/query），保留提取。
 */
export function isGenerativePrimitive(name: string): boolean {
  return name === 'artifact_generation';
}

/**
 * 按目标关键词推断产物类型（artifact_generation 的 type 枚举）
 * 生成类跳过参数提取时，type 由目标文本推断，不依赖 LLM 提取。
 */
export function inferArtifactType(goal: string): string {
  const g = goal.toLowerCase();
  if (/报告|报表|report/.test(g)) return 'report';
  if (/代码|code|编码|程序/.test(g)) return 'code';
  if (/配置|config/.test(g)) return 'config';
  if (/数据|data|dataset/.test(g)) return 'data';
  return 'doc'; // 默认文档
}
