/**
 * @morpex/memory — 类型定义 (v2)
 *
 * v2 新增：
 *   - MemType: 按数据形态分类（非认知层）
 *   - MemoryGateConfig / MemoryGateSignal: 记忆门控
 *   - StageDefinition: 阶段预绑定
 *   - CompactResult: 压缩结果
 *   - FeedbackResult: 闭环反馈
 *   - includeArchive: 归档检索
 */

// ── 记忆类型 (v2: 按数据形态分类) ──

export type MemType = 'knowledge' | 'profile' | 'summary' | 'correction' | 'stage_output';

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'context' | 'observation';

// ── 记忆项 ──

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;      // 1-5
  executionId?: string;
  agentId?: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  /** v2: 记忆形态类型 */
  memType?: MemType;
  /** v2: 引用的其他记忆 ID */
  references?: string[];
  /** v2: 图谱关联数 */
  relationCount?: number;
}

// ── 记忆查询 ──

export interface MemoryQuery {
  text?: string;
  type?: MemoryType | MemoryType[];
  tags?: string[];
  limit?: number;
  minImportance?: number;
}

// ── 存储适配器 ──

export interface MemoryStorageAdapter {
  initialize(): Promise<void>;
  write(item: MemoryItem): Promise<boolean>;
  writeMany(items: MemoryItem[]): Promise<number>;
  query(query: MemoryQuery): Promise<MemoryItem[]>;
  get(id: string): Promise<MemoryItem | undefined>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  close(): Promise<void>;
}

// ── 写闸门 ──

export interface WriteDecision {
  action: 'store' | 'reject' | 'demote' | 'promote';
  reason: string;
}

// ── v2: 记忆门控 ──

export interface MemoryGateConfig {
  sessionSummaryChain: boolean;   // 历史阶段摘要链
  tempPoolLastOutput: boolean;    // 上一阶段完整输出
  userGlobalProfile: boolean;     // 用户全局偏好
  uiVisualStandards: boolean;     // UI 视觉规范
  errorCorrectionRules: boolean;  // 错误修正规则
}

export interface MemoryGateSignal {
  intent: string;
  targetStage: string;
  memoryGates: MemoryGateConfig;
}

// ── v2: 阶段定义 ──

export interface StageDefinition {
  name: string;
  goal: string;
  output: string;
  memoryGates: MemoryGateConfig;
}

// ── v2: 压缩结果 ──

export interface CompactResult {
  evicted: number;
  archived: number;
  merged: number;
  deleted: number;
}

// ── v2: 闭环反馈 ──

export interface FeedbackResult {
  id: string;
  useful: boolean;
  scoreDelta: number;
  newScore: number;
}

// ── 统计 ──

export interface MemoryStats {
  totalItems: number;
  byType: Record<string, number>;
  shortTermCount: number;
  graphNodeCount: number;
  gateRejected: number;
  totalRetrievals: number;
  /** v2: 归档池数量 */
  archiveCount: number;
  /** v2: 主竞争池数量 */
  mainPoolCount: number;
  /** v2: 错误修正数量 */
  correctionCount: number;
}

// ── 配置 ──

export interface MemorySystemConfig {
  embedUrl?: string;
  dataPath?: string;
  collectionName?: string;
  dimension?: number;
  shortTermCapacity?: number;
  writeGateThreshold?: number;
}
