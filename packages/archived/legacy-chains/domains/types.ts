/**
 * Domain Manifest Protocol — 类型定义
 *
 * 跨领域升级 Phase 8：领域清单协议 (Domain Manifest Protocol)
 *
 * 四层解耦架构的第一层基础：通过领域清单定义新领域，零代码改动。
 *
 * 遵循迁移铁律：
 *   0.1 (字段名法则): 代码字段名 = JSON 配置名，禁止翻译
 *   0.2 (类型来源法则): 基于 pi-ai/pi-agent-core 已有类型扩展
 *
 * v3.1 迁移说明：
 *   - ArtifactRef 已上浮至 core/types.ts (跨平面基础引用类型)
 *   - RoutingAnalysis 已从 router/types.ts 合并至此 (领域路由相关)
 */

import type { ArtifactRef } from '../common/types.js';

// ═══════════════════════════════════════════════════════════════
// Domain Manifest — 领域清单（核心协议）
// ═══════════════════════════════════════════════════════════════

/**
 * DomainManifest — 领域清单
 *
 * 定义一个领域所需的所有配置。新增领域只需编写一个 JSON 文件。
 * 字段名 = JSON key，严格一一对应。
 */
export interface DomainManifest {
  /** 领域唯一标识（如 "software_engineering"） */
  domain_id: string;
  /** 领域显示名称（如 "软件工程领域"） */
  domain_name: string;
  /** 清单版本（semver） */
  version: string;
  /** Master Agent 配置 */
  master_agent_config: MasterAgentConfig;
  /** 订阅的事件类型列表 */
  subscribed_events: string[];
  /** 可用技能文件列表 */
  skills: string[];
  /** 工作流定义（由 WorkflowEngine 消费） */
  workflow?: any;
  /** 该领域能产出的产物规格 */
  output_artifacts: ArtifactSpec[];
  /** 唤醒条件 */
  wake_conditions: WakeConditions;
  /** 允许使用的工具白名单（空数组=不限制，不可由 LLM 指定） */
  allowedTools?: string[];
  /** 禁止使用的工具黑名单 */
  disallowedTools?: string[];
  /** 工作区目录 — 该领域交付物的输出根目录（相对路径基于 process.cwd()） */
  workspace?: string;
}

/**
 * MasterAgentConfig — Master Agent 配置
 *
 * 控制该领域 Master Agent 的行为。
 */
export interface MasterAgentConfig {
  /** 系统提示词 */
  system_prompt: string;
  /** LLM 模型名称 */
  model: string;
  /** 温度参数 (0-1) */
  temperature?: number;
  /** 最大 Token 数 */
  maxTokens?: number;
}

/**
 * ArtifactSpec — 产物规格
 *
 * 定义领域能产出的产物类型和格式。
 */
export interface ArtifactSpec {
  /** 产物类型（如 "legal_report"） */
  type: string;
  /** 产物格式（如 "markdown", "docx"） */
  format: string;
  /** 可选描述 */
  description?: string;
}

/**
 * WakeConditions — 唤醒条件
 *
 * 决定何时自动唤醒该领域的条件组合。
 */
export interface WakeConditions {
  /** 意图关键词匹配模式 */
  intent_patterns: string[];
  /** 触发唤醒的事件类型 */
  events: string[];
  /** 触发唤醒的产物类型 */
  artifact_triggers: string[];
}

// ═══════════════════════════════════════════════════════════════
// 校验类型
// ═══════════════════════════════════════════════════════════════

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/** 校验错误 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// ═══════════════════════════════════════════════════════════════
// Domain Cluster 状态
// ═══════════════════════════════════════════════════════════════

/**
 * ClusterStatus — 领域集群生命周期状态
 *
 *   sleeping ──[wake()]──→ waking ──→ active
 *      ↑                                    │
 *      └─────────[sleep()]──────────────────←┘
 *      ↑                                    │
 *      └──────[drain + sleep()]──── draining─┘
 */
export type ClusterStatus = 'sleeping' | 'waking' | 'active' | 'draining';

// ═══════════════════════════════════════════════════════════════
// 跨领域路由 DAG 类型 (Phase 10)
// ═══════════════════════════════════════════════════════════════

