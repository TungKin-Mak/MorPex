/**
 * ToolFactory 提示词资产（P1 #3 内联 prompt 收编）
 *
 * 从 infrastructure/tools/ToolFactory.ts 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 保持逐字等价。
 */

/**
 * 构建 Tool Schema 生成 prompt（LLM 驱动）
 * @param taskDesc 任务描述（原样嵌入引号内）
 */
export function buildToolSchemaPrompt(taskDesc: string): string {
  return `根据以下任务描述，生成一个 OpenAI function calling 格式的 tool schema。

任务: "${taskDesc}"

返回 JSON 格式:
{
  "name": "工具名(英文小写蛇形)",
  "description": "工具描述(中文)",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": { "type": "string", "description": "参数说明" }
    },
    "required": ["param1"]
  },
  "category": "research|development|integration|general"
}

只返回 JSON，不要其他内容。`;
}
