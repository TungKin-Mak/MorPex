/**
 * AuditTrail — 审计追踪层
 *
 * Phase 8 / MorPex v8: 不可篡改的治理决策记录。
 *
 * 职责：
 *   1. 记录所有风险分析结果
 *   2. 记录所有审批决策（approve/deny/expire）
 *   3. 记录所有执行状态变更
 *   4. 提供审计报告生成
 *   5. 支持按 Mission/类型/时间范围查询
 *
 * 设计原则：
 *   - 只追加（append-only）：已有条目不可修改或删除
 *   - 不可篡改：每条记录包含时间戳和执行者信息
 *   - 高效查询：使用 Map 索引优化按 Mission 和类型的查询
 *   - 内存优先：支持 toJSON/fromJSON 持久化
 *
 * 使用方式：
 *   const audit = new AuditTrail();
 *   audit.record({
 *     missionId: 'mis_123',
 *     type: 'approval_granted',
 *     timestamp: Date.now(),
 *     actor: 'user_456',
 *     details: { risk: 'high' },
 *   });
 *   const report = audit.generateReport(start, end);
 */

import type { AuditEntry, AuditEventType, AuditReport, RiskLevel } from './types.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './types.js';

// ── AuditTrail ──

export class AuditTrail {
  /** 所有审计条目（按 ID 索引） */
  private entries: Map<string, AuditEntry> = new Map();

  /** 按 Mission ID 索引（missionId → entry IDs） */
  private byMission: Map<string, Set<string>> = new Map();

  /** 按事件类型索引（type → entry IDs） */
  private byType: Map<string, Set<string>> = new Map();

  /** ID 计数器 */
  private counter = 0;

  /** 最大条目数 */
  private maxEntries: number;

  /**
   * @param maxEntries - 最大保留条目数（默认 10000）
   */
  constructor(maxEntries?: number) {
    this.maxEntries = maxEntries ?? DEFAULT_GOVERNANCE_CONFIG.maxAuditEntries;
  }

  // ═══════════════════════════════════════════════════════════
  // 写入
  // ═══════════════════════════════════════════════════════════

  /**
   * record — 记录一条审计条目
   *
   * 生成唯一 ID，存入所有索引。
   * 如果超过 maxEntries，最旧的条目会被移除。
   *
   * @param entry - 审计条目（不含 id）
   * @returns 完整的审计条目（含 id）
   */
  record(entry: Omit<AuditEntry, 'id'>): AuditEntry {
    const id = `audit_${Date.now()}_${++this.counter}`;
    const full: AuditEntry = { id, ...entry } as AuditEntry;

    // 存入主存储
    this.entries.set(id, full);

    // 建立 mission 索引
    if (full.missionId) {
      if (!this.byMission.has(full.missionId)) {
        this.byMission.set(full.missionId, new Set());
      }
      this.byMission.get(full.missionId)!.add(id);
    }

    // 建立 type 索引
    if (full.type) {
      if (!this.byType.has(full.type)) {
        this.byType.set(full.type, new Set());
      }
      this.byType.get(full.type)!.add(id);
    }

    // 容量控制：超出时移除最旧的条目
    if (this.maxEntries > 0 && this.entries.size > this.maxEntries) {
      this.evictOldest();
    }

    return full;
  }

  /**
   * recordRiskAssessment — 快速记录风险评估结果
   *
   * @param missionId - Mission ID
   * @param details - 评估详情
   * @returns 审计条目
   */
  recordRiskAssessment(
    missionId: string,
    details: Record<string, unknown>
  ): AuditEntry {
    return this.record({
      missionId,
      type: 'risk_assessment',
      timestamp: Date.now(),
      actor: 'system',
      details,
    });
  }

