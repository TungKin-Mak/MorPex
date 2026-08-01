/**
 * bootstrapFromDocs — 从工作流文档半自动 bootstrap Ontology
 *
 * 迭代3：用 LLM 从工作流文档中抽取 Object Types、Relations、Actions，
 * 然后 upsert 到 Ontology。
 *
 * 使用方式（dryRun 先行）：
 *   const result = await bootstrapFromWorkflowDocs({
 *     docs: [workflowDoc1, workflowDoc2],
 *     ontology,
 *     piBridge,
 *     dryRun: true,        // 只返回解析结果，不写入
 *   });
 *   console.log(result.objects);  // 审核后再 dryRun=false 落库
 */

import type { OntologyService } from './OntologyService.js';

export interface BootstrapFromDocsOptions {
  /** 工作流文档原文列表 */
  docs: string[];
  /** OntologyService 实例 */
  ontology: OntologyService;
  /** LLM 调用接口 */
  piBridge: {
    generateText: (params: {
      system?: string;
      prompt: string;
      temperature?: number;
      maxTokens?: number;
    }) => Promise<{ text: string }>;
  };
  /** 仅解析不写入 */
  dryRun?: boolean;
  /** 已注册的类型集合（用于过滤已知类型） */
  knownTypes?: string[];
}

export interface BootstrapExtraction {
  objects: Array<{
    type: string;
    name: string;
    properties: Record<string, unknown>;
    description?: string;
  }>;
  relations: Array<{
    from: string;
    to: string;
    type: string;
  }>;
  actions: Array<{
    name: string;
    description: string;
    inputs: string[];
    outputs: string[];
  }>;
}

/**
 * bootstrapFromWorkflowDocs — 从工作流文档半自动 bootstrap
 *
 * 用 LLM 分析文档，抽取出 Ontology 结构。
 * 默认 dryRun=true，审核后再落库。
 *
 * @returns 抽取结果（dryRun 时不写入）
 */
export async function bootstrapFromWorkflowDocs(
  options: BootstrapFromDocsOptions,
): Promise<BootstrapExtraction> {
  const { docs, ontology, piBridge, dryRun = true, knownTypes } = options;

  const systemPrompt = `你是本体工程师。从以下工作流资料中抽取 Ontology 结构。
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

  const userPrompt = `工作流资料：
${docs.join('\n\n---\n\n')}

请分析并抽取出其中的 Object Types、Relations 和 Actions。`;

  const response = await piBridge.generateText({
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.2,
    maxTokens: 3000,
  });

  let extraction: BootstrapExtraction;
  try {
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('未找到 JSON 输出');
    extraction = JSON.parse(jsonMatch[0]) as BootstrapExtraction;
  } catch (err) {
    console.warn('[bootstrapFromDocs] ⚠️ LLM 输出解析失败:', (err as Error).message);
    return { objects: [], relations: [], actions: [] };
  }

  console.log(
    `[bootstrapFromDocs] 📄 解析完成: ${extraction.objects.length} 对象, ${extraction.relations.length} 关系, ${extraction.actions.length} 动作`,
  );

  if (dryRun) {
    console.log('[bootstrapFromDocs] 🔍 dryRun 模式，未写入 Ontology');
    return extraction;
  }

  // 写入 Ontology
  let count = 0;
  for (const obj of extraction.objects) {
    try {
      await ontology.upsertObject({
        id: obj.name
          ? `${obj.type.toLowerCase()}_${obj.name.replace(/\s+/g, '_').toLowerCase()}`
          : undefined,
        type: obj.type,
        status: 'bootstrapped',
        properties: {
          name: obj.name,
          description: obj.description,
          ...obj.properties,
        },
      });
      count++;
    } catch (err) {
      console.warn(`[bootstrapFromDocs] ⚠️ 写入失败 ${obj.type}/${obj.name}:`, (err as Error).message);
    }
  }

  // 写入关系
  for (const rel of extraction.relations) {
    try {
      await ontology.ensureRelation(rel.from, rel.to, rel.type);
    } catch {
      // 关系写入失败不阻塞
    }
  }

  console.log(`[bootstrapFromDocs] ✅ 已写入 ${count} 个对象到 Ontology`);
  return extraction;
}
