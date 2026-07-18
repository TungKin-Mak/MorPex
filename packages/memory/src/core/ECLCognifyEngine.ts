/**
 * ECLCognifyEngine — ECL 流水线的 Cognify 阶段
 *
 * 调用本地 LLM（DeepSeek-R1 等轻量推理模型）从文本中提取：
 *   - Entities: [{ id, type, description }]
 *   - Relations: [{ source, target, type }]
 *
 * 设计参考：Cognee 的 Cognify 步骤 —— 把非结构化文本转化为结构化知识图谱。
 *
 * 使用场景：
 *   - remember() 写入时自动触发（enableAutoCognify: true）
 *   - 文档上传后批量 Cognify
 *   - 对话结束后提取关键实体
 *   - 定时对未 Cognify 的内容进行补抽取
 */

import type { KnowledgeGraph } from '../../../core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import type { EntityType, RelationType } from '../../../core/src/planes/knowledge-plane/knowledge/types.js';

// ── 类型 ──

/** LLM 抽取的实体 */
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  description: string;
  tags?: string[];
}

/** LLM 抽取的关系 */
export interface ExtractedRelation {
  sourceEntityName: string;
  targetEntityName: string;
  type: RelationType;
  weight?: number;
}

/** Cognify 结果 */
export interface CognifyResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  rawResponse?: string;
}

/** Cognify 配置 */
export interface CognifyConfig {
  llmEndpoint?: string;        // LLM API 地址
  llmModel?: string;           // 模型名称（默认 deepseek-r1）
  maxTokensPerChunk?: number;  // 每个 chunk 最大 token 数
  batchSize?: number;          // 批量 Cognify 大小
}

// ── 默认 Cognify Prompt ──

const DEFAULT_COGNIFY_PROMPT = `You are a knowledge extraction engine. Your task is to extract entities and relations from the text below.

Output ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "entities": [
    { "name": "EntityName", "type": "technology|concept|person|organization|process|skill|document|memory|decision", "description": "One sentence description", "tags": ["tag1", "tag2"] }
  ],
  "relations": [
    { "source": "EntityName1", "target": "EntityName2", "type": "depends_on|used_by|produces|part_of|related_to|describes|triggers|supersedes|evolved_from|contradicts|references|implements|generated_by", "weight": 0.8 }
  ]
}

Rules:
1. Extract only MEANINGFUL entities — skip generic pronouns, filler words, and vague concepts.
2. Entity "type" must be one of: technology, concept, person, organization, process, skill, document, memory, decision.
3. Relation "type" must be one of: depends_on, used_by, produces, part_of, related_to, describes, triggers, supersedes, evolved_from, contradicts, references, implements, generated_by.
4. "weight" should be 0.0-1.0 indicating confidence/strength of the relationship.
5. If nothing meaningful to extract, return { "entities": [], "relations": [] }.
6. Entity names should be concise (max 3-4 words) and specific.

Text to analyze:
---
{chunk}
---`;

// ── ECLCognifyEngine ──

export class ECLCognifyEngine {
  private config: Required<CognifyConfig>;
  private graph: KnowledgeGraph | null = null;
  private entityNameToId: Map<string, string> = new Map();

  constructor(config?: CognifyConfig) {
    this.config = {
      llmEndpoint: config?.llmEndpoint ?? 'http://localhost:11434/api/generate',
      llmModel: config?.llmModel ?? 'deepseek-r1:1.5b',
      maxTokensPerChunk: config?.maxTokensPerChunk ?? 4000,
      batchSize: config?.batchSize ?? 5,
    };
  }

  /** 绑定知识图谱（用于自动写入抽取结果） */
  bindGraph(graph: KnowledgeGraph): void {
    this.graph = graph;
  }

