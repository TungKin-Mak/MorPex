/**
 * MemoryBus — 三维一体记忆总线 v2（Cognee + Letta 风格）
 *
 * v2 核心变化：
 *   - 按数据形态 (memType) 组织，不按认知距离
 *   - Main Pool 竞争淘汰 + Archive 归档池
 *   - 按类型遗忘（知识永久、画像更替、摘要衰减、修正即删）
 *   - Score 竞争公式 + feedback() 闭环
 *   - 阶段管理 (stageComplete / planStages / audit)
 *   - Layer 2 输入拦截 (interceptInput)
 *
 * 三层存储引擎（从 v1 保留）：
 *   1. Provenance Layer — JSONL index + MD5 去重 + 数据溯源
 *   2. Semantic Layer    — zvec (BGE-M3/1024) 高维语义搜索
 *   3. Topology Layer    — 内存邻接表 + entities/relations.jsonl
 *
 * 核心 API (v2)：
 *   - remember(content, meta)  → ECL 流水线 + 竞争写入
 *   - recall(query, strategy)  → 混合检索（支持 includeArchive）
 *   - forget(id)               → 三层联合删除
 *   - feedback(id, useful)     → 闭环反馈 🆕
 *   - compactMemories()        → 返回 CompactResult 🆕（破坏性变化）
 *   - stageComplete/summary/output → 阶段管理 🆕
 *   - planStages(stages)       → 预绑定门控标签 🆕
 *   - audit(query, stage)      → 门控信号 🆕
 *   - interceptInput(query)    → Layer 2 拦截 🆕
 *   - improve()                → 自我进化
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { KnowledgeGraph } from '../../../core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import { MemoryWiki } from '../wiki/index.js';
import type {
  KnowledgeEntity,
  KnowledgeRelation,
  EntityType,
  RelationType,
} from '../../../core/src/planes/knowledge-plane/knowledge/types.js';
import { ZVecStorage } from '../storage/ZVecStorage.js';
import { JSONLWriter } from '../storage/JSONLWriter.js';
import type { MemoryItem } from '../types.js';
import type {
  MemType,
  MemoryGateConfig,
  MemoryGateSignal,
  StageDefinition,
  CompactResult,
  FeedbackResult,
} from '../types.js';

// ── 类型定义 ──

/** 记忆内容 + 上下文元数据 */
export interface MemoryPayload {
  content: string;
  source?: string;           // 数据来源：'chat' | 'document' | 'execution' | 'api'
  sourceId?: string;         // 来源 ID（会话 ID、文档 ID 等）
  tags?: string[];
  importance?: number;       // 1-5
  metadata?: Record<string, any>;
  /** v2: 记忆数据类型 — 决定遗忘策略 */
  memType?: MemType;
  /** v2: 关联的其他记忆 ID */
  references?: string[];
}

/** 检索策略 */
export type RecallStrategy = 'vector-first' | 'graph-walk' | 'hybrid-rag';

/** 检索查询 */
export interface RecallQuery {
  text: string;
  strategy?: RecallStrategy;
  topK?: number;
  graphDepth?: number;       // 图谱邻域扩展深度（默认 2）
  entityTypes?: EntityType[];
  minImportance?: number;
  /** v2: 是否包含归档池 */
  includeArchive?: boolean;
}

/** 检索结果 */
export interface RecallResult {
  items: MemoryPayload[];
  source: 'vector' | 'graph' | 'hybrid';
  graphPath?: KnowledgeEntity[];  // graph-walk 模式下的路径
  entities?: KnowledgeEntity[];   // 关联的图谱实体
}

/** 写闸门决策日志 */
export interface GateLogEntry {
  timestamp: number;
  contentHash: string;
  action: 'store' | 'reject' | 'promote' | 'demote';
  reason: string;
  importance: number;
  tags: string[];
}

/** 索引条目（Provenance Layer） */
export interface IndexEntry {
  id: string;
  contentHash: string;
  source: string;
  sourceId?: string;
  timestamp: number;
  chunkCount: number;
  tags: string[];
  importance: number;
  /** v2: 记忆数据类型 */
  memType: MemType;
  /** v2: 访问计数 */
  accessCount: number;
  /** v2: 最后访问时间 */
  lastAccessedAt: number;
  /** v2: 图谱关系数 */
  relationCount: number;
  /** v2: 竞争分数 */
  score: number;
  /** v2: 是否在归档池 */
  archived: boolean;
}

/** 配置 */
export interface MemoryBusConfig {
  dataDir?: string;
  embedUrl?: string;
  vectorDimension?: number;
  writeGateThreshold?: number;
  enableGraphPersistence?: boolean;
  enableAutoCognify?: boolean;
  /** v2: 主竞争池最大容量 */
  mainPoolCapacity?: number;
  /** v2: 评分权重 */
  scoreWeights?: Partial<ScoreWeights>;
}

/** v2: 评分权重 */
export interface ScoreWeights {
  recency: number;
  frequency: number;
  relation: number;
  importance: number;
}

/** improve() 返回结果 */
export interface ImproveResult {
  gateAnalysis: {
    rejectRate: number;
    totalDecisions: number;
    recommendation: string;  // 'normal' | 'lower_threshold' | 'raise_threshold'
  };
  nodesMerged: number;
  memoriesCompacted: number;
  coldMemoriesFound: number;
  orphanEntities: number;
}

// ── MemoryBus 实现 ──

export class MemoryBus {
  // 三层引擎
  private graph!: KnowledgeGraph;
  private _graphInjected: boolean = false;
  private vectorStore: ZVecStorage | null = null;  // Semantic Layer（延迟注入）

  // 配置
  private config: Required<MemoryBusConfig>;
  private dataDir: string;
  private indexFile: string;
  private gateLogFile: string;
  private compactionLogFile: string;

