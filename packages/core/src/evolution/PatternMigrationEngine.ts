/**
 * PatternMigrationEngine — 跨部门模式迁移引擎
 *
 * ⚠️ Wave 5 标注：tested capability, NOT production-wired —— 仅 evolution-closed-loop.test.ts
 *   实例化验证接线（department.created → 迁移）；无生产调用点。跨部门迁移若启用，
 *   应接入 L7 事件管线并经 EvolutionSandbox 审批晋升，勿直接落地。
 *
 * v16 Phase 4.7: 一人跨多领域虚拟公司的跨部门经验迁移能力。
 * 将一个部门验证成功的模式（工作流、工具链、SOP）适配并迁移到其他部门。
 *
 * 设计原则：
 *   - 部门隔离：迁移时自动适配目标部门的能力结构
 *   - 安全优先：低相似度部门禁止自动迁移，需人工审批
 *   - 可逆：迁移支持版本记录，可回滚
 *   - 与 CrossDepartmentKnowledgeSynthesizer 集成
 *
 * 数据流：
 *   ActiveEvolutionTrigger.fireTrigger('new_department')
 *     → PatternMigrationEngine.migrateBestPatterns()
 *         → CrossDepartmentKnowledgeSynthesizer.synthesizeAcrossDepartments()
 *         → WorkflowRegistry.registerVersion() / ToolRegistry.register()
 *         → EventBus.emit('evolution.pattern.migrated')
 *
 * @packageDocumentation
 */

import { EventBus } from '../infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../infrastructure/common/types.js';
import type { DepartmentId } from '../governance/control-plane/department-types.js';
import type { CrossDepartmentKnowledgeSynthesizer, MigrationResult } from '../cognition/index.js';

// ── Types ──

export type MigrationStatus = 'pending' | 'adapting' | 'completed' | 'failed' | 'rolled_back';

export interface PatternMigrationRecord {
  id: string;
  patternSource: string;
  fromDept: DepartmentId;
  toDept: DepartmentId;
  status: MigrationStatus;
  adaptedContent: string;
  adaptationConfidence: number;
  similarity: number;
  createdAt: number;
  completedAt: number | null;
  rolledBackAt: number | null;
  error?: string;
}

export interface MigrationTemplate {
  /** 模式来源（workflow/experience/tool/sop） */
  source: string;
  /** 模式描述 */
  description: string;
  /** 适用领域 */
  applicableDomains: string[];
  /** 迁移适配模板函数 */
  adaptFor: (targetDept: DepartmentId, sourceContent: string) => Promise<string>;
}

export interface MigrationStats {
  totalMigrations: number;
  completedMigrations: number;
  failedMigrations: number;
  rolledBackMigrations: number;
  avgConfidence: number;
  topSourceDepts: Array<{ deptId: DepartmentId; count: number }>;
  topTargetDepts: Array<{ deptId: DepartmentId; count: number }>;
}

// ── WorkflowRegistry 接口（松耦合） ──

export interface WorkflowRegistryLike {
  registerVersion(
    workflowId: string,
    version: number,
    steps: Array<{ action: string; capability: string }>,
    changeDescription: string,
  ): Promise<{ success: boolean; error?: string }>;
  getWorkflowsByDept(deptId: DepartmentId): Promise<Array<{ id: string; name: string; successRate: number }>>;
}

// ── PatternMigrationEngine ──

export class PatternMigrationEngine {
  name = 'PatternMigrationEngine';
  version = '1.0.0';

  private eventBus: EventBus;
  private synthesizer: CrossDepartmentKnowledgeSynthesizer | null = null;
  private workflowRegistry: WorkflowRegistryLike | null = null;

  /** 迁移记录 */
  private migrations: Map<string, PatternMigrationRecord> = new Map();

  /** 已注册的迁移模板 */
  private templates: Map<string, MigrationTemplate> = new Map();