  /** 重建实体名→ID 映射 */
  private rebuildNameMap(): void {
    this.entityNameToId.clear();
    if (!this.graph) return;
    const allEntities = this.graph.searchEntities({ limit: 10000 });
    for (const e of allEntities) {
      this.entityNameToId.set(e.name.toLowerCase(), e.id);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Cognify 单个文本块
  // ═══════════════════════════════════════════════════════════════

  /**
   * 从文本中抽取实体和关系
   *
   * @param chunk - 文本块
   * @param customPrompt - 自定义抽取提示词（可选）
   * @returns 抽取结果
   */
  async cognify(chunk: string, customPrompt?: string): Promise<CognifyResult> {
    const prompt = (customPrompt ?? DEFAULT_COGNIFY_PROMPT).replace('{chunk}', chunk);

    try {
      const rawResponse = await this.callLLM(prompt);
      const parsed = this.parseResponse(rawResponse);
      return { ...parsed, rawResponse };
    } catch (err: any) {
      console.warn(`[Cognify] ⚠️ LLM 调用失败: ${err.message}`);
      return { entities: [], relations: [] };
    }
  }

  /**
   * Cognify 并自动提交到图谱
   */
  async cognifyAndCommit(chunk: string, sourceRefId?: string): Promise<CognifyResult> {
    if (!this.graph) {
      console.warn('[Cognify] ⚠️ 未绑定图谱，无法自动提交');
      return { entities: [], relations: [] };
    }

    const result = await this.cognify(chunk);
    this.rebuildNameMap();

    // 写入实体
    const entityIdMap = new Map<string, string>(); // name → id
    for (const extEntity of result.entities) {
      // 检查是否已存在同名实体
      const existingId = this.entityNameToId.get(extEntity.name.toLowerCase());
      if (existingId) {
        entityIdMap.set(extEntity.name, existingId);
        // 更新描述（追加）
        this.graph.correctEntity(existingId, {
          description: extEntity.description,
          tags: [...new Set([...(this.graph.searchEntities({ text: extEntity.name, limit: 1 })[0]?.tags ?? []), ...(extEntity.tags ?? [])])],
        });
      } else {
        const entity = await this.graph.addEntity({
          type: extEntity.type,
          name: extEntity.name,
          description: extEntity.description,
          refId: sourceRefId,
          tags: extEntity.tags ?? [],
          metadata: { cognified: true, sourceRefId },
        });
        entityIdMap.set(extEntity.name, entity.id);
      }
    }

    // 写入关系
    for (const extRel of result.relations) {
      const sourceId = entityIdMap.get(extRel.sourceEntityName)
        ?? this.entityNameToId.get(extRel.sourceEntityName.toLowerCase());
      const targetId = entityIdMap.get(extRel.targetEntityName)
        ?? this.entityNameToId.get(extRel.targetEntityName.toLowerCase());

      if (sourceId && targetId) {
        this.graph.addRelation({
          source: sourceId,
          target: targetId,
          type: extRel.type,
          weight: extRel.weight ?? 0.8,
        });
      }
    }

    console.log(`[Cognify] ✅ 已抽取并提交: ${result.entities.length} 实体, ${result.relations.length} 关系`);
    return result;
  }

  /**
   * 批量 Cognify（用于文档上传后处理）
   */
  async cognifyBatch(chunks: string[]): Promise<CognifyResult> {
    const allEntities: ExtractedEntity[] = [];
    const allRelations: ExtractedRelation[] = [];

    for (let i = 0; i < chunks.length; i += this.config.batchSize) {
      const batch = chunks.slice(i, i + this.config.batchSize);
      for (const chunk of batch) {
        const result = await this.cognify(chunk);
        allEntities.push(...result.entities);
        allRelations.push(...result.relations);
      }
      console.log(`[Cognify] 📊 批次 ${Math.floor(i / this.config.batchSize) + 1}: ${allEntities.length} 实体, ${allRelations.length} 关系`);
    }

    // 去重实体
    const uniqueEntities = new Map<string, ExtractedEntity>();
    for (const e of allEntities) {
      const key = e.name.toLowerCase();
      if (!uniqueEntities.has(key)) {
        uniqueEntities.set(key, e);
      }
    }

    return {
      entities: [...uniqueEntities.values()],
      relations: allRelations,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /** 调用 LLM */
  private async callLLM(prompt: string): Promise<string> {
    const resp = await fetch(this.config.llmEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.llmModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,  // 低温度确保稳定输出
          max_tokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      throw new Error(`LLM 返回 ${resp.status}: ${await resp.text().catch(() => '')}`);
    }

    const data = await resp.json() as Record<string, any>;
    // 兼容 Ollama 和 OpenAI 格式
    return data.response ?? data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? JSON.stringify(data);
  }

  /** 解析 LLM 响应 */
  private parseResponse(raw: string): { entities: ExtractedEntity[]; relations: ExtractedRelation[] } {
    // 尝试提取 JSON（处理可能包裹在 markdown 代码块中的情况）
    let jsonStr = raw.trim();

    // 移除 markdown 代码块标记
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // 尝试找到 JSON 对象的起始位置
    const jsonStart = jsonStr.indexOf('{');
    if (jsonStart > 0) {
      jsonStr = jsonStr.slice(jsonStart);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        entities: this.validateEntities(parsed.entities ?? []),
        relations: this.validateRelations(parsed.relations ?? []),
      };
    } catch {
      console.warn('[Cognify] ⚠️ JSON 解析失败，原始响应:', raw.substring(0, 200));
      return { entities: [], relations: [] };
    }
  }

  /** 验证并规范化实体 */
  private validateEntities(raw: any[]): ExtractedEntity[] {
    const validTypes = new Set<string>([
      'technology', 'concept', 'person', 'organization', 'process',
      'skill', 'document', 'memory', 'decision', 'agent', 'task',
      'artifact', 'execution', 'goal', 'chat_session', 'checkpoint',
    ]);

    return raw
      .filter(e => e && typeof e.name === 'string' && e.name.length > 1)
      .map(e => ({
        name: e.name.trim(),
        type: validTypes.has(e.type) ? e.type : 'concept',
        description: typeof e.description === 'string' ? e.description.trim() : '',
        tags: Array.isArray(e.tags) ? e.tags : [],
      }));
  }

  /** 验证并规范化关系 */
  private validateRelations(raw: any[]): ExtractedRelation[] {
    const validTypes = new Set<string>([
      'triggers', 'produces', 'depends_on', 'supersedes', 'related_to',
      'part_of', 'decides', 'remembers', 'used_by', 'describes',
      'contradicts', 'evolved_from', 'implements', 'references', 'generated_by',
    ]);

    return raw
      .filter(r => r && typeof r.source === 'string' && typeof r.target === 'string')
      .map(r => ({
        sourceEntityName: r.source.trim(),
        targetEntityName: r.target.trim(),
        type: validTypes.has(r.type) ? r.type : 'related_to',
        weight: typeof r.weight === 'number' ? Math.max(0, Math.min(1, r.weight)) : 0.8,
      }));
  }
}

// ── 工厂函数 ──

/**
 * 创建 Cognify 引擎
 */
export function createCognifyEngine(config?: CognifyConfig): ECLCognifyEngine {
  return new ECLCognifyEngine(config);
}
