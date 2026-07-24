/**
 * DepartmentContext — 部门上下文分区工具
 *
 * Phase 0 / 数据隔离基础设施
 * 提供 departmentId 分区工具，用于 Memory/Knowledge/Artifact 的数据隔离。
 *
 * 分区策略：
 *   - 每个部门的数据存储为 "dept:{departmentId}" 分区
 *   - CEO 全局视图为 "global" 分区（只读）
 *   - 现有历史数据标记为 "legacy" 分区
 *
 * 使用方式：
 *   import { DepartmentContext } from './department/DepartmentContext.js';
 *
 *   // 获取分区键
 *   const partition = DepartmentContext.partitionKey(deptId);
 *
 *   // 构建隔离的存储键
 *   const artifactKey = DepartmentContext.compositeKey('art_xxx', deptId);
 */

import type { DepartmentId } from './types.js';

export class DepartmentContext {
  private static readonly GLOBAL_DEPT = 'global';
  private static readonly LEGACY_DEPT = 'legacy';

  /**
   * partitionKey — 获取数据分区的 key
   *
   * @param departmentId - 部门 ID，不传或传空返回 'global'
   * @returns 分区键字符串
   *
   * 示例：
   *   DepartmentContext.partitionKey()            → 'global'
   *   DepartmentContext.partitionKey('dept_abc')  → 'dept:dept_abc'
   */
  static partitionKey(departmentId?: DepartmentId): string {
    if (!departmentId) return this.GLOBAL_DEPT;
    return `dept:${departmentId}`;
  }

  /**
   * compositeKey — 构建带 departmentId 的复合存储键
   *
   * 用于存储层隔离（如 artifact ID、session ID 前加 dept 前缀）
   * legacy 数据不加前缀以保持向后兼容
   *
   * @param originalKey - 原始键
   * @param departmentId - 部门 ID
   * @returns 复合键
   */
  static compositeKey(originalKey: string, departmentId?: DepartmentId): string {
    if (!departmentId || departmentId === this.LEGACY_DEPT) return originalKey;
    return `${departmentId}:${originalKey}`;
  }

  /**
   * legacyDepartmentId — 获取 legacy 部门 ID
   *
   * 用于现有数据的迁移标记。
   * 迁移后的 legacy 数据可被 CEO 全局访问。
   */
  static legacyDepartmentId(): string {
    return this.LEGACY_DEPT;
  }

  /**
   * isGlobal — 判断是否为全局访问
   */
  static isGlobal(departmentId?: DepartmentId): boolean {
    return !departmentId || departmentId === this.GLOBAL_DEPT;
  }

  /**
   * parseCompositeKey — 解析复合键
   *
   * @param compositeKey - 复合键（如 "dept_abc:art_xxx"）
   * @returns [departmentId, originalKey] 或 [undefined, originalKey]
   */
  static parseCompositeKey(compositeKey: string): [DepartmentId | undefined, string] {
    const colonIndex = compositeKey.indexOf(':');
    if (colonIndex === -1) return [undefined, compositeKey];
    const prefix = compositeKey.slice(0, colonIndex);
    const rest = compositeKey.slice(colonIndex + 1);
    // 如果前缀是 'global' 或 'legacy'，视为无部门
    if (prefix === this.GLOBAL_DEPT || prefix === this.LEGACY_DEPT) {
      return [undefined, rest];
    }
    return [prefix, rest];
  }
}
