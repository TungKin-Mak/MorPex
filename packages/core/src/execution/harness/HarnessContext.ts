import type { MemoryRecord, ArtifactRef, Experience } from './types.js';

/** 用户意图的结构化表示 */
export interface IntentContext {
  goal: string;
  constraints: string[];
  priority: number; // 1 (highest) - 10 (lowest)
  risk: string[];
}

/** 当前执行的计划 */
export interface PlanContext {
  planId: string;
  dag: any;
  currentPhase: string;
  progress: number; // 0.0 - 1.0
}

/** 注入的相关记忆 */
export interface MemoryContext {
  relevantMemories: MemoryRecord[];
  contextBias: string;
  activationScore: number;
}

/** 可用的产物引用 */
export interface ArtifactContext {
  availableArtifacts: ArtifactRef[];
  currentArtifact: string | null;
}

/** 执行状态快照 */
export interface ExecutionState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  step: number;
  attempt: number;
  startedAt: number;
}

/** 权限拦截信息 */
export interface PermissionContext {
  requiredPermissions: string[];
  granted: boolean;
  restrictions: string[];
}

/** 历史经验检索结果 */
export interface ExperienceContext {
  similarExperiences: Experience[];
  patterns: string[];
  recommendations: string[];
}

/** Agent Harness 上下文聚合 */
export interface HarnessContext {
  intent: IntentContext;
  plan: PlanContext;
  memory: MemoryContext;
  artifact: ArtifactContext;
  executionState: ExecutionState;
  permission: PermissionContext;
  experience: ExperienceContext;

  /** 元数据 */
  createdAt: number;
  updatedAt: number;
}
