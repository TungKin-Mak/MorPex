/**
 * MigrationLayer — 事件迁移层
 *
 * MorPex v10: 处理事件 Schema 版本迁移。
 * 定义迁移步骤，将旧版本事件转换为新版本。
 */

import type { MigrationStep, MigrationResult } from './types.js';

// ── MigrationLayer ──

export class MigrationLayer {
  private migrations: Map<string, MigrationStep[]> = new Map();

  constructor() {
    // 注册默认迁移
    this.registerDefaultMigrations();
  }

  /**
   * registerMigration — 注册迁移步骤
   */
  registerMigration(type: string, step: MigrationStep): void {
    if (!this.migrations.has(type)) {
      this.migrations.set(type, []);
    }
    this.migrations.get(type)!.push(step);
    this.migrations.get(type)!.sort((a, b) => a.fromVersion - b.fromVersion);
  }

  /**
   * migrate — 迁移事件到指定版本
   *
   * @param event - 原始事件
   * @param targetVersion - 目标版本
   * @returns 迁移后的事件
   */
  migrate(event: any, targetVersion: number): any {
    const eventType = event.type;
    const currentVersion = event.version ?? 1;
    const steps = this.migrations.get(eventType) ?? [];

    if (currentVersion >= targetVersion || steps.length === 0) {
      return event; // 无需迁移
    }

    let result = { ...event };
    let changed = false;
    for (const step of steps) {
      if (step.fromVersion >= currentVersion && step.toVersion <= targetVersion) {
        try {
          result = step.migrate(result);
          result.version = step.toVersion;
          changed = true;
        } catch (err: any) {
          console.error(`[MigrationLayer] Migration failed for ${eventType} v${step.fromVersion}→v${step.toVersion}:`, err.message);
          throw err;
        }
      }
    }

    return changed ? result : event;
  }

  /**
   * migrateBatch — 批量迁移
   */
  migrateBatch(events: any[], targetVersion: number): MigrationResult {
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const startTime = Date.now();

    for (const event of events) {
      try {
        const originalVersion = event.version ?? 1;
        const result = this.migrate(event, targetVersion);
        const resultVersion = result.version ?? 1;
        if (resultVersion > originalVersion) migrated++;
        else skipped++;
      } catch {
        failed++;
      }
    }

    return {
      migrated,
      skipped,
      failed,
      duration: Date.now() - startTime,
    };
  }

  /**
   * getAvailableMigrations — 获取某类型的所有可用迁移
   */
  getAvailableMigrations(type: string): MigrationStep[] {
    return this.migrations.get(type) ?? [];
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number; registeredMigrations: number } {
    let count = 0;
    for (const steps of this.migrations.values()) {
      count += steps.length;
    }
    return {
      ok: true,
      name: 'MigrationLayer',
      uptime: Date.now(),
      registeredMigrations: count,
    };
  }

  // ── 私有方法 ──

  private registerDefaultMigrations(): void {
    // 示例：mission.created v1 → v2（添加新字段）
    this.registerMigration('mission.created', {
      fromVersion: 1,
      toVersion: 2,
      description: 'Add mission metadata field',
      migrate: (event: any) => ({
        ...event,
        payload: {
          ...event.payload,
          metadata: event.payload.metadata ?? {},
        },
      }),
    });

    // execution.started v1 → v2
    this.registerMigration('execution.started', {
      fromVersion: 1,
      toVersion: 2,
      description: 'Add execution context',
      migrate: (event: any) => ({
        ...event,
        payload: {
          ...event.payload,
          context: event.payload.context ?? {},
        },
      }),
    });
  }
}
