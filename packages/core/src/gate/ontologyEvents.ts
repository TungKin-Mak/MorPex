/**
 * ontologyEvents — Ontology 事件类型定义
 *
 * 迭代2：定义 Ontology 相关事件类型，用于 Event Sourcing 记录。
 * 事件命名空间：ontology.*
 */

import type { BaseEvent } from '../infrastructure/protocol/events/BaseEvent.js';

/**
 * Ontology 事件类型常量
 */
export const OntologyEventTypes = {
  /** 查询执行完成 */
  QueryPerformed: 'ontology.query.performed',
  /** 引用校验失败 */
  ReferenceValidationFailed: 'ontology.reference.validation_failed',
  /** 对象创建或更新 */
  ObjectUpserted: 'ontology.object.upserted',
  /** 关系创建 */
  RelationCreated: 'ontology.relation.created',
  /** 知识缺失（QueryMiss is Signal） */
  QueryMiss: 'ontology.query.miss',
} as const;

export type OntologyEventType = (typeof OntologyEventTypes)[keyof typeof OntologyEventTypes];

/**
 * OntologyQueryPerformedEvent — 查询执行事件
 */
export interface OntologyQueryPerformedEvent extends BaseEvent {
  type: 'ontology.query.performed';
  payload: {
    executionId: string;
    missionId?: string;
    toolCalls: Array<{
      name: string;
      args: unknown;
      at: number;
    }>;
    retrievedObjectIds: string[];
    timestamp: number;
  };
}

/**
 * OntologyReferenceValidationFailedEvent — 引用校验失败事件
 */
export interface OntologyReferenceValidationFailedEvent extends BaseEvent {
  type: 'ontology.reference.validation_failed';
  payload: {
    executionId: string;
    missionId?: string;
    missingIds: string[];
    referencedIds: string[];
    proposal?: unknown;
    timestamp: number;
  };
}

/**
 * createQueryPerformedEvent — 创建查询执行事件
 */
export function createQueryPerformedEvent(
  executionId: string,
  toolCalls: Array<{ name: string; args: unknown; at: number }>,
  retrievedObjectIds: string[],
  missionId?: string,
): OntologyQueryPerformedEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ontology.query.performed',
    timestamp: Date.now(),
    executionId,
    source: 'ontology',
    payload: {
      executionId,
      missionId,
      toolCalls,
      retrievedObjectIds,
      timestamp: Date.now(),
    },
  };
}

/**
 * OntologyQueryMissEvent — 知识缺失事件（QueryMiss is Signal）
 *
 * 无结果不能静默失败：
 *   - tier-0：必须人工介入（needsHumanReview=true）
 *   - tier-1：记录缺失并提示补充知识
 *   - tier-2：进入 ControlledExploration，同时驱动 Evolution
 */
export interface OntologyQueryMissEvent extends BaseEvent {
  type: 'ontology.query.miss';
  payload: {
    executionId: string;
    missionId?: string;
    tier: string;
    goal: string;
    reason: string;
    controlledExploration: boolean;
    retrievedObjectIds: string[];
    timestamp: number;
  };
}

/**
 * createQueryMissEvent — 创建知识缺失事件
 */
export function createQueryMissEvent(
  executionId: string,
  input: {
    missionId?: string;
    tier: string;
    goal: string;
    reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
    controlledExploration: boolean;
    retrievedObjectIds: string[];
  },
): OntologyQueryMissEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ontology.query.miss',
    timestamp: Date.now(),
    executionId,
    source: 'ontology',
    payload: {
      executionId,
      missionId: input.missionId,
      tier: input.tier,
      goal: input.goal,
      reason: input.reason,
      controlledExploration: input.controlledExploration,
      retrievedObjectIds: input.retrievedObjectIds,
      timestamp: Date.now(),
    },
  };
}

/**
 * createReferenceValidationFailedEvent — 创建引用校验失败事件
 */
export function createReferenceValidationFailedEvent(
  executionId: string,
  missingIds: string[],
  referencedIds: string[],
  proposal?: unknown,
  missionId?: string,
): OntologyReferenceValidationFailedEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ontology.reference.validation_failed',
    timestamp: Date.now(),
    executionId,
    source: 'ontology',
    payload: {
      executionId,
      missionId,
      missingIds,
      referencedIds,
      proposal,
      timestamp: Date.now(),
    },
  };
}
