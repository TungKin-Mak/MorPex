/**
 * EventMesh — Event Mesh v10 主入口
 *
 * MorPex v10: 统一的事件网格，整合 Schema Registry、Schema Validation、Replay Engine。
 * 包装现有的 EventBus，提供 schema 验证和事件版本控制。
 *
 * 架构:
 *   EventBus (existing) ← EventMesh ← SchemaValidator ← EventRegistry
 *                                     ← ReplayEngine
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import { EventRegistry } from './event-registry.js';
import { SchemaValidator } from './schema-validator.js';
import { ReplayEngine } from './replay-engine.js';
import type { MorpexEventV10, EventMeshConfig, ValidationResult, ReplayResult, ReplayRequest } from './types.js';
import type Database from 'better-sqlite3';

// ── EventMesh ──

export class EventMesh {
  private bus: EventBus | null;
  private registry: EventRegistry;
  private validator: SchemaValidator;
  private replayEngine: ReplayEngine;
  private config: Required<EventMeshConfig>;
  private startTime: number;

  constructor(
    bus: EventBus | null,
    eventSource: () => Array<{ id: string; type: string; timestamp: number; executionId: string; source: string; payload: any }>,
    db?: Database.Database,
    config?: EventMeshConfig
  ) {
    this.bus = bus;
    this.config = {
      enableSchemaValidation: config?.enableSchemaValidation ?? true,
      autoRegisterSchema: config?.autoRegisterSchema ?? true,
      replayMaxEvents: config?.replayMaxEvents ?? 10000,
      defaultVersion: config?.defaultVersion ?? 1,
    };

    this.registry = new EventRegistry(db);
    this.validator = new SchemaValidator(this.registry);
    this.replayEngine = new ReplayEngine(bus, eventSource);
    this.startTime = Date.now();

    // 注册默认 Schema
    if (this.config.autoRegisterSchema) {
      this.registerDefaultSchemas();
    }

    console.log('[EventMesh] Initialized');
  }

  /**
   * publish — 发布事件（含 Schema 验证）
   *
   * 将 v10 格式事件转换为 EventBus 事件并发射。
   * 如果启用验证，先验证再发射。
   *
   * @param event - v10 格式事件
   * @returns 验证结果（仅当验证失败时返回，成功返回 undefined）
   */
  publish(event: MorpexEventV10): ValidationResult | undefined {
    // Schema 验证
    if (this.config.enableSchemaValidation) {
      const result = this.validator.validate(event);
      if (!result.valid) {
        console.warn(`[EventMesh] Event ${event.id} (${event.type}) failed schema validation:`, result.errors);
        return result; // 验证失败，不发射
      }
      if (result.warnings.length > 0) {
        console.warn(`[EventMesh] Event ${event.id} (${event.type}) has warnings:`, result.warnings);
      }
    }

    // 发射到 EventBus
    if (this.bus) {
      this.bus.emit({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        executionId: event.missionId || event.traceId,
        source: 'event-mesh',
        payload: {
          ...event.payload,
          _version: event.version,
          _traceId: event.traceId,
          _missionId: event.missionId,
        },
      });
    }

    return undefined; // 无错误
  }

  /**
   * getRegistry — 获取 EventRegistry 引用
   */
  getRegistry(): EventRegistry {
    return this.registry;
  }

  /**
   * getValidator — 获取 SchemaValidator 引用
   */
  getValidator(): SchemaValidator {
    return this.validator;
  }

  /**
   * getReplayEngine — 获取 ReplayEngine 引用
   */
  getReplayEngine(): ReplayEngine {
    return this.replayEngine;
  }

  /**
   * replay — 便捷重放
   */
  async replay(request: ReplayRequest): Promise<ReplayResult> {
    return this.replayEngine.replay(request);
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    uptime: number;
    elapsed: number;
    schemaCount: number;
    submodules: Record<string, { ok: boolean; name: string }>;
  } {
    const regHealth = this.registry.health();
    return {
      ok: true,
      name: 'EventMesh',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      schemaCount: regHealth.schemaCount,
      submodules: {
        'EventRegistry': { ok: regHealth.ok, name: regHealth.name },
        'SchemaValidator': { ok: true, name: 'SchemaValidator' },
        'ReplayEngine': { ok: true, name: 'ReplayEngine' },
      },
    };
  }

  // ── 私有方法 ──

  /**
   * registerDefaultSchemas — 注册内置事件 Schema
   */
  private registerDefaultSchemas(): void {
    const schemas: Array<{ type: string; schema: Record<string, unknown>; changelog: string }> = [
      {
        type: 'mission.created',
        schema: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            goal: { type: 'string' },
            owner: { type: 'string' },
            channel: { type: 'string' },
            state: { type: 'string' },
          },
          required: ['missionId', 'goal'],
        },
        changelog: 'v10 initial schema',
      },
      {
        type: 'mission.completed',
        schema: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            score: { type: 'number' },
            grade: { type: 'string' },
            duration: { type: 'number' },
          },
          required: ['missionId', 'score'],
        },
        changelog: 'v10 initial schema',
      },
      {
        type: 'execution.started',
        schema: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            stepsTotal: { type: 'number' },
          },
          required: ['missionId'],
        },
        changelog: 'v10 initial schema',
      },
      {
        type: 'plan.created',
        schema: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            steps: { type: 'array' },
            riskLevel: { type: 'string' },
            estimatedDuration: { type: 'number' },
          },
          required: ['missionId', 'steps'],
        },
        changelog: 'v10 initial schema',
      },
    ];

    for (const s of schemas) {
      this.registry.register(s.type, s.schema, { changelog: s.changelog, version: 1 });
    }

    console.log(`[EventMesh] Registered ${schemas.length} default event schemas`);
  }
}
