/**
 * gate/rules/DetectorRegistry — 领域检测器注册表（Phase 2：结构层/代码层适配器入口）
 *
 * core 内置检测器（regex/whitelist）见 detectors.ts；本注册表允许**领域插件**
 * 注入自定义检测器（如 software 的 eslint 适配器、AST 检测器），实现：
 *   - core 零领域依赖：core 只提供注册机制 + RuleDetector 接口（接口即契约）
 *   - 领域 bootstrap 时 registerDetector 注入，RuleEnforcementGuard.check 分派时回退查询
 *
 * 用法（领域插件 bootstrap）：
 *   DetectorRegistry.registerDetector('custom:no-eval', MyDetector);
 *   RuleRegistry.register('domain', { ..., ruleType: 'custom:no-eval', ... });
 */

import type { RuleDetector } from './detectors.js';

export class DetectorRegistry {
  private static detectors: Map<string, RuleDetector> = new Map();

  /**
   * registerDetector — 注册自定义检测器（同 type 覆盖，幂等）
   * @param type     对应 RuleEntity.ruleType 的自定义值（如 'custom:no-eval' / 'eslint'）
   * @param detector 实现 RuleDetector 契约的检测器
   */
  static registerDetector(type: string, detector: RuleDetector): void {
    DetectorRegistry.detectors.set(type, detector);
  }

  /** getDetector — 按类型取检测器；未注册返回 undefined */
  static getDetector(type: string): RuleDetector | undefined {
    return DetectorRegistry.detectors.get(type);
  }

  /** has — 是否已注册 */
  static has(type: string): boolean {
    return DetectorRegistry.detectors.has(type);
  }

  /** clear — 清空注册表（测试隔离用） */
  static clear(): void {
    DetectorRegistry.detectors.clear();
  }
}