  /** 微批处理写入器（P2: 消除每次 remember 的同步 I/O） */
  private indexWriter!: JSONLWriter;
  private archiveWriter!: JSONLWriter;
  private gateLogWriter!: JSONLWriter;
  private compactionLogWriter!: JSONLWriter;

  // Provenance：内存索引（从 index.jsonl 加载）
  private index: Map<string, IndexEntry> = new Map();

  // ★ P0 优化: contentHash → IndexEntry O(1) 快速索引
  private hashIndex: Map<string, IndexEntry> = new Map();

  // ── v2: Archive Pool ──
  private archive: Map<string, IndexEntry> = new Map();
  // ★ P0 优化: archive 的 contentHash → IndexEntry 索引
  private archiveHashIndex: Map<string, IndexEntry> = new Map();
  private archiveFile: string;

  // ── v2: Score 竞争权重（构造函数中从 config 赋值）──
  private scoreWeights!: ScoreWeights;
  private mainPoolCapacity!: number;

  // ── v2: Temp Pool（阶段临时输出存储）──
  private tempPool: Map<string, { content: string; stageName: string; timestamp: number }> = new Map();

  // ── v2: 阶段定义（预绑定门控标签）──
  private stageDefs: StageDefinition[] = [];

  // ── v2: 当前阶段 ──
  private currentStage: string | null = null;

  // 写闸门统计
  private gateRejected = 0;
  private gateTotal = 0;

  // ★ P2: SQLite 持久化后端
  private wiki: MemoryWiki | null = null;

  // 事件回调
  onMemoryStored: ((entry: IndexEntry) => void) | null = null;
  onMemoryRecalled: ((query: RecallQuery, results: RecallResult) => void) | null = null;
  onGateDecision: ((entry: GateLogEntry) => void) | null = null;

  constructor(config?: MemoryBusConfig) {
    this.config = {
      dataDir: config?.dataDir ?? './data/memory-bus',
      embedUrl: config?.embedUrl ?? 'http://localhost:3100',
      vectorDimension: config?.vectorDimension ?? 1024,
      writeGateThreshold: config?.writeGateThreshold ?? 2,
      enableGraphPersistence: config?.enableGraphPersistence ?? true,
      enableAutoCognify: config?.enableAutoCognify ?? false,
      mainPoolCapacity: config?.mainPoolCapacity ?? 1000,
      scoreWeights: config?.scoreWeights ?? { recency: 0.25, frequency: 0.30, relation: 0.25, importance: 0.20 },
    };

    // Assign v2 config to class fields
    this.mainPoolCapacity = this.config.mainPoolCapacity;
    this.scoreWeights = this.config.scoreWeights as ScoreWeights;

    this.dataDir = path.resolve(this.config.dataDir);
    this.indexFile = path.join(this.dataDir, 'index.jsonl');
    this.gateLogFile = path.join(this.dataDir, 'gate-log.jsonl');
    this.compactionLogFile = path.join(this.dataDir, 'compaction-log.jsonl');
    this.archiveFile = path.join(this.dataDir, 'archive.jsonl');

    // P2: 初始化微批处理写入器
    this.indexWriter = new JSONLWriter({ filePath: this.indexFile });
    this.archiveWriter = new JSONLWriter({ filePath: this.archiveFile });
    this.gateLogWriter = new JSONLWriter({ filePath: this.gateLogFile });
    this.compactionLogWriter = new JSONLWriter({ filePath: this.compactionLogFile });

    // 初始化图谱层（延迟：如果外部注入则在 initialize 中初始化）
  }

  /**
   * setGraph — 注入外部 KnowledgeGraph 实例
   *
   * 在调用 initialize() 之前调用，以共享统一的图谱实例。
   * 如果未调用，MemoryBus 会在 initialize() 中自动创建。
   */
  /**
   * setWiki — 注入 MemoryWiki 实例作为持久化后端
   */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  setGraph(graph: KnowledgeGraph): void {
    if (this._graphInjected) {
      console.warn('[MemoryBus] ⚠️ 重复注入 KnowledgeGraph');
    }
    this.graph = graph;
    this._graphInjected = true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    // 确保目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // 加载 Provenance 索引
    await this.loadIndex();

    // 加载 Archive
    await this.loadArchive();

    // 创建内部图谱层（如果未注入外部实例）
    if (!this._graphInjected) {
      this.graph = new KnowledgeGraph({
        maxEntities: 5000,
        dataDir: path.join(this.dataDir, 'knowledge'),
      });
    }

    // 加载知识图谱
    if (this.config.enableGraphPersistence) {
      await this.graph.loadFromDisk();
    }

    // 初始计算所有 score
    for (const [, entry] of this.index) {
      if (!entry.archived) {
        entry.score = this.computeScore(entry);
      }
    }

    console.log('[MemoryBus] ✅ 三维一体记忆总线 v2 就绪');
    console.log(`  ├─ Provenance: ${this.index.size} 条索引`);
    console.log(`  ├─ Archive:    ${this.archive.size} 条归档`);
    console.log(`  ├─ Semantic:   zvec (${this.config.vectorDimension}d)`);
    console.log(`  └─ Topology:   ${this.graph.getStats().totalEntities} 实体, ${this.graph.getStats().totalRelations} 关系`);
  }

