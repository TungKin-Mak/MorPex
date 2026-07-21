/**
 * PermissionModel — 权限模型
 *
 * Phase 7 / MorPex v8.5: 细粒度用户权限管理。
 *
 * 职责:
 *   1. 基于用户的权限集控制操作许可
 *   2. 支持按领域（domain）和工具（tool）的细粒度控制
 *   3. 支持最大风险等级控制（高于此等级的操作默认拒绝）
 *   4. 按用户管理：每个用户拥有独立的 PermissionSet
 *
 * 设计原则:
 *   - 用户中心: 权限以用户为单位，而非以角色为单位
 *   - 细粒度: 权限、领域、工具、风险四个维度
 *   - 可过期: 临时权限可设置过期时间
 *
 * 使用方式:
 *   const permModel = new PermissionModel();
 *   permModel.setPermissions('user_123', {
 *     userId: 'user_123',
 *     permissions: ['read', 'write', 'execute'],
 *     allowedDomains: ['*'],
 *     allowedTools: ['*'],
 *     maxRiskLevel: 'medium',
 *   });
 *   const check = permModel.canExecute('user_123', 'delete_file', 'production');
 *   if (!check.allowed) { denyAction(); }
 */

import type { RiskLevel } from './types.js';

// ── 权限类型 ──

export type Permission =
  | 'read'
  | 'write'
  | 'execute'
  | 'delete'
  | 'deploy'
  | 'approve'
  | 'admin'
  // ★ v9.1: Agent 维度权限
  | 'agent_collaborate'
  | 'agent_access_shared_memory'
  | 'agent_manage'
  | 'agent_evolve';

// ── PermissionSet — 用户权限集 ──

export interface PermissionSet {
  /** 用户 ID */
  userId: string;
  /** 拥有的权限列表 */
  permissions: Permission[];
  /** 允许操作的领域（'*' 表示全部） */
  allowedDomains: string[];
  /** 允许使用的工具（'*' 表示全部） */
  allowedTools: string[];
  /** 最大自动批准的风险等级（高于此等级的操作需要额外审批） */
  maxRiskLevel: RiskLevel;
  /** 权限过期时间 */
  expiresAt?: number;
}

// ── PermissionCheck — 权限检查结果 ──

export interface PermissionCheck {
  /** 是否允许 */
  allowed: boolean;
  /** 原因 */
  reason: string;
  /** 缺少的权限 */
  missingPermissions: Permission[];
}

// ── 默认用户权限 ──

export const DEFAULT_USER_PERMISSIONS: PermissionSet = {
  userId: 'default',
  permissions: ['read', 'write', 'execute'],
  allowedDomains: ['*'],
  allowedTools: ['*'],
  maxRiskLevel: 'medium',
};

// ── 风险等级数值映射 ──

const RISK_ORDER: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ═══════════════════════════════════════════════════════════════
// PermissionModel
// ═══════════════════════════════════════════════════════════════

export class PermissionModel {
  /** userId → PermissionSet */
  private permissions: Map<string, PermissionSet> = new Map();

  /**
   * setPermissions — 设置用户权限
   *
   * 覆盖该用户的完整权限集。不存在时创建。
   *
   * @param permSet - 权限集
   */
  setPermissions(permSet: PermissionSet): void {
    this.permissions.set(permSet.userId, { ...permSet });
  }

  /**
   * getPermissions — 获取用户权限集
   *
   * @param userId - 用户 ID
   * @returns PermissionSet 或默认权限
   */
  getPermissions(userId: string): PermissionSet {
    return this.permissions.get(userId) ?? { ...DEFAULT_USER_PERMISSIONS, userId };
  }

