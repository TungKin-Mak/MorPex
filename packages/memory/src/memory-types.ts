/**
 * memory-types — 统一记忆层契约（MemoryAPI）
 *
 * 唯一对外入口。工作流插件 / Ontology Gate 只依赖此契约，不直接依赖 cognee / SQLite。
 * 契约语义对应《记忆系统设计》：强制检索 → need_human、双时间、确认队列、生命周期。
 */

// ── 检索 ──────────────────────────────────────────────────────────────

export interface MemoryHit {
  /** 唯一 id（cognee 节点/边 或 本地记录） */
  id: string;
  /** 检索命中的事实/记忆内容 */
  content: string;
  /** 0~1 相关性 */
  score: number;
  /** graph | episodic | working */
  source: string;
  /** 双时间（可选） */
  validFrom?: string;
  validUntil?: string;
  /** 附加元数据（实体/关系、置信度、dataset 等） */
  metadata?: Record<string, unknown>;
}

export interface MemoryQueryRequest {
  text: string;
  /** 公司知识域还是通用 */
  domain?: 'company' | 'product' | 'code' | 'general' | string;
  /** 图检索优先使用的实体类型白名单（定位种子） */
  entityTypes?: string[];
  /** 双时间 asOf（ISO），过滤 validFrom<=asOf<validUntil */
  asOf?: string;
  /** 最低置信度 */
  minConfidence?: number;
  /** 作用域（防串台）：company/domain/project/client/user */
  scope?: string;
  dataset?: string;
  limit?: number;
}

export type MemoryQuerySource = 'graph' | 'episodic' | 'working' | 'mixed' | 'none';
export type NeedHumanReason = 'QueryMiss' | 'LowConfidence' | 'Conflict';

export interface MemoryQueryResult {
  hits: MemoryHit[];
  /** ⚠️ 强制门禁核心：为 true 时上层禁止用模型自身知识补全，必须询问用户 */
  need_human: boolean;
  reason?: NeedHumanReason;
  source: MemoryQuerySource;
  confidence: number;
}

// ── 写入 ──────────────────────────────────────────────────────────────

export interface UpsertEntityInput {
  /** 实体名，如 "MorPex 报表产品" */
  name: string;
  entityType: string;            // 必须 ∈ ontology 白名单
  /** 原子事实（observations） */
  facts?: string[];
  /** 关系：source=this 实体的出边 */
  relations?: Array<{
    toName: string;
    relationType: string;        // 必须 ∈ ontology 白名单
    fact?: string;
  }>;
  /** 0~1；低于 minConfidence → 进确认队列 */
  confidence?: number;
  /** 双时间起始 */
  validFrom?: string;
  scope?: string;
  dataset?: string;
  source?: string;               // user | agent | consolidation | ...
}

export type UpsertResult =
  | { status: 'written'; id: string }
  | { status: 'pending_confirm'; ticketId: string }
  | { status: 'rejected'; reason: string };

// ── 确认队列 ──────────────────────────────────────────────────────────

export interface ConfirmTicket {
  ticketId: string;
  content: string;
  confidence: number;
  reason: 'low_confidence' | 'conflict' | 'new_entity' | 'graph_unavailable';
  scope: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type ConfirmDecision = 'accept' | 'reject';

// ── 生命周期 ──────────────────────────────────────────────────────────

export interface ReflectResult {
  scanned: number;
  consolidated: number;
  promoted: number;
  candidates: string[];          // 生成的确认队列 ticketId
  details: string[];
}

// ── 统一 API ──────────────────────────────────────────────────────────

export interface MemoryAPI {
  /** 强制检索入口（Ontology Gate 消费）：图优先，空/低置信 → need_human */
  query(req: MemoryQueryRequest): Promise<MemoryQueryResult>;

  /** 写入：本体校验 → 置信度分流（高置信写权威图 / 低置信或冲突进确认队列） */
  upsert(input: UpsertEntityInput): Promise<UpsertResult>;

  /** 情景/会话直接写入（低门槛，不经确认队列）—— 统一入口的 episodic 通道 */
  rememberEpisode(content: string, meta?: {
    source?: string;
    sessionId?: string;
    tags?: string[];
    importance?: number;
    dataset?: string;
    scope?: string;
  }): Promise<{ id?: string; ok: boolean }>;

  /** 人工确认：accept 写权威层，reject 丢弃 */
  confirm(ticketId: string, decision: ConfirmDecision, meta?: Record<string, unknown>): Promise<void>;

  /** 待确认队列（Agent 主动询问用户的唯一来源） */
  listPendingConfirmations(limit?: number): Promise<ConfirmTicket[]>;

  /** 过时事实：双时间 invalidate（保留历史，asOf 可查） */
  invalidate(name: string, validUntil?: string): Promise<void>;

  /** 巩固：情景 → 经验模式提升候选 */
  reflect(): Promise<ReflectResult>;

  /** 衰减/归档 */
  decayTick(): Promise<void>;
}

// ── 引擎适配器契约（低耦合：MemoryAPI 依赖此接口，不依赖具体实现）────

export interface EngineHit {
  id: string;
  content: string;
  score: number;
  validFrom?: string;
  validUntil?: string;
  metadata?: Record<string, unknown>;
}

export interface EngineSearchOptions {
  dataset?: string;
  scope?: string;
  entityTypes?: string[];
  asOf?: string;
  limit?: number;
}

export interface EngineWriteOptions {
  dataset?: string;
  scope?: string;
  sessionId?: string;
  confidence?: number;
  validFrom?: string;
}

export interface MemoryEngine {
  readonly kind: string;
  /** 写入一条事实（图） */
  remember(content: string, opts?: EngineWriteOptions): Promise<{ ok: boolean; id?: string; reason?: string }>;
  /** 分层召回（session 优先 → 图） */
  recall(query: string, opts?: EngineSearchOptions): Promise<EngineHit[]>;
  /** 图检索（GRAPH_COMPLETION，图优先） */
  searchGraph(query: string, opts?: EngineSearchOptions): Promise<EngineHit[]>;
  /** 混合检索（语义补充，不作为主路径） */
  searchHybrid(query: string, opts?: EngineSearchOptions): Promise<EngineHit[]>;
  /** 删除数据集 */
  forget(dataset: string): Promise<void>;
  /** 引擎可用性（cognee server 是否在线） */
  available(): Promise<boolean>;
}
