/**
 * bootstrapFromDocs 提示词资产（P1 #3 内联 prompt 收编·收尾批）
 *
 * 从 knowledge/ontology/bootstrapFromDocs.ts 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 零依赖（无 import）→ 无循环依赖风险；纯函数 → tree-shaking 友好。
 */

/**
 * 构建 Ontology bootstrap 系统提示
 * @param knownTypes 已注册类型集合（可选，用于提示优先使用已知类型）
 */
export function buildBootstrapSystemPrompt(knownTypes?: string[]): string {
  return `你是本体工程师。从以下工作流资料中抽取 Ontology 结构。
只输出 JSON，格式：
{
  "objects": [
    { "type": "类型名（如 Task、Review）", "name": "实例名", "properties": {"key": "value"}, "description": "说明" }
  ],
  "relations": [
    { "from": "源对象名", "to": "目标对象名", "type": "关系类型（如 depends_on、triggers）" }
  ],
  "actions": [
    { "name": "动作名", "description": "说明", "inputs": ["输入1"], "outputs": ["输出1"] }
  ]
}

${knownTypes ? `已知类型：${knownTypes.join(', ')}。优先使用已知类型。` : ''}
只输出 JSON，不要其他文字。`;
}

/**
 * 构建 Ontology bootstrap 用户提示
 * @param docs 工作流文档原文列表
 */
export function buildBootstrapUserPrompt(docs: string[]): string {
  return `工作流资料：
${docs.join('\n\n---\n\n')}

请分析并抽取出其中的 Object Types、Relations 和 Actions。`;
}