  /**
   * canExecute — 检查用户是否可以执行某项操作
   *
   * 检查维度:
   *   1. 用户是否存在（不存在时使用默认权限）
   *   2. 用户是否拥有所需的权限
   *   3. 操作领域是否在允许范围内
   *   4. 操作工具是否在允许范围内
   *   5. 操作风险不高于用户的最大允许风险等级
   *
   * @param userId - 用户 ID
   * @param action - 操作名称
   * @param domain - 操作领域
   * @param toolName - 使用的工具（可选）
   * @param riskLevel - 操作风险等级（可选）
   * @returns PermissionCheck
   */
  canExecute(
    userId: string,
    action: string,
    domain?: string,
    toolName?: string,
    riskLevel?: RiskLevel
  ): PermissionCheck {
    const permSet = this.getPermissions(userId);

    // 检查权限是否过期
    if (permSet.expiresAt && Date.now() > permSet.expiresAt) {
      return { allowed: false, reason: '权限已过期', missingPermissions: [] };
    }

    // 检查管理员权限（admin 拥有所有权限）
    if (permSet.permissions.includes('admin')) {
      return { allowed: true, reason: '管理员权限', missingPermissions: [] };
    }

    const missing: Permission[] = [];

    // 1. 检查 action 所需的权限
    const requiredPerm = this.mapActionToPermission(action);
    if (requiredPerm && !permSet.permissions.includes(requiredPerm)) {
      missing.push(requiredPerm);
    }

    // 2. 检查领域
    if (domain && !permSet.allowedDomains.includes('*')) {
      if (!permSet.allowedDomains.includes(domain)) {
        missing.push('read');
      }
    }

    // 3. 检查工具
    if (toolName && !permSet.allowedTools.includes('*')) {
      if (!permSet.allowedTools.includes(toolName)) {
        missing.push('execute');
      }
    }

    // 4. 检查风险等级
    if (riskLevel) {
      const userRiskNum = RISK_ORDER[permSet.maxRiskLevel] ?? 2;
      const actionRiskNum = RISK_ORDER[riskLevel] ?? 1;
      if (actionRiskNum > userRiskNum) {
        missing.push('read'); // 标记为受限
      }
    }

    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `缺少必要权限: ${missing.join(', ')}`,
        missingPermissions: missing,
      };
    }

    return { allowed: true, reason: '权限检查通过', missingPermissions: [] };
  }

  /**
   * hasPermission — 检查用户是否拥有特定权限
   *
   * @param userId - 用户 ID
   * @param permission - 权限
   * @returns 是否拥有
   */
  hasPermission(userId: string, permission: Permission): boolean {
    const permSet = this.getPermissions(userId);
    return permSet.permissions.includes('admin') || permSet.permissions.includes(permission);
  }

  /**
   * grantPermission — 授予权限
   *
   * @param userId - 用户 ID
   * @param permission - 权限
   */
  grantPermission(userId: string, permission: Permission): void {
    const permSet = this.getPermissions(userId);
    if (!permSet.permissions.includes(permission)) {
      permSet.permissions.push(permission);
      this.permissions.set(userId, permSet);
    }
  }

  /**
   * revokePermission — 撤销权限
   *
   * @param userId - 用户 ID
   * @param permission - 权限
   */
  revokePermission(userId: string, permission: Permission): void {
    const permSet = this.permissions.get(userId);
    if (!permSet) return;
    permSet.permissions = permSet.permissions.filter(p => p !== permission);
    this.permissions.set(userId, permSet);
  }

  /**
   * getAllowedDomains — 获取用户允许操作的领域
   *
   * @param userId - 用户 ID
   * @returns 领域列表
   */
  getAllowedDomains(userId: string): string[] {
    return this.getPermissions(userId).allowedDomains;
  }

  /**
   * getAllowedTools — 获取用户允许使用的工具
   *
   * @param userId - 用户 ID
   * @returns 工具列表
   */
  getAllowedTools(userId: string): string[] {
    return this.getPermissions(userId).allowedTools;
  }

  /**
   * cleanupExpired — 清理已过期的权限集
   *
   * @returns 清理数量
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, permSet] of this.permissions) {
      if (permSet.expiresAt && now > permSet.expiresAt) {
        this.permissions.delete(userId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * getAll — 获取所有权限集
   *
   * @returns 所有 PermissionSet 数组
   */
  getAll(): PermissionSet[] {
    return [...this.permissions.values()];
  }

  /**
   * removeUser — 移除用户的所有权限
   *
   * @param userId - 用户 ID
   */
  removeUser(userId: string): void {
    this.permissions.delete(userId);
  }

  // ── 序列化 ──

  toJSON(): PermissionSet[] {
    return [...this.permissions.values()];
  }

  static fromJSON(data: PermissionSet[]): PermissionModel {
    const model = new PermissionModel();
    for (const permSet of data) {
      model.setPermissions(permSet);
    }
    return model;
  }

  // ── 内部方法 ──

  /**
   * mapActionToPermission — 将操作名称映射到权限
   *
   * 启发式映射: 根据操作名称中的关键词推断所需权限。
   */
  private mapActionToPermission(action: string): Permission | null {
    const lower = action.toLowerCase();
    // ★ v9.1: Agent 相关操作
    if (lower.includes('agent_collaborate') || lower.includes('collaborate') || lower.includes('team')) {
      return 'agent_collaborate';
    }
    if (lower.includes('agent_share_memory') || lower.includes('shared_memory') || lower.includes('share_memory')) {
      return 'agent_access_shared_memory';
    }
    if (lower.includes('agent_manage') || lower.includes('manage_agent') || lower.includes('agent_spawn')) {
      return 'agent_manage';
    }
    if (lower.includes('agent_evolve') || lower.includes('evolve_agent') || lower.includes('agent_learn')) {
      return 'agent_evolve';
    }
    // 原有映射
    if (lower.includes('delete') || lower.includes('remove') || lower.includes('destroy')) {
      return 'delete';
    }
    if (lower.includes('deploy') || lower.includes('publish') || lower.includes('release')) {
      return 'deploy';
    }
    if (lower.includes('approve') || lower.includes('reject') || lower.includes('confirm')) {
      return 'approve';
    }
    if (lower.includes('admin') || lower.includes('config') || lower.includes('setting')) {
      return 'admin';
    }
    if (lower.includes('write') || lower.includes('create') || lower.includes('update') || lower.includes('edit')) {
      return 'write';
    }
    if (lower.includes('execute') || lower.includes('run') || lower.includes('start')) {
      return 'execute';
    }
    return 'read';
  }
}