/**
 * TaskDecomposition — LLM 任务拆解结果
 *
 * 由 CrossDomainRouter 的 decompose() 方法产出。
 */
export interface TaskDecomposition {
  /** 拆解后的子任务列表 */
  tasks: DecomposedTask[];
  /** LLM 的分析推理过程 */
  reasoning: string;
}

/**
 * DecomposedTask — 拆解后的子任务
 */
export interface DecomposedTask {
  /** 任务唯一 ID */
  id: string;
  /** 目标领域 ID */
  domain: string;
  /** 任务目标描述 */
  goal: string;
  /** 依赖的任务 ID 列表 */
  deps: string[];
  /** 期望的产物类型 */
  expected_artifacts?: string[];
}

/**
 * DAGNode — DAG 执行节点
 *
 * 由 DomainDispatcher 在执行过程中使用。
 */
export interface DAGNode {
  taskId: string;
  domain: string;
  goal: string;
  deps: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  // ── HierarchicalPlanningEngine 扩展字段 ──
  name?: string;
  agentType?: string;
  description?: string;
  priority?: number;
  requires?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 跨领域事件类型 (Phase 11)
// ═══════════════════════════════════════════════════════════════

/**
 * ArtifactRef — 资产引用
 *
 * (已上浮至 core/types.ts, 通过 re-export 保持向后兼容)
 */
export type { ArtifactRef } from '../common/types.js';

/**
 * DomainTaskCompletedEvent — 领域任务完成事件
 */
export interface DomainTaskCompletedEvent {
  type: 'domain.task_completed';
  domainId: string;
  taskId: string;
  artifacts: ArtifactRef[];
  summary?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 质询工单类型 (Phase 11.5)
// ═══════════════════════════════════════════════════════════════

export type TicketStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ARGUING' | 'ESCALATED';
export type ConflictType = 'COST_OVERRUN' | 'TECH_INFEASIBLE' | 'COMPLIANCE_RISK' | 'QUALITY_GATE' | 'SECURITY_VULN' | 'DEPENDENCY_CONFLICT';

/**
 * InterrogationTicket — 质询工单
 *
 * 领域 Master Agent 之间通过质询工单进行结构化协商。
 */
export interface InterrogationTicket {
  ticket_id: string;
  status: TicketStatus;
  source_domain: string;
  target_domain: string;
  trigger_artifact_id: string;
  conflict_type: ConflictType;
  reason: string;
  suggestion: string;
  context_snapshot: Record<string, any>;
  depth_count: number;
  artifact_hash: string;
  history: TicketRound[];
  created_at: number;
  updated_at: number;
}

export interface TicketRound {
  round: number;
  from_domain: string;
  action: 'initiate' | 'accept' | 'reject' | 'argue' | 'escalate';
  message: string;
  artifact_hash?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 跨领域路由类型 (原 router/types.ts, 已合并至此)
// ═══════════════════════════════════════════════════════════════

/**
 * RoutingAnalysis — LLM 统一返回契约 (JSON Schema)
 *
 * 通过单次 LLM 调用同时完成：
 *   1. 领域识别（单领域 vs 多领域）
 *   2. 依赖拓扑分析（多领域时）
 *   3. 宏观意图提炼
 */
export interface RoutingAnalysis {
  /** 是否是跨领域协同任务 */
  isMultiDomain: boolean;
  /** 涉及的核心领域标签，例如 ["hardware_engineering", "business_finance"] */
  involvedDomains: string[];
  /** 领域间的依赖拓扑关系（如果是多领域），指导 toposort */
  domainDependencies: {
    domain: string;
    dependsOn: string[];
  }[];
  /** 宏观意图提炼 */
  globalIntent: string;
  /** 是否需要澄清追问 — 用户请求过于模糊/vague时 LLM 设为 true */
  needsClarification?: boolean;
  /** LLM 生成的澄清问题列表 (needsClarification=true 时) */
  clarificationQuestions?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 集群状态报告
// ═══════════════════════════════════════════════════════════════

export interface ClusterStatusReport {
  domain_id: string;
  domain_name: string;
  status: ClusterStatus;
  version: string;
  uptime?: number;
  task_count?: number;
  error?: string;
}