  private stats: MigrationStats = {
    totalMigrations: 0,
    completedMigrations: 0,
    failedMigrations: 0,
    rolledBackMigrations: 0,
    avgConfidence: 0,
    topSourceDepts: [],
    topTargetDepts: [],
  };

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[PatternMigrationEngine] EventBus 是必填参数');
    this.eventBus = eventBus;

    // 注册默认迁移模板
    this.registerDefaultTemplates();

    // 监听新部门创建，自动启动最佳模式迁移
    this.eventBus.on('department.created', async (event: MorPexEvent) => {
      const p = event.payload;
      if (p?.departmentId) {
        console.log(`[PatternMigrationEngine] 🏗️ 新部门 ${p.departmentId} 创建，自动启动模式迁移`);
        // 异步执行，不阻塞
        setTimeout(async () => {
          try {
            await this.migrateBestPatterns(p.departmentId);
          } catch (err) {
            console.warn('[PatternMigrationEngine] 自动模式迁移失败:', (err as Error).message);
          }
        }, 5000); // 等 5 秒让部门初始化完成
      }
    });
  }

  // ── 依赖注入 ──

  setSynthesizer(synthesizer: CrossDepartmentKnowledgeSynthesizer): void {
    this.synthesizer = synthesizer;
  }

  setWorkflowRegistry(registry: WorkflowRegistryLike): void {
    this.workflowRegistry = registry;
  }

  isReady(): boolean {
    return !!this.synthesizer;
  }

  // ══════════════════════════════════════════════════════════
  // 核心方法
  // ══════════════════════════════════════════════════════════

  /**
   * migrateBestPatterns — 将最佳模式迁移到目标部门
   *
   * 从所有已注册部门中查找最高置信度的模式，
   * 自动适配并迁移到新部门。
   *
   * @param targetDept - 目标部门
   * @returns 迁移记录列表
   */
  async migrateBestPatterns(targetDept: DepartmentId): Promise<PatternMigrationRecord[]> {
    if (!this.synthesizer) {
      console.warn('[PatternMigrationEngine] ⚠️ CrossDepartmentKnowledgeSynthesizer 未注入，无法执行模式迁移');
      return [];
    }

    // 通过 synthesizer 获取可用部门的知识融合结果
    // 使用空 sourceDepts 让 synthesizer 自动发现
    const synthesisResult = await this.synthesizer.synthesizeAcrossDepartments(
      [],
      targetDept,
      '新模式迁移',
    );

    if (synthesisResult.sourceDepts.length === 0) {
      console.log(`[PatternMigrationEngine] 没有可用的源部门来迁移到 ${targetDept}`);
      return [];
    }

    const records: PatternMigrationRecord[] = [];

    // 从每个源部门迁移
    for (const sourceDept of synthesisResult.sourceDepts) {
      try {
        const migrationResult = await this.synthesizer.migratePattern(
          `auto_pattern_${sourceDept}_to_${targetDept}`,
          sourceDept,
          targetDept,
        );

        const record = this.createMigrationRecord(
          migrationResult,
          sourceDept,
          targetDept,
          synthesisResult.confidence,
        );

        records.push(record);

        // 如果迁移成功且置信度较高，注册到 WorkflowRegistry
        if (migrationResult.status !== 'failed' && this.workflowRegistry) {
          await this.tryRegisterMigration(record, sourceDept, targetDept);
        }
      } catch (err) {
        console.warn(`[PatternMigrationEngine] 从 ${sourceDept} 迁移到 ${targetDept} 失败:`, (err as Error).message);
      }
    }

    // 更新统计
    this.updateStats();

    return records;
  }

  /**
   * migratePattern — 迁移指定模式
   *
   * @param patternId - 模式 ID
   * @param fromDept - 源部门
   * @param toDept - 目标部门
   * @returns 迁移记录
   */
  async migratePattern(
    patternId: string,
    fromDept: DepartmentId,
    toDept: DepartmentId,
  ): Promise<PatternMigrationRecord> {
    if (!this.synthesizer) {
      throw new Error('[PatternMigrationEngine] CrossDepartmentKnowledgeSynthesizer 未注入');
    }

    const migrationResult = await this.synthesizer.migratePattern(patternId, fromDept, toDept);
    const record = this.createMigrationRecord(migrationResult, fromDept, toDept, migrationResult.adaptationConfidence);

    // 如果成功，尝试注册到 WorkflowRegistry
    if (migrationResult.status !== 'failed' && this.workflowRegistry) {
      await this.tryRegisterMigration(record, fromDept, toDept);
    }

    this.updateStats();
    this.emitMigrationEvent(record);

    return record;
  }

  /**
   * rollback — 回滚一次模式迁移
   *
   * @param migrationId - 迁移记录 ID
   */
  async rollback(migrationId: string): Promise<boolean> {
    const record = this.migrations.get(migrationId);
    if (!record) {
      console.warn(`[PatternMigrationEngine] 迁移记录 ${migrationId} 不存在`);
      return false;
    }

    if (record.status !== 'completed') {
      console.warn(`[PatternMigrationEngine] 迁移记录 ${migrationId} 状态为 ${record.status}，不可回滚`);
      return false;
    }

    record.status = 'rolled_back';
    record.rolledBackAt = Date.now();
    this.stats.rolledBackMigrations++;

    console.log(`[PatternMigrationEngine] ↩️ 迁移 ${migrationId} 已回滚`);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'evolution.pattern.rolled_back',
      timestamp: Date.now(),
      executionId: `rollback_${migrationId}`,
      source: 'pattern-migration-engine',
      payload: {
        migrationId,
        fromDept: record.fromDept,
        toDept: record.toDept,
        patternSource: record.patternSource,
      },
    });

    return true;
  }

  // ── 模板管理 ──

  /**
   * registerTemplate — 注册迁移模板
   */
  registerTemplate(template: MigrationTemplate): void {
    if (this.templates.has(template.source)) {
      console.warn(`[PatternMigrationEngine] 模板 "${template.source}" 已存在，覆盖注册`);
    }
    this.templates.set(template.source, template);
    console.log(`[PatternMigrationEngine] 📋 迁移模板 "${template.source}" 已注册`);
  }

  /**
   * listTemplates — 列出所有模板
   */
  listTemplates(): MigrationTemplate[] {
    return [...this.templates.values()];
  }

  // ── 查询 ──

  /**
   * getMigrations — 获取迁移记录列表
   */
  getMigrations(deptId?: DepartmentId): PatternMigrationRecord[] {
    const all = [...this.migrations.values()].sort((a, b) => b.createdAt - a.createdAt);
    if (deptId) {
      return all.filter(m => m.fromDept === deptId || m.toDept === deptId);
    }
    return all;
  }

  /**
   * getMigration — 获取单条迁移记录
   */
  getMigration(id: string): PatternMigrationRecord | undefined {
    return this.migrations.get(id);
  }

  /**
   * getStats — 获取统计信息
   */
  getStats(): MigrationStats {
    return { ...this.stats };
  }

  // ══════════════════════════════════════════════════════════
  // 内部方法
  // ══════════════════════════════════════════════════════════

  /**
   * registerDefaultTemplates — 注册默认迁移模板
   */
  private registerDefaultTemplates(): void {
    // 工作流模式模板
    this.registerTemplate({
      source: 'workflow',
      description: '工作流模式迁移模板',
      applicableDomains: ['*'],
      adaptFor: async (targetDept, sourceContent) => {
        return sourceContent.replace(/department_id:\s*['"][^'"]+['"]/g, `department_id: '${targetDept}'`);
      },
    });

    // 经验模式模板
    this.registerTemplate({
      source: 'experience',
      description: '经验模式迁移模板',
      applicableDomains: ['*'],
      adaptFor: async (targetDept, sourceContent) => {
        return `【适配到 ${targetDept}】\n${sourceContent}`;
      },
    });
  }

  /**
   * createMigrationRecord — 创建迁移记录
   */
  private createMigrationRecord(
    migrationResult: MigrationResult,
    fromDept: DepartmentId,
    toDept: DepartmentId,
    confidence: number,
  ): PatternMigrationRecord {
    const id = `migration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record: PatternMigrationRecord = {
      id,
      patternSource: migrationResult.patternId,
      fromDept,
      toDept,
      status: migrationResult.status === 'adapted' ? 'completed' :
              migrationResult.status === 'partial' ? 'completed' : 'failed',
      adaptedContent: migrationResult.adaptedContent,
      adaptationConfidence: migrationResult.adaptationConfidence,
      similarity: migrationResult.status === 'failed' ? 0 : confidence,
      createdAt: Date.now(),
      completedAt: migrationResult.status !== 'failed' ? Date.now() : null,
      rolledBackAt: null,
      error: migrationResult.failureReason,
    };

    this.migrations.set(id, record);
    this.stats.totalMigrations++;

    if (record.status === 'completed') {
      this.stats.completedMigrations++;
    } else {
      this.stats.failedMigrations++;
    }

    return record;
  }

  /**
   * tryRegisterMigration — 尝试将迁移注册到 WorkflowRegistry
   */
  private async tryRegisterMigration(
    record: PatternMigrationRecord,
    fromDept: DepartmentId,
    toDept: DepartmentId,
  ): Promise<void> {
    if (!this.workflowRegistry) return;

    try {
      await this.workflowRegistry.registerVersion(
        `migrated_${record.patternSource}_${toDept}`,
        1,
        [
          { action: `适应 ${fromDept} 模式到 ${toDept}`, capability: 'adapt' },
        ],
        `自动迁移: ${fromDept} → ${toDept} (置信度: ${(record.adaptationConfidence * 100).toFixed(0)}%)`,
      );
    } catch (err) {
      console.warn(`[PatternMigrationEngine] WorkflowRegistry 注册失败:`, (err as Error).message);
    }
  }

  /**
   * emitMigrationEvent — 发射迁移事件
   */
  private emitMigrationEvent(record: PatternMigrationRecord): void {
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'evolution.pattern.migrated',
      timestamp: Date.now(),
      executionId: `migration_${record.id}`,
      source: 'pattern-migration-engine',
      payload: {
        migrationId: record.id,
        patternSource: record.patternSource,
        fromDept: record.fromDept,
        toDept: record.toDept,
        status: record.status,
        adaptationConfidence: record.adaptationConfidence,
        error: record.error,
      },
    });
  }

  /**
   * updateStats — 更新统计信息
   */
  private updateStats(): void {
    const allMigrations = [...this.migrations.values()];
    const completedMigrations = allMigrations.filter(m => m.status === 'completed');
    const failedMigrations = allMigrations.filter(m => m.status === 'failed');

    // 部门统计
    const sourceCount = new Map<DepartmentId, number>();
    const targetCount = new Map<DepartmentId, number>();
    for (const m of completedMigrations) {
      sourceCount.set(m.fromDept, (sourceCount.get(m.fromDept) ?? 0) + 1);
      targetCount.set(m.toDept, (targetCount.get(m.toDept) ?? 0) + 1);
    }

    this.stats = {
      totalMigrations: allMigrations.length,
      completedMigrations: completedMigrations.length,
      failedMigrations: failedMigrations.length,
      rolledBackMigrations: this.stats.rolledBackMigrations,
      avgConfidence: completedMigrations.length > 0
        ? completedMigrations.reduce((s, m) => s + m.adaptationConfidence, 0) / completedMigrations.length
        : 0,
      topSourceDepts: [...sourceCount.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([deptId, count]) => ({ deptId, count })),
      topTargetDepts: [...targetCount.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([deptId, count]) => ({ deptId, count })),
    };
  }
}
