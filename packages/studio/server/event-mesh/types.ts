/**
 * Event Mesh v10 — 类型定义
 *
 * Schema Registry、事件版本控制、重放引擎的类型系统。
 */

// ═══════════════════════════════════════════════════════════════
// Event Schema
// ═══════════════════════════════════════════════════════════════

export interface EventSchema {
  /** 事件类型（如 'mission.created'） */
  type: string;
  /** Schema 版本号 */
  version: number;
  /** JSON Schema 定义 */
  schema: Record<string, unknown>;
  /** 是否兼容旧版本 */
  backwardCompatible: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 变更说明 */
  changelog?: string;
}

// ═══════════════════════════════════════════════════════════════
// v10 事件格式
// ═══════════════════════════════════════════════════════════════

export interface MorpexEventV10 {
  id: string;
  type: string;
  version: number;
  timestamp: number;
  traceId: string;
  missionId: string;
  payload: any;
}

// ═══════════════════════════════════════════════════════════════
// Schema Validation
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

// ═══════════════════════════════════════════════════════════════
// Replay
// ═══════════════════════════════════════════════════════════════

export interface ReplayRequest {
  /** 要重放的事件类型列表 */
  eventTypes?: string[];
  /** 按 Mission ID 筛选 */
  missionId?: string;
  /** 时间范围起始 */
  startTime?: number;
  /** 时间范围结束 */
  endTime?: number;
  /** 目标处理函数名称（可选，如果不填则按原始注册的处理器重放） */
  targetHandler?: string;
}

export interface ReplayResult {
  /** 请求重放的事件总数 */
  totalEvents: number;
  /** 成功处理数 */
  processed: number;
  /** 失败数 */
  failed: number;
  /** 耗时（ms） */
  duration: number;
  /** 详细错误 */
  errors: ReplayError[];
}

export interface ReplayError {
  eventId: string;
  type: string;
  error: string;
}

// ═══════════════════════════════════════════════════════════════
// Migration
// ═══════════════════════════════════════════════════════════════

export interface MigrationStep {
  fromVersion: number;
  toVersion: number;
  /** 迁移函数：将旧事件格式转换为新格式 */
  migrate: (event: any) => any;
  description: string;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

export interface EventMeshConfig {
  /** 是否启用 Schema 验证 */
  enableSchemaValidation?: boolean;
  /** 是否自动注册 Schema */
  autoRegisterSchema?: boolean;
  /** 重放最大事件数 */
  replayMaxEvents?: number;
  /** 默认事件版本 */
  defaultVersion?: number;
}