  /**
   * recordApproval — 快速记录审批决策
   *
   * @param missionId - Mission ID
   * @param decision - 'granted' | 'denied'
   * @param actor - 审批人
   * @param reason - 审批理由
   * @returns 审计条目
   */
  recordApproval(
    missionId: string,
    decision: 'granted' | 'denied',
    actor: string,
    reason?: string
  ): AuditEntry {
    return this.record({
      missionId,
      type: decision === 'granted' ? 'approval_granted' : 'approval_denied',
      timestamp: Date.now(),
      actor,
      details: { reason: reason || 'no_reason_provided' },
      previousState: 'WAIT_APPROVAL',
      newState: decision === 'granted' ? 'EXECUTING' : 'CANCELLED',
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ★ v9.1: Agent 行为审计
  // ═══════════════════════════════════════════════════════════

  /**
   * recordAgentAction — 记录 Agent 行为
   *
   * @param agentId - Agent ID
   * @param action - 行为描述
   * @param details - 详情
   * @returns 审计条目
   */
  recordAgentAction(
    agentId: string,
    action: 'agent_registered' | 'agent_deprecated' | 'agent_collaboration' | 'agent_escalated' | 'agent_governance_check',
    details: Record<string, unknown>
  ): AuditEntry {
    return this.record({
      missionId: agentId,
      type: action,
      timestamp: Date.now(),
      actor: details.actor as string ?? 'system',
      details,
    });
  }

  /**
   * recordGovernanceCheck — 记录 Agent 治理检查结果
   */
  recordGovernanceCheck(
    agentId: string,
    checkType: string,
    passed: boolean,
    actor: string,
    extra?: Record<string, unknown>
  ): AuditEntry {
    return this.recordAgentAction(agentId, 'agent_governance_check', {
      actor,
      checkType,
      passed,
      ...extra,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /**
   * query — 按条件查询审计条目
   *
   * 支持多条件组合过滤。
   *
   * @param filter - 查询条件
   * @returns 匹配的审计条目列表（按时间倒序）
   */
  query(filter: {
    missionId?: string;
    type?: AuditEventType;
    since?: number;
    until?: number;
    actor?: string;
    limit?: number;
  }): AuditEntry[] {
    let candidates = [...this.entries.values()];

    // 按 Mission 过滤（使用索引）
    if (filter.missionId) {
      const ids = this.byMission.get(filter.missionId);
      if (!ids) return [];
      candidates = [...ids].map(id => this.entries.get(id)!).filter((e): e is AuditEntry => e !== undefined);
    }

    // 按类型过滤（使用索引）
    if (filter.type) {
      const ids = this.byType.get(filter.type);
      if (!ids) return [];
      const typeFiltered = [...ids].map(id => this.entries.get(id)!).filter((e): e is AuditEntry => e !== undefined);
      // 如果同时也按 mission 过滤，取交集
      if (filter.missionId) {
        const missionIds = new Set(candidates.map((e: AuditEntry) => e.id));
        candidates = typeFiltered.filter((e: AuditEntry) => missionIds.has(e.id));
      } else {
        candidates = typeFiltered;
      }
    }

    // 时间范围过滤
    let results = candidates;
    if (filter.since !== undefined) {
      results = results.filter(e => e.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter(e => e.timestamp <= filter.until!);
    }

    // 执行者过滤
    if (filter.actor) {
      results = results.filter(e => e.actor === filter.actor);
    }

    // 按时间倒序
    results.sort((a, b) => b.timestamp - a.timestamp);

    // 限制数量
    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * getForMission — 获取指定 Mission 的所有审计条目
   *
   * @param missionId - Mission ID
   * @returns 审计条目列表（按时间倒序）
   */
  getForMission(missionId: string): AuditEntry[] {
    const ids = this.byMission.get(missionId);
    if (!ids) return [];
    return [...ids]
      .map(id => this.entries.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * getRecent — 获取最近的审计条目
   *
   * @param limit - 最大返回条数（默认 50）
   * @returns 审计条目列表
   */
  getRecent(limit: number = 50): AuditEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 报告
  // ═══════════════════════════════════════════════════════════

  /**
   * generateReport — 生成指定时间段的审计报告
   *
   * @param start - 开始时间戳
   * @param end - 结束时间戳
   * @returns AuditReport
   */
  generateReport(start: number, end: number): AuditReport {
    const periodEntries = [...this.entries.values()]
      .filter(e => e.timestamp >= start && e.timestamp <= end);

    const byType: Record<string, number> = {};
    const byMission: Record<string, number> = {};
    const riskLevels: Record<string, number> = {};
    let totalApproved = 0;
    let totalDenied = 0;
    let totalRiskScore = 0;
    let riskCount = 0;

    for (const entry of periodEntries) {
      // 按类型统计
      byType[entry.type] = (byType[entry.type] || 0) + 1;

      // 按 Mission 统计
      byMission[entry.missionId] = (byMission[entry.missionId] || 0) + 1;

      // 审批统计
      if (entry.type === 'approval_granted') totalApproved++;
      if (entry.type === 'approval_denied') totalDenied++;

      // 风险等级分布
      const details = entry.details || {};
      const riskLevel = details.riskLevel as string;
      if (riskLevel && ['none', 'low', 'medium', 'high', 'critical'].includes(riskLevel)) {
        riskLevels[riskLevel] = (riskLevels[riskLevel] || 0) + 1;
      }

      // 风险评分
      const riskScore = details.score as number;
      if (typeof riskScore === 'number') {
        totalRiskScore += riskScore;
        riskCount++;
      }
    }

    // 按条目数排序取 Top Missions
    const sortedMissions = Object.entries(byMission)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([missionId, count]) => ({ missionId, count }));

    const totalDecisions = totalApproved + totalDenied;

    return {
      period: { start, end },
      totalEntries: periodEntries.length,
      byType,
      byMission,
      riskDistribution: riskLevels as Record<RiskLevel, number>,
      approvalRate: totalDecisions > 0 ? totalApproved / totalDecisions : 1,
      averageRiskScore: riskCount > 0 ? Math.round(totalRiskScore / riskCount) : 0,
      topMissions: sortedMissions,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════

  /**
   * getStats — 获取审计统计摘要
   */
  getStats(): {
    totalEntries: number;
    uniqueMissions: number;
    byType: Record<string, number>;
    oldestEntry: number;
    newestEntry: number;
  } {
    const byType: Record<string, number> = {};
    let oldest = Infinity;
    let newest = 0;

    for (const entry of this.entries.values()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.timestamp < oldest) oldest = entry.timestamp;
      if (entry.timestamp > newest) newest = entry.timestamp;
    }

    return {
      totalEntries: this.entries.size,
      uniqueMissions: this.byMission.size,
      byType,
      oldestEntry: oldest === Infinity ? 0 : oldest,
      newestEntry: newest,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  /**
   * toJSON — 导出所有审计条目用于持久化
   */
  toJSON(): AuditEntry[] {
    return [...this.entries.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * fromJSON — 从持久化数据恢复审计条目
   *
   * @param entries - 审计条目列表
   */
  fromJSON(entries: AuditEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);

      if (entry.missionId) {
        if (!this.byMission.has(entry.missionId)) {
          this.byMission.set(entry.missionId, new Set());
        }
        this.byMission.get(entry.missionId)!.add(entry.id);
      }

      if (entry.type) {
        if (!this.byType.has(entry.type)) {
          this.byType.set(entry.type, new Set());
        }
        this.byType.get(entry.type)!.add(entry.id);
      }
    }
  }

  /**
   * clear — 清空所有审计数据（仅用于测试）
   */
  clear(): void {
    this.entries.clear();
    this.byMission.clear();
    this.byType.clear();
    this.counter = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * evictOldest — 移除最旧的条目以控制容量
   */
  private evictOldest(): void {
    const sorted = [...this.entries.entries()].sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    const toRemove = this.entries.size - this.maxEntries;
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      const [id, entry] = sorted[i];
      this.entries.delete(id);

      // 清理 mission 索引
      if (entry.missionId) {
        const missionSet = this.byMission.get(entry.missionId);
        if (missionSet) {
          missionSet.delete(id);
          if (missionSet.size === 0) this.byMission.delete(entry.missionId);
        }
      }

      // 清理 type 索引
      if (entry.type) {
        const typeSet = this.byType.get(entry.type);
        if (typeSet) {
          typeSet.delete(id);
          if (typeSet.size === 0) this.byType.delete(entry.type);
        }
      }
    }
  }
}
