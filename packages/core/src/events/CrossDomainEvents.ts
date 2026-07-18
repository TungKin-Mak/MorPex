/**
 * CrossDomainEvents — 跨领域事件类型定义
 *
 * Phase 11: 跨领域事件总线与资产传递
 *
 * 领域间通过事件总线异步通信，产物通过 URI 引用传递。
 * 不直接传输产物内容，只传递 ArtifactRef (URI)。
 *
 * 事件类型命名空间：
 *   cross_domain.* — 跨领域事件
 *   domain.*       — 领域生命周期事件
 *   artifact.*     — 产物生命周期事件
 */

import type { ArtifactRef, DomainTaskCompletedEvent } from '../domains/types.js';

// ═══════════════════════════════════════════════════════════════
// 领域生命周期事件
// ═══════════════════════════════════════════════════════════════

/** 领域唤醒事件 */
export interface DomainWakingEvent {
  type: 'domain.waking';
  domainId: string;
  domainName: string;
  timestamp: number;
}

/** 领域活跃事件 */
export interface DomainActiveEvent {
  type: 'domain.active';
  domainId: string;
  domainName: string;
  timestamp: number;
}

/** 领域休眠事件 */
export interface DomainSleepingEvent {
  type: 'domain.sleeping';
  domainId: string;
  domainName: string;
  timestamp: number;
}

/** 领域任务完成事件（扩展版） */
export interface DomainTaskDoneEvent {
  type: 'domain.task_completed';
  domainId: string;
  taskId: string;
  summary?: string;
  artifacts: ArtifactRef[];
  timestamp: number;
}

/** 领域错误事件 */
export interface DomainErrorEvent {
  type: 'domain.error';
  domainId: string;
  error: string;
  taskId?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 跨领域路由事件
// ═══════════════════════════════════════════════════════════════

/** DAG 创建事件 */
export interface CrossDomainDAGCreatedEvent {
  type: 'cross_domain.dag_created';
  executionId: string;
  taskCount: number;
  domains: string[];
  tasks: Array<{ id: string; domain: string; goal: string; deps: string[] }>;
  timestamp: number;
}

/** 领域间产物流转事件 */
export interface CrossDomainArtifactSharedEvent {
  type: 'cross_domain.artifact_shared';
  sourceDomain: string;
  targetDomain: string;
  artifact: ArtifactRef;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 产物生命周期事件
// ═══════════════════════════════════════════════════════════════

/** 产物创建事件 */
export interface ArtifactCreatedEvent {
  type: 'artifact.created';
  artifactId: string;
  domainId: string;
  artifactType: string;
  name: string;
  uri: string;
  timestamp: number;
}

/** 产物更新事件 */
export interface ArtifactUpdatedEvent {
  type: 'artifact.updated';
  artifactId: string;
  domainId: string;
  version: number;
  uri: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 联合事件类型
// ═══════════════════════════════════════════════════════════════

/** 所有跨领域事件的联合类型 */
export type CrossDomainEvent =
  | DomainWakingEvent
  | DomainActiveEvent
  | DomainSleepingEvent
  | DomainTaskDoneEvent
  | DomainErrorEvent
  | CrossDomainDAGCreatedEvent
  | CrossDomainArtifactSharedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent;

/** 事件类型常量 */
export const CrossDomainEventTypes = {
  // 领域生命周期
  DomainWaking: 'domain.waking',
  DomainActive: 'domain.active',
  DomainSleeping: 'domain.sleeping',
  DomainTaskCompleted: 'domain.task_completed',
  DomainError: 'domain.error',

  // 跨领域路由
  DAGCreated: 'cross_domain.dag_created',
  ArtifactShared: 'cross_domain.artifact_shared',

  // 产物生命周期
  ArtifactCreated: 'artifact.created',
  ArtifactUpdated: 'artifact.updated',
} as const;