  private async loadIndex(): Promise<void> {
    if (!fs.existsSync(this.indexFile)) return;
    try {
      const content = fs.readFileSync(this.indexFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as IndexEntry;
          // v2: 确保新字段有默认值（兼容旧数据）
          if (!entry.memType) entry.memType = 'summary';
          if (entry.accessCount === undefined) entry.accessCount = 0;
          if (!entry.lastAccessedAt) entry.lastAccessedAt = entry.timestamp;
          if (entry.relationCount === undefined) entry.relationCount = 0;
          if (entry.score === undefined) entry.score = 0;
          if (entry.archived === undefined) entry.archived = false;
          this.index.set(entry.id, entry);
          this.hashIndex.set(entry.contentHash, entry);
        } catch { /* skip corrupt */ }
      }
      console.log(`[MemoryBus] 📋 加载索引: ${this.index.size} 条`);
    } catch (err: any) {
      console.warn(`[MemoryBus] ⚠️ 索引加载失败: ${err.message}`);
    }
  }

  private async loadArchive(): Promise<void> {
    if (!fs.existsSync(this.archiveFile)) return;
    try {
      const content = fs.readFileSync(this.archiveFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry: IndexEntry = JSON.parse(line);
          entry.archived = true;
          this.archive.set(entry.id, entry);
          this.archiveHashIndex.set(entry.contentHash, entry);
        } catch { /* skip corrupt */ }
      }
      console.log(`[MemoryBus] 📦 加载归档: ${this.archive.size} 条`);
    } catch (err: any) {
      console.warn(`[MemoryBus] ⚠️ 归档加载失败: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: Score 计算
  // ═══════════════════════════════════════════════════════════════

  /**
   * 竞争分数计算
   *
   * 公式：
   *   score = w1 * recencyBonus + w2 * frequencyBonus
   *         + w3 * relationBonus + w4 * importanceBase
   */
  private computeScore(item: IndexEntry): number {
    const hoursSinceAccess = (Date.now() - item.lastAccessedAt) / 3600000;
    const recencyBonus = 1 / (1 + hoursSinceAccess / 24);   // 0~1
    const frequencyBonus = Math.log(1 + item.accessCount);   // 0~∞
    const relationBonus = Math.log(1 + (item.relationCount || 0)); // 0~∞
    const importanceBase = item.importance / 10;             // 0.1~0.5

    return (
      this.scoreWeights.recency * recencyBonus +
      this.scoreWeights.frequency * frequencyBonus +
      this.scoreWeights.relation * relationBonus +
      this.scoreWeights.importance * importanceBase
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: 竞争池机制
  // ═══════════════════════════════════════════════════════════════

  /**
   * 如果主池已满，逐出最低分条目到 Archive
   * 知识类记忆 (memType=knowledge) 受保护，不被逐出
   */
  private maybeEvictToArchive(): void {
    const mainPoolEntries = [...this.index.values()].filter(e => !e.archived);
    if (mainPoolEntries.length <= this.mainPoolCapacity) return;

    // 找最低分（排除 knowledge）
    let lowest: IndexEntry | null = null;
    let lowestScore = Infinity;
    for (const entry of mainPoolEntries) {
      if (entry.memType === 'knowledge') continue; // 知识受保护
      if (entry.score < lowestScore) {
        lowestScore = entry.score;
        lowest = entry;
      }
    }

    if (lowest) {
      lowest.archived = true;
      this.archive.set(lowest.id, lowest);
      this.appendArchiveEntry(lowest);
      console.log(`[MemoryBus] 📦 主池已满，逐出到归档: ${lowest.id} (score: ${lowestScore.toFixed(3)})`);
    }
  }

  private appendArchiveEntry(entry: IndexEntry): void {
    this.archiveWriter.append(entry);
    this.archiveHashIndex.set(entry.contentHash, entry);
  }

  // ═══════════════════════════════════════════════════════════════
  // remember() — ECL 流水线 (v2 增强)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 记忆写入（ECL 流水线 + 竞争写入）
   *
   * E = Extract & Normalize: MD5 哈希去重 + 重要性评估
   * C = Cognify:            LLM 实体/关系抽取（异步，可选）
   * L = Load:               三层原子写入 + 池竞争
   */
  async remember(payload: MemoryPayload): Promise<IndexEntry | null> {
    // ── E: Extract & Normalize ──
    const contentHash = this.hash(payload.content);

    // ★ P0 优化: 使用 hashIndex O(1) 去重检查
    let existing = this.hashIndex.get(contentHash);
    if (!existing) existing = this.archiveHashIndex.get(contentHash);
    if (existing) {
      // 更新访问时间
      existing.accessCount++;
      existing.lastAccessedAt = Date.now();
      existing.score = this.computeScore(existing);
      console.log(`[MemoryBus] 🔄 重复内容，更新访问: ${contentHash.slice(0, 12)}...`);
      return existing;
    }

    // 重要性评估（如果未指定）
    const importance = payload.importance ?? this.evaluateImportance(payload);

    // ── 写闸门 ──
    const gateDecision = this.gateDecide(payload, importance);
    this.logGateDecision(gateDecision);

    if (gateDecision.action === 'reject') {
      return null;
    }

    // ── L: Load — Provenance Layer (v2 完整字段) ──
    const now = Date.now();
    const entry: IndexEntry = {
      id: `mem_${now}_${Math.random().toString(16).slice(2, 10)}`,
      contentHash,
      source: payload.source ?? 'unknown',
      sourceId: payload.sourceId,
      timestamp: now,
      chunkCount: 1,
      tags: payload.tags ?? [],
      importance: gateDecision.action === 'promote' ? Math.min(5, importance + 1) : importance,
      // v2 新字段
      memType: payload.memType ?? 'summary',
      accessCount: 0,
      lastAccessedAt: now,
      relationCount: 0,
      score: 0,
      archived: false,
    };

    // 计算初始 score
    entry.score = this.computeScore(entry);

    this.index.set(entry.id, entry);
    this.hashIndex.set(entry.contentHash, entry);
    this.appendIndexEntry(entry);

    // ── L: Load — Semantic Layer（向量写入） ──
    if (this.vectorStore && this.vectorStore.ready) {
      const memoryItem: MemoryItem = {
        id: entry.id,
        type: 'semantic',
        content: payload.content,
        tags: entry.tags,
        importance: entry.importance as any,
        createdAt: entry.timestamp,
        lastAccessedAt: entry.timestamp,
        accessCount: 0,
        memType: entry.memType,
        metadata: { source: entry.source, sourceId: entry.sourceId, contentHash: entry.contentHash },
      };
      this.vectorStore.write(memoryItem).catch(err => {
        console.warn(`[MemoryBus] ⚠️ 向量写入失败: ${err.message}`);
      });
    }

    // ── L: Load — Topology Layer（图谱实体） ──
    const entity = await this.graph.addEntity({
      type: this.inferEntityType(payload),
      name: payload.content.substring(0, 100),
      description: payload.content.substring(0, 500),
      refId: entry.id,
      tags: entry.tags,
      metadata: {
        source: entry.source,
        sourceId: entry.sourceId,
        contentHash: entry.contentHash,
        importance: entry.importance,
        memType: entry.memType,
      },
    });

    // ── C: Cognify（异步 LLM 实体抽取 — 可选） ──
    if (this.config.enableAutoCognify) {
      this.cognifyAsync(payload, entity).catch(err => {
        console.warn(`[MemoryBus] Cognify 失败: ${err.message}`);
      });
    }

    // ── v2: 竞争淘汰 ──
    this.maybeEvictToArchive();

    // ★ P2: MemoryWiki 持久化（不阻塞主流程）
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: entry.id,
        type: 'MemoryEntry',
        name: payload.content?.slice(0, 100) ?? '',
        data: {
          mem_type: entry.memType,
          content: payload.content,
          source: entry.source,
          source_id: entry.sourceId,
          tags: JSON.stringify(entry.tags ?? []),
          importance: entry.importance,
          score: entry.score ?? 0,
          pool: 'main',
          created_at: Math.floor(entry.timestamp / 1000),
        },
      }).catch(() => {});
    }

    this.onMemoryStored?.(entry);
    console.log(`[MemoryBus] 💾 已存储 [${entry.memType}]: ${payload.content.substring(0, 60)}...`);
    return entry;
  }

  /**
   * 批量记忆写入
   */
  async rememberMany(payloads: MemoryPayload[]): Promise<IndexEntry[]> {
    const results: IndexEntry[] = [];
    for (const p of payloads) {
      const entry = await this.remember(p);
      if (entry) results.push(entry);
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // recall() — 混合检索 (v2: 支持 includeArchive)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 记忆召回（混合检索路由）
   *
   * v2: 支持 includeArchive 查询归档池
   */
  async recall(query: RecallQuery): Promise<RecallResult> {
    const strategy = query.strategy ?? 'hybrid-rag';
    const topK = query.topK ?? 10;
    const graphDepth = query.graphDepth ?? 2;

    let result: RecallResult;

    switch (strategy) {
      case 'vector-first':
        result = await this.vectorFirstRecall(query, topK);
        break;
      case 'graph-walk':
        result = await this.graphWalkRecall(query, graphDepth);
        break;
      case 'hybrid-rag':
        result = await this.hybridRagRecall(query, topK, graphDepth);
        break;
    }

    // v2: 更新访问计数
    for (const item of result.items) {
      const entry = this.findEntryByContent(item);
      if (entry) {
        entry.accessCount++;
        entry.lastAccessedAt = Date.now();
        entry.score = this.computeScore(entry);
      }
    }

    // v2: 如果启用，也搜索归档池
    if (query.includeArchive && this.archive.size > 0) {
      const archiveItems = this.searchArchive(query.text, topK);
      result.items = [...result.items, ...archiveItems].slice(0, topK);
      result.source = 'hybrid'; // 标记为混合来源
    }

    this.onMemoryRecalled?.(query, result);
    return result;
  }

  /** 注入向量存储（在 initialize 前调用） */
  setVectorStore(store: ZVecStorage): void {
    this.vectorStore = store;
  }

  /** 模式 A: 向量优先 */
  private async vectorFirstRecall(query: RecallQuery, topK: number): Promise<RecallResult> {
    // 优先使用 zvec 语义搜索
    if (this.vectorStore && this.vectorStore.ready) {
      try {
        const vecResults = await this.vectorStore.query({ text: query.text, limit: topK });
        if (vecResults.length > 0) {
          const items: MemoryPayload[] = [];
          for (const vr of vecResults) {
            const entry = this.index.get(vr.id);
            const entities = this.graph.searchEntities({ text: vr.id, limit: 1 });
            const entityName = entities.length > 0 ? entities[0].name : (entry?.tags?.join(', ') ?? vr.id);
            items.push({
              content: entityName,
              source: entry?.source ?? 'vector',
              sourceId: entry?.sourceId ?? vr.id,
              tags: entry?.tags ?? [],
              importance: entry?.importance ?? 3,
              memType: entry?.memType,
              metadata: { entityName, vectorId: vr.id },
            });
          }
          if (items.length > 0) {
            const result: RecallResult = { items, source: 'vector' };
            return result;
          }
        }
      } catch (err: any) {
        console.warn(`[MemoryBus] ⚠️ zvec 查询失败: ${err.message}，降级到图谱搜索`);
      }
    }

    // 降级：在图谱中搜索匹配的实体
    const fallbackEntities = this.graph.searchEntities({ text: query.text, limit: topK });
    const items: MemoryPayload[] = fallbackEntities.map(e => ({
      content: e.name,
      source: 'graph-fallback',
      sourceId: e.refId,
      tags: e.tags,
      importance: (e.metadata?.importance as number) ?? 3,
      metadata: { entityName: e.name, entityId: e.id },
    }));

    return { items, source: 'vector' };
  }

  /** 模式 B: 图谱寻路 */
  private async graphWalkRecall(query: RecallQuery, depth: number): Promise<RecallResult> {
    const matchedEntities = this.graph.searchEntities({
      text: query.text,
      limit: 5,
    });

    if (matchedEntities.length === 0) {
      return { items: [], source: 'graph' };
    }

    const allEntities = new Map<string, KnowledgeEntity>();
    const allRelations: KnowledgeRelation[] = [];

    for (const entity of matchedEntities) {
      const hood = this.graph.getNeighborhood(entity.id, depth);
      for (const e of hood.entities) {
        allEntities.set(e.id, e);
      }
      allRelations.push(...hood.relations);
    }

    const items: MemoryPayload[] = [...allEntities.values()].map(e => ({
      content: e.name,
      source: 'graph',
      sourceId: e.refId,
      tags: e.tags,
      importance: (e.metadata?.importance as number) ?? 3,
      metadata: e.metadata,
    }));

    return {
      items: items.slice(0, query.topK ?? 10),
      source: 'graph',
      graphPath: matchedEntities,
      entities: [...allEntities.values()],
    };
  }

  /** 模式 C: 混合 RAG */
  private async hybridRagRecall(query: RecallQuery, topK: number, graphDepth: number): Promise<RecallResult> {
    const vectorResults = await this.vectorFirstRecall(query, topK);

    const expandedEntities = new Map<string, KnowledgeEntity>();
    const graphSearchText = query.text;
    const graphMatches = this.graph.searchEntities({ text: graphSearchText, limit: 5 });
    for (const entity of graphMatches) {
      expandedEntities.set(entity.id, entity);
      const hood = this.graph.getNeighborhood(entity.id, graphDepth);
      for (const e of hood.entities) {
        expandedEntities.set(e.id, e);
      }
    }
    for (const item of vectorResults.items) {
      if (item.metadata?.entityName) {
        const entities = this.graph.searchEntities({ text: item.metadata.entityName as string, limit: 2 });
        for (const entity of entities) {
          if (!expandedEntities.has(entity.id)) {
            expandedEntities.set(entity.id, entity);
            const hood = this.graph.getNeighborhood(entity.id, 1);
            for (const e of hood.entities) {
              expandedEntities.set(e.id, e);
            }
          }
        }
      }
    }

    const graphItems: MemoryPayload[] = [...expandedEntities.values()].map(e => ({
      content: e.name,
      source: 'graph',
      sourceId: e.refId,
      tags: e.tags,
      importance: (e.metadata?.importance as number) ?? 3,
      metadata: e.metadata,
    }));

    const result: RecallResult = {
      items: [...vectorResults.items, ...graphItems].slice(0, topK),
      source: 'hybrid',
      entities: [...expandedEntities.values()],
    };

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // forget() — 三层联合删除
  // ═══════════════════════════════════════════════════════════════

  forget(id: string): boolean {
    let deleted = false;

    const indexEntry = this.index.get(id);
    if (indexEntry) {
      this.hashIndex.delete(indexEntry.contentHash);
      this.index.delete(id);
      deleted = true;
    }

    // 也从归档删除
    const archiveEntry = this.archive.get(id);
    if (archiveEntry) {
      this.archiveHashIndex.delete(archiveEntry.contentHash);
      this.archive.delete(id);
      deleted = true;
    }

    const entities = this.graph.searchEntities({ text: id, limit: 1 });
    for (const e of entities) {
      this.graph.removeEntity(e.id);
      deleted = true;
    }

    return deleted;
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: feedback() — 闭环反馈
  // ═══════════════════════════════════════════════════════════════

  /**
   * 闭环反馈 — 标记记忆是否有用
   *
   * 有用 → accessCount +2, 重算 score (提升排名)
   * 无用 → accessCount -1 (最低到 0), 重算 score (降低排名)
   */
  feedback(id: string, useful: boolean): FeedbackResult | null {
    const entry = this.index.get(id) ?? this.archive.get(id);
    if (!entry) return null;

    const oldScore = entry.score;

    if (useful) {
      entry.accessCount += 2; // Boost
    } else {
      entry.accessCount = Math.max(0, entry.accessCount - 1);
    }
    entry.lastAccessedAt = Date.now();
    entry.score = this.computeScore(entry);

    return {
      id,
      useful,
      scoreDelta: entry.score - oldScore,
      newScore: entry.score,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: compactMemories() — 破坏性变化
  // ═══════════════════════════════════════════════════════════════

  /**
   * 记忆压缩与遗忘（破坏性变化：签名从 (minImportance, olderThanDays) → ()）
   *
   * 执行顺序：
   *   1. 按类型遗忘（correction 30天删除、summary 30天归档/90天删除、profile 90天归档）
   *   2. 主池溢出 → 按 score 竞争淘汰到 Archive
   *   3. 所有条目重算 score（每日衰减）
   */
  compactMemories(): CompactResult {
    let evicted = 0;

    // Step 1: 按类型遗忘
    const forgettingResult = this.applyTypeBasedForgetting();

    // Step 2: 主池溢出 → 竞争淘汰
    const mainPool = [...this.index.values()].filter(e => !e.archived);
    if (mainPool.length > this.mainPoolCapacity) {
      // 按 score 升序排列
      mainPool.sort((a, b) => a.score - b.score);
      const overflow = mainPool.length - this.mainPoolCapacity;
      for (let i = 0; i < overflow && i < mainPool.length; i++) {
        if (mainPool[i].memType === 'knowledge') continue;
        mainPool[i].archived = true;
        this.archive.set(mainPool[i].id, mainPool[i]);
        this.appendArchiveEntry(mainPool[i]);
        evicted++;
      }
    }

    // Step 3: 所有条目重算 score
    for (const [, entry] of this.index) {
      if (!entry.archived) {
        entry.score = this.computeScore(entry);
      }
    }

    const totalResult: CompactResult = {
      evicted,
      archived: forgettingResult.archived,
      merged: forgettingResult.merged,
      deleted: forgettingResult.deleted,
    };

    if (totalResult.evicted + totalResult.archived + totalResult.deleted > 0) {
      console.log(`[MemoryBus] 📦 压缩完成: ${totalResult.evicted} 挤出, ${totalResult.archived} 归档, ${totalResult.deleted} 删除`);
    }

    return totalResult;
  }

  /**
   * 按类型遗忘 — 不同类型不同生命周期
   */
  private applyTypeBasedForgetting(): CompactResult {
    const result: CompactResult = { evicted: 0, archived: 0, merged: 0, deleted: 0 };
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, entry] of this.index) {
      if (entry.archived) continue;

      switch (entry.memType) {
        case 'correction': {
          if (now - entry.timestamp > 30 * 86400_000) {
            toDelete.push(id);
            result.deleted++;
          }
          break;
        }
        case 'summary': {
          const ageDays = (now - entry.timestamp) / 86400_000;
          if (ageDays > 90) {
            toDelete.push(id);
            this.archive.delete(id);
            result.deleted++;
          } else if (ageDays > 30 && !entry.archived) {
            entry.archived = true;
            this.archive.set(id, entry);
            this.appendArchiveEntry(entry);
            result.archived++;
          }
          break;
        }
        case 'profile': {
          const ageDays = (now - entry.timestamp) / 86400_000;
          if (ageDays > 90 && entry.accessCount === 0) {
            entry.archived = true;
            this.archive.set(id, entry);
            this.appendArchiveEntry(entry);
            result.archived++;
          }
          break;
        }
        case 'knowledge':
          break;
        case 'stage_output':
          break;
      }
    }

    // 安全删除（避免迭代中修改 Map）
    for (const id of toDelete) {
      const entry = this.index.get(id);
      if (entry) this.hashIndex.delete(entry.contentHash);
      this.index.delete(id);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: 阶段管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * 阶段完成 — 提取摘要，完整输出存入 Temp Pool
   */
  async stageComplete(summary: string, output: string): Promise<void> {
    const stageName = this.currentStage ?? 'unknown';

    // 摘要 → Main Pool
    await this.remember({
      content: summary,
      source: 'stage',
      sourceId: stageName,
      tags: ['stage_summary', stageName],
      importance: 4,
      memType: 'summary',
      metadata: { stageName, completedAt: Date.now() },
    });

    // 完整输出 → Temp Pool（供后续阶段引用）
    this.tempPool.set(stageName, {
      content: output,
      stageName,
      timestamp: Date.now(),
    });

    // 重置当前阶段
    this.currentStage = null;

    console.log(`[MemoryBus] ✅ 阶段完成: ${stageName} → 摘要已存储, 输出已缓存`);
  }

  /**
   * 阶段规划 — LLM 预绑定门控标签
   */
  planStages(stages: StageDefinition[]): void {
    this.stageDefs = stages;
    console.log(`[MemoryBus] 📋 阶段规划: ${stages.length} 个阶段已预绑定门控标签`);
  }

  /**
   * 设置当前活跃阶段
   */
  setCurrentStage(stageName: string): void {
    this.currentStage = stageName;
  }

  /**
   * 审计 — 为当前 query 输出门控信号
   */
  audit(query: string, targetStage?: string): MemoryGateSignal {
    const stageDef = targetStage
      ? this.stageDefs.find(s => s.name === targetStage)
      : undefined;

    const gates: MemoryGateConfig = stageDef?.memoryGates ?? {
      sessionSummaryChain: true,
      tempPoolLastOutput: false,
      userGlobalProfile: false,
      uiVisualStandards: false,
      errorCorrectionRules: true,
    };

    return {
      intent: this.inferIntent(query),
      targetStage: targetStage ?? this.currentStage ?? 'unknown',
      memoryGates: gates,
    };
  }

  /**
   * 简单意图推断（后续可升级为 LLM 判断）
   */
  private inferIntent(query: string): string {
    const lower = query.toLowerCase();
    if (lower.includes('继续') || lower.includes('接着') || lower.includes('昨天')) return 'project_resume';
    if (lower.includes('修复') || lower.includes('bug') || lower.includes('报错') || lower.includes('fix')) return 'bug_fix';
    if (lower.includes('设计') || lower.includes('架构') || lower.includes('方案')) return 'design';
    if (lower.includes('ui') || lower.includes('界面') || lower.includes('样式') || lower.includes('配色')) return 'ui_design';
    if (lower.includes('测试') || lower.includes('验证') || lower.includes('test')) return 'testing';
    if (lower.includes('编码') || lower.includes('实现') || lower.includes('写') || lower.includes('code')) return 'coding';
    return 'general';
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: Layer 2 输入拦截
  // ═══════════════════════════════════════════════════════════════

  /**
   * Layer 2: 输入拦截层 — 注入相关错误修正
   *
   * 在 LLM 推理之前调用，只拦截 memType=correction 的已知错误。
   * 最多注入 3 条，基于关键词重叠匹配。
   * （生产环境应升级为语义向量相似度匹配，阈值 ≥ 0.8）
   */
  async interceptInput(query: string): Promise<MemoryPayload[]> {
    const corrections: MemoryPayload[] = [];

    for (const [, entry] of this.index) {
      if (entry.memType !== 'correction' || entry.archived) continue;

      // 关键词重叠匹配
      const queryWords = query.toLowerCase().split(/\s+/);
      const entryWords = entry.tags.join(' ').toLowerCase().split(/\s+/);
      const overlap = queryWords.filter(w => entryWords.some(ew => ew.includes(w) || w.includes(ew))).length;
      const similarity = overlap / Math.max(1, queryWords.length);

      if (similarity >= 0.5) {
        corrections.push({
          content: `[修正] ${entry.tags.join(', ')}`,
          source: 'correction',
          sourceId: entry.id,
          tags: entry.tags,
          importance: 5,
          memType: 'correction',
          metadata: { entryId: entry.id, similarity },
        });
      }

      if (corrections.length >= 3) break; // 最多 3 条
    }

    return corrections;
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: Temp Pool 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * 获取某阶段的完整输出
   */
  getTempPoolOutput(stageName: string): { content: string; stageName: string; timestamp: number } | null {
    return this.tempPool.get(stageName) ?? null;
  }

  /**
   * 获取已完成阶段的摘要链
   */
  getSummaryChain(): string[] {
    const summaries: string[] = [];
    for (const [, entry] of this.index) {
      if (entry.memType === 'summary' && !entry.archived) {
        const label = entry.tags
          .filter(t => !['stage_summary', 'summary'].includes(t))
          .join('/');
        summaries.push(`${label}: ${entry.source ?? entry.contentHash}`);
      }
    }
    return summaries;
  }

  /**
   * 清理 Temp Pool（任务完成后调用）
   */
  clearTempPool(): void {
    this.tempPool.clear();
  }

  // ═══════════════════════════════════════════════════════════════
  // v2: 归档搜索
  // ═══════════════════════════════════════════════════════════════

  private searchArchive(text: string, topK: number): MemoryPayload[] {
    const results: MemoryPayload[] = [];
    const keywords = text.toLowerCase().split(/\s+/);

    for (const [, entry] of this.archive) {
      const tagStr = entry.tags.join(' ').toLowerCase();
      const matchCount = keywords.filter(kw => tagStr.includes(kw)).length;
      if (matchCount > 0) {
        results.push({
          content: `[归档] ${entry.tags.join(', ')}`,
          source: 'archive',
          sourceId: entry.id,
          tags: entry.tags,
          importance: entry.importance,
          memType: entry.memType,
          metadata: { archived: true, entryId: entry.id, matchCount },
        });
      }
    }

    // 按匹配数排序
    results.sort((a, b) =>
      ((b.metadata?.matchCount as number) ?? 0) - ((a.metadata?.matchCount as number) ?? 0)
    );

    return results.slice(0, topK);
  }

  private findEntryByContent(item: MemoryPayload): IndexEntry | null {
    if (item.metadata?.entryId) {
      return this.index.get(item.metadata.entryId as string) ?? null;
    }
    if (item.sourceId) {
      return this.index.get(item.sourceId) ?? null;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // improve() — 自我进化（反思循环）
  // ═══════════════════════════════════════════════════════════════

  async improve(): Promise<ImproveResult> {
    // ── 1. 闸门分析 ──
    const gateStats = this.analyzeGateLog();
    let gateRecommendation = 'normal';
    if (gateStats.rejectRate > 0.7 && gateStats.totalDecisions > 10) {
      gateRecommendation = 'lower_threshold';
      console.log(`[MemoryBus] 🔧 闸门拒绝率 ${(gateStats.rejectRate * 100).toFixed(1)}% > 70%，建议调低阈值`);
    } else if (gateStats.rejectRate < 0.1 && gateStats.totalDecisions > 20) {
      gateRecommendation = 'raise_threshold';
      console.log(`[MemoryBus] 🔧 闸门拒绝率 ${(gateStats.rejectRate * 100).toFixed(1)}% < 10%，过于宽松，建议调高阈值`);
    }

    if (gateRecommendation !== 'normal') {
      this.logCompaction('gate_adjust', {
        rejectRate: gateStats.rejectRate,
        totalDecisions: gateStats.totalDecisions,
        recommendation: gateRecommendation,
      });
    }

    // ── 2. 冷记忆检测 ──
    const thirtyDaysAgo = Date.now() - 30 * 86400_000;
    let coldMemoriesFound = 0;
    for (const [, entry] of this.index) {
      if (entry.timestamp < thirtyDaysAgo && !entry.archived && entry.memType !== 'knowledge') {
        coldMemoriesFound++;
      }
    }
    if (coldMemoriesFound > 0) {
      console.log(`[MemoryBus] ❄️ 发现 ${coldMemoriesFound} 条冷记忆 (>30天未访问)`);
    }

    // ── 3. 孤儿实体检测 ──
    let orphanEntities = 0;
    const allEntities = this.graph.searchEntities({ limit: 10000 });
    for (const entity of allEntities) {
      if (entity.refId && !this.index.has(entity.refId)) {
        orphanEntities++;
      }
    }
    if (orphanEntities > 0) {
      console.log(`[MemoryBus] 👻 发现 ${orphanEntities} 个孤儿实体`);
    }

    // ── 4. 拓扑剪枝 + 记忆压缩 ──
    const nodesMerged = await this.compactGraphNodes();
    const compactResult = this.compactMemories();

    const result: ImproveResult = {
      gateAnalysis: {
        rejectRate: gateStats.rejectRate,
        totalDecisions: gateStats.totalDecisions,
        recommendation: gateRecommendation,
      },
      nodesMerged,
      memoriesCompacted: compactResult.evicted + compactResult.archived + compactResult.deleted,
      coldMemoriesFound,
      orphanEntities,
    };

    console.log(`[MemoryBus] 🧠 自我进化完成: 合并${nodesMerged}节点, 压缩${result.memoriesCompacted}记忆`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部辅助方法
  // ═══════════════════════════════════════════════════════════════

  private hash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private evaluateImportance(payload: MemoryPayload): number {
    let score = 2;
    if (payload.content.startsWith('记住:') || payload.content.startsWith('记住：')) {
      score = 5;
    }
    if (payload.tags?.some(t => ['critical', 'milestone', 'decision', 'error'].includes(t))) {
      score = Math.max(score, 5);
    }
    if (payload.content.length > 500) score = Math.max(score, 4);
    else if (payload.content.length > 200) score = Math.max(score, 3);
    if (payload.source === 'execution') score = Math.max(score, 4);
    // v2: 修正类记忆默认高重要性
    if (payload.memType === 'correction') score = Math.max(score, 5);
    return score;
  }

  private gateDecide(payload: MemoryPayload, importance: number): GateLogEntry {
    const entry: GateLogEntry = {
      timestamp: Date.now(),
      contentHash: this.hash(payload.content),
      action: 'store',
      reason: '',
      importance,
      tags: payload.tags ?? [],
    };

    this.gateTotal++;

    if (importance >= this.config.writeGateThreshold) {
      entry.action = 'store';
      entry.reason = `重要性 ${importance} ≥ 阈值 ${this.config.writeGateThreshold}`;
    } else if (importance === this.config.writeGateThreshold - 1 && payload.tags && payload.tags.length >= 2) {
      entry.action = 'promote';
      entry.reason = `接近阈值且有足够标签，提升`;
    } else {
      entry.action = 'reject';
      entry.reason = `重要性 ${importance} < 阈值 ${this.config.writeGateThreshold}`;
      this.gateRejected++;
    }

    return entry;
  }

  private logGateDecision(entry: GateLogEntry): void {
    this.gateLogWriter.append(entry);
    this.onGateDecision?.(entry);
  }

  private appendIndexEntry(entry: IndexEntry): void {
    this.indexWriter.append(entry);
  }

  private inferEntityType(payload: MemoryPayload): EntityType {
    if (payload.source === 'chat') return 'memory';
    if (payload.source === 'document') return 'document';
    if (payload.source === 'execution') return 'execution';
    if (payload.tags?.includes('skill')) return 'skill';
    if (payload.tags?.includes('technology') || payload.tags?.includes('tool')) return 'technology';
    return 'memory';
  }

  private async cognifyAsync(payload: MemoryPayload, entity: KnowledgeEntity): Promise<void> {
    console.log(`[MemoryBus] 🧠 Cognify 已调度: ${entity.name.substring(0, 50)}`);
  }

  private analyzeGateLog(): { totalDecisions: number; rejectRate: number } {
    if (!fs.existsSync(this.gateLogFile)) return { totalDecisions: 0, rejectRate: 0 };

    try {
      const content = fs.readFileSync(this.gateLogFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const recent = lines.slice(-100);

      let rejected = 0;
      for (const line of recent) {
        try {
          const entry: GateLogEntry = JSON.parse(line);
          if (entry.action === 'reject') rejected++;
        } catch {}
      }

      return {
        totalDecisions: recent.length,
        rejectRate: recent.length > 0 ? rejected / recent.length : 0,
      };
    } catch {
      return { totalDecisions: 0, rejectRate: 0 };
    }
  }

  private async compactGraphNodes(): Promise<number> {
    const allEntities = this.graph.searchEntities({ limit: 10000 });
    if (allEntities.length < 2) return 0;

    let merged = 0;
    const mergedIds = new Set<string>();

    for (let i = 0; i < allEntities.length; i++) {
      if (mergedIds.has(allEntities[i].id)) continue;
      for (let j = i + 1; j < allEntities.length; j++) {
        if (mergedIds.has(allEntities[j].id)) continue;
        if (allEntities[i].type !== allEntities[j].type) continue;

        const sim = this.nameSimilarity(allEntities[i].name, allEntities[j].name);
        if (sim < 0.85) continue;

        const survivor = allEntities[i];
        const absorbed = allEntities[j];
        const mergedTags = [...new Set([...survivor.tags, ...absorbed.tags])];

        const allRelations = this.graph.searchRelations({ limit: 10000 });
        for (const rel of allRelations) {
          if (rel.source === absorbed.id) {
            this.graph.correctRelation(rel.id, { source: survivor.id });
          }
          if (rel.target === absorbed.id) {
            this.graph.correctRelation(rel.id, { target: survivor.id });
          }
        }

        this.graph.correctEntity(survivor.id, {
          description: `${survivor.description ?? ''}; ${absorbed.description ?? ''}`.substring(0, 500),
          tags: mergedTags,
          metadata: { ...survivor.metadata, mergedFrom: absorbed.id, mergedAt: Date.now(), mergedSimilarity: sim },
        });

        this.graph.removeEntity(absorbed.id);
        mergedIds.add(absorbed.id);
        merged++;

        this.logCompaction('merge_nodes', {
          survivorId: survivor.id, survivorName: survivor.name,
          absorbedId: absorbed.id, absorbedName: absorbed.name,
          similarity: Math.round(sim * 100) / 100,
        });
      }
    }

    if (merged > 0) {
      console.log(`[MemoryBus] 🔧 拓扑剪枝: 合并 ${merged} 对相似实体`);
    }
    return merged;
  }

  private nameSimilarity(a: string, b: string): number {
    const trigrams = (s: string): Set<string> => {
      const t = new Set<string>();
      const str = s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      for (let i = 0; i < str.length - 2; i++) {
        t.add(str.substring(i, i + 3));
      }
      return t;
    };
    const ta = trigrams(a);
    const tb = trigrams(b);
    if (ta.size === 0 && tb.size === 0) return 1;
    const intersection = new Set([...ta].filter(x => tb.has(x)));
    const union = new Set([...ta, ...tb]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private logCompaction(action: string, details: Record<string, any>): void {
    this.compactionLogWriter.append({
      timestamp: Date.now(),
      action,
      ...details,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  getStats() {
    const graphStats = this.graph.getStats();
    return {
      provenance: {
        totalIndexed: this.index.size,
        mainPoolCount: [...this.index.values()].filter(e => !e.archived).length,
        archiveCount: this.archive.size,
        correctionCount: [...this.index.values()].filter(e => e.memType === 'correction').length,
      },
      semantic: {},
      topology: graphStats,
      gate: {
        total: this.gateTotal,
        rejected: this.gateRejected,
        rejectRate: this.gateTotal > 0 ? (this.gateRejected / this.gateTotal * 100).toFixed(1) + '%' : '0%',
      },
      v2: {
        tempPoolSize: this.tempPool.size,
        stageDefs: this.stageDefs.length,
        currentStage: this.currentStage,
      },
    };
  }

  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  getArchive(): Map<string, IndexEntry> {
    return this.archive;
  }

  getScoreWeights() {
    return { ...this.scoreWeights };
  }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════════

  async shutdown(): Promise<void> {
    console.log('[MemoryBus] 关闭...');

    // P2: 刷盘所有缓冲区
    this.indexWriter.shutdown();
    this.archiveWriter.shutdown();
    this.gateLogWriter.shutdown();
    this.compactionLogWriter.shutdown();

    // 知识图谱 JSONL writer 在 Phase 5 已移除

    await this.graph.saveSnapshot();
    console.log('[MemoryBus] ✅ 已关闭');
  }
}
