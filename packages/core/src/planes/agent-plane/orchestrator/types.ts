/**
 * Agent Orchestration — 类型定义
 *
 * 层级结构：CEO → Manager → Worker
 */

// ── Agent 角色 ──

/** Agent 角色 */
export type AgentRole = 'ceo' | 'manager' | 'worker';

/** Worker 专长 */
export type WorkerSpecialty = 'coder' | 'reviewer' | 'tester' | 'designer' | 'researcher' | 'writer' | 'devops';

// ── Agent ──

/** Agent 实例 */
export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  specialty?: WorkerSpecialty;
  status: AgentStatus;
  /** 当前负责的任务 ID */
  currentTaskId?: string;
  /** 完成的任务数 */
  completedTasks: number;
  /** 成功率 */
  successRate: number;
  /** 创建时间 */
  createdAt: number;
}

/** Agent 状态 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error';

// ── 任务分配 ──

/** 任务分配记录 */
export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: number;
  status: 'assigned' | 'in_progress' | 'completed' | 'failed';
  completedAt?: number;
  result?: any;
}

// ── 编排状态 ──

/** 编排状态 */
export interface OrchestrationStatus {
  ceo: Agent | null;
  managers: Agent[];
  workers: Agent[];
  activeAssignments: TaskAssignment[];
  totalTasks: number;
  completedTasks: number;
}

import type { AgentTool } from '../../../adapters/pi-types.js';

// ── 功能区配置（Phase 6: AgentService + AgentHarness）──

/**
 * ZoneConfig — 功能区配置
 *
 * 每个功能区（chat/coder/analyst）包含独立 tools、model、systemPrompt。
 * 由 AgentOrchestrator.dispatch() 按功能区调度。
 */
export interface ZoneConfig {
  /** 功能区名称 */
  name: string;
  /** 该功能区可用的工具集 */
  tools: AgentTool[];
  /** 模型 ID */
  modelId: string;
  /** 系统提示词 */
  systemPrompt: string;
}

// ── 配置 ──

export interface OrchestratorConfig {
  /** 默认 Worker 数量 */
  defaultWorkerCount?: number;
  /** Worker 专长列表 */
  specialties?: WorkerSpecialty[];
  /** 功能区配置（Phase 6） */
  zones?: ZoneConfig[];
}
