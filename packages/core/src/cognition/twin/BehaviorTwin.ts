/**
 * BehaviorTwin v2 — 用户行为模式学习引擎（含版本化）
 *
 * MorPex v8.6: 从交互历史中学习用户行为模式，
 * 输出 BehaviorProfile 供 Planner 约束生成风格匹配的方案。
 *
 * ★ v8.6 新增：版本化支持。每次 buildProfile 调用都会创建一个
 *   版本快照，可通过 getVersion/getVersionHistory/diffVersions 回溯。
 *
 * 学习维度:
 *   - planningStyle:       规划风格（自上而下/架构优先/原型优先）
 *   - riskTolerance:       风险偏好（从接受/拒绝比例推断）
 *   - workHours:           工作时段（从活动时间聚类）
 *   - reviewHabit:         审查习惯（每步/里程碑/仅终审）
 *   - taskDecomposition:   任务拆解粒度（粗/中/细）
 *   - collaborationStyle:  协作偏好（独立/协作/委派）
 *
 * 数据来源:
 *   - MissionRuntime 执行历史（recordMission）
 *   - ApprovalEngine 审批记录（recordApproval）
 *   - 系统交互时间戳（recordActivity）
 */

import type { Mission, MissionResult, MissionPlan } from '../../runtime/mission/types.js';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface BehaviorProfile {
  /** 用户 ID */
  userId: string;

  /** ★ v8.6: 画像版本号（每次 buildProfile 递增） */
  version: number;

  /** ★ v8.6: 该版本创建时间戳 */
  createdAt: number;

  /** ★ v8.6: 生成该版本时参考的源事件 ID 列表 */
  sourceEvents?: string[];

  /** 规划风格 */
  planningStyle: 'top-down' | 'bottom-up' | 'architecture-first' | 'prototype-first' | 'mixed';

  /** 风险偏好 */
  riskTolerance: 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high';

  /** 工作时段 */
  workHours: {
    startHour: number;   // 0-23
    endHour: number;     // 0-23
    timezone?: string;
  };

  /** 审查习惯 */
  reviewHabit: 'per-step' | 'milestone' | 'end-only' | 'none';

  /** 任务拆解粒度 */
  taskDecomposition: 'fine-grained' | 'moderate' | 'coarse';

  /** 偏好的 Agent 类型 */
  preferredAgentTypes: string[];

  /** 偏好的领域 */
  preferredDomains: string[];

  /** 平均 Mission 执行时长（ms） */
  averageMissionDuration: number;

  /** 协作偏好 */
  collaborationStyle: 'solo' | 'collaborative' | 'delegator';

  /** 画像置信度 */
  confidence: number;

  /** 最后更新时间 */
  lastUpdated: number;

  /** 证据数量 */
  evidenceCount: number;
}

/** 内部观察记录 */
interface BehaviorObservation {
  type: 'mission_completed' | 'approval' | 'activity' | 'review';
  timestamp: number;
  data: Record<string, unknown>;
}

/** 版本历史条目（轻量，不含完整 profile） */
export interface VersionHistoryEntry {
  version: number;
  createdAt: number;
  confidence: number;
  eventCount: number;
  planningStyle: string;
  riskTolerance: string;
  taskDecomposition: string;
}

/**
 * TwinVersion — v8.7 Git-like 版本快照
 *
 * 每个版本都是一个完整的 TwinVersion，包含:
 *   - snapshot: 当时的完整 BehaviorProfile
 *   - parentVersion: 指向父版本（Git 式版本链）
 *   - sourceEvents: 触发该版本变更的事件 ID
 *   - changeDescription: 人类可读的变更摘要
 */
export interface TwinVersion {
  /** 单调递增版本号 */
  version: number;
  /** 该版本的完整画像快照 */
  snapshot: BehaviorProfile;
  /** 父版本号 (0 = 初始版本) */
  parentVersion: number;
  /** 触发此版本的事件 ID 列表 */
  sourceEvents: string[];
  /** 画像置信度 (0-1) */
  confidence: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 人类可读的变更摘要 */
  changeDescription?: string;
}

// ═══════════════════════════════════════════════════════════════
// BehaviorTwin v2
// ═══════════════════════════════════════════════════════════════

export class BehaviorTwin {
  private observations: BehaviorObservation[] = [];
  private userId: string;

  /** ★ v8.6: 版本计数器，每次 buildProfile 递增 */
  private version: number = 0;

  /** ★ v8.6: 首次创建时间 */
  private createdAt: number = Date.now();

  /** ★ v8.7: 版本历史（version → TwinVersion 快照） */
  private versionHistory: Map<number, TwinVersion> = new Map();

  /** ★ v8.6: 源事件 ID 追踪 */
  private sourceEvents: string[] = [];

  constructor(userId: string = 'default') {
    this.userId = userId;
  }

  /**
   * recordMission — 从 Mission 执行记录学习行为模式
   *
   * 推断依据:
   *   - 步骤数 ≤ 3 → top-down
   *   - 步骤数 ≤ 6 → moderate
   *   - 步骤数 > 6 → fine-grained
   *   - 并行 deps 多 → architecture-first
   *   - 顺序 deps 多 → prototype-first
   *
   * @param mission - 完成的 Mission
   * @param result - 执行结果
   * @param plan - 执行计划（可选）
   */
  recordMission(mission: Mission, result: MissionResult, plan?: MissionPlan): void {
    this.observations.push({
      type: 'mission_completed',
      timestamp: Date.now(),
      data: {
        missionId: mission.id,
        goal: mission.goal,
        duration: result.duration,
        stepsTotal: result.stepsTotal,
        stepsCompleted: result.stepsCompleted,
        success: result.state === 'COMPLETED',
        plan: plan ? {
          stepCount: plan.steps.length,
          stepNames: plan.steps.map(s => s.name),
          dependencies: plan.steps.flatMap(s => s.deps),
          riskLevel: plan.riskLevel,
        } : undefined,
      },
    });
  }

  /**
   * recordApproval — 记录审批行为（推断风险偏好和审查习惯）
   *
   * @param approved - 是否批准
   * @param responseTimeMs - 响应时间（ms）
   */
  recordApproval(approved: boolean, responseTimeMs: number): void {
    this.observations.push({
      type: 'approval',
      timestamp: Date.now(),
      data: {
        approved,
        responseTimeMs,
        immediate: responseTimeMs < 60_000, // <1min = skim
        thoughtful: responseTimeMs > 300_000, // >5min = careful review
      },
    });
  }

  /**
   * recordActivity — 记录系统交互时间（用于推断工作时段）
   *
   * @param timestamp - 活动时间戳（默认当前时间）
   */
  recordActivity(timestamp: number = Date.now()): void {
    this.observations.push({
      type: 'activity',
      timestamp,
      data: {
        hour: new Date(timestamp).getHours(),
        dayOfWeek: new Date(timestamp).getDay(),
      },
    });
  }

  /**
   * ★ v8.6: recordSourceEvent — 记录源事件 ID
   *
   * 追踪哪些事件导致了画像变化。
   *
   * @param eventId - 事件 ID
   */
  recordSourceEvent(eventId: string): void {
    this.sourceEvents.push(eventId);
  }

  /**
   * buildProfile — 从所有观察记录构建行为画像
   *
   * ★ v8.6: 每次调用递增版本号，创建版本快照存入 versionHistory。
   *
   * 对所有观察进行聚合分析，输出综合 BehaviorProfile。
   * 置信度 = min(1, evidenceCount / 20) — 至少 20 次观察达到充分置信。
   */
  buildProfile(): BehaviorProfile {
    const missionObs = this.observations.filter(o => o.type === 'mission_completed');
    const approvalObs = this.observations.filter(o => o.type === 'approval');
    const activityObs = this.observations.filter(o => o.type === 'activity');

    const planningStyle = this.inferPlanningStyle(missionObs);
    const riskTolerance = this.inferRiskTolerance(approvalObs, missionObs);
    const workHours = this.inferWorkHours(activityObs);
    const reviewHabit = this.inferReviewHabit(approvalObs);
    const taskDecomposition = this.inferTaskDecomposition(missionObs);
    const collaborationStyle = this.inferCollaborationStyle(approvalObs);

    const durations = missionObs
      .map(o => (o.data as any).duration as number)
      .filter((d): d is number => d != null && d > 0);

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const agentTypes = this.collectPreferredAgentTypes(missionObs);
    const domains = this.collectPreferredDomains(missionObs);

    const evidenceCount = this.observations.length;
    const confidence = Math.min(1, evidenceCount / 20);

    // ★ v8.7: 递增版本号并创建 TwinVersion 快照
    this.version++;
    const now = Date.now();

    const profile: BehaviorProfile = {
      userId: this.userId,
      version: this.version,
      createdAt: now,
      sourceEvents: [...this.sourceEvents],
      planningStyle,
      riskTolerance,
      workHours,
      reviewHabit,
      taskDecomposition,
      preferredAgentTypes: agentTypes,
      preferredDomains: domains,
      averageMissionDuration: avgDuration,
      collaborationStyle,
      confidence,
      lastUpdated: now,
      evidenceCount,
    };

    // 生成变更摘要
    const prevVersion = this.version > 1
      ? this.versionHistory.get(this.version - 1)
      : undefined;
    const changeDesc = prevVersion
      ? this.diffVersions(prevVersion.version, this.version).join('; ')
      : '初始版本';

    // ★ v8.7: 创建 TwinVersion 快照（含 parentVersion 指针）
    const twinVersion: TwinVersion = {
      version: this.version,
      snapshot: profile,
      parentVersion: this.version > 1 ? this.version - 1 : 0,
      sourceEvents: [...this.sourceEvents],
      confidence,
      createdAt: now,
      changeDescription: changeDesc || '无显著变化',
    };

    this.versionHistory.set(this.version, twinVersion);

    return profile;
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ v8.6 版本管理 API
  // ═══════════════════════════════════════════════════════════════

  /**
   * getVersion — 获取指定版本的 BehaviorProfile
   *
   * @param version - 版本号
   * @returns BehaviorProfile | undefined（版本不存在时返回 undefined）
   */
  getVersion(version: number): BehaviorProfile | undefined {
    const tv = this.versionHistory.get(version);
    return tv?.snapshot;
  }

  /**
   * getVersionHistory — 获取轻量版本历史摘要
   *
   * 返回 TwinVersion 摘要列表（不含完整 profile），便于快速浏览。
   *
   * @returns VersionHistoryEntry[] 按版本号降序排列
   */
  getVersionHistory(): VersionHistoryEntry[] {
    const versions: VersionHistoryEntry[] = [];
    for (const [, tv] of this.versionHistory) {
      versions.push({
        version: tv.version,
        createdAt: tv.createdAt,
        confidence: tv.confidence,
        eventCount: tv.sourceEvents.length,
        planningStyle: tv.snapshot.planningStyle,
        riskTolerance: tv.snapshot.riskTolerance,
        taskDecomposition: tv.snapshot.taskDecomposition,
      });
    }
    return versions.sort((a, b) => b.version - a.version);
  }

  /**
   * getTwinVersion — 获取指定版本的完整 TwinVersion 快照
   *
   * @param version - 版本号
   * @returns TwinVersion | undefined
   */
  getTwinVersion(version: number): TwinVersion | undefined {
    return this.versionHistory.get(version);
  }

  /**
   * getCurrentVersion — 获取当前版本号
   */
  getCurrentVersion(): number {
    return this.version;
  }

  /**
   * rollback — 回滚到指定版本
   *
   * 创建一个新版本，其 snapshot 复制自 targetVersion，
   * parentVersion 指向 targetVersion。不修改历史版本。
   *
   * @param targetVersion - 目标回滚版本号
   * @returns 新版本的 BehaviorProfile，失败返回 null
   */
  rollback(targetVersion: number): BehaviorProfile | null {
    const target = this.versionHistory.get(targetVersion);
    if (!target) return null;

    // 创建新版本（复制 target 的 snapshot）
    this.version++;
    const now = Date.now();
    const restoredProfile: BehaviorProfile = {
      ...target.snapshot,
      version: this.version,
      createdAt: now,
      sourceEvents: [...this.sourceEvents, `rollback_from_v${this.version - 1}_to_v${targetVersion}`],
      lastUpdated: now,
    };

    const twinVersion: TwinVersion = {
      version: this.version,
      snapshot: restoredProfile,
      parentVersion: targetVersion,
      sourceEvents: restoredProfile.sourceEvents || [],
      confidence: target.confidence,
      createdAt: now,
      changeDescription: `ROLLBACK: v${this.version - 1} → v${targetVersion} (恢复版本 ${targetVersion})`,
    };

    this.versionHistory.set(this.version, twinVersion);
    return restoredProfile;
  }

  /**
   * getVersionChain — 获取从根版本到当前版本的完整版本链
   *
   * 类似 git log：从当前版本回溯到初始版本。
   *
   * @returns TwinVersion[] 从当前版本到初始版本（降序）
   */
  getVersionChain(): TwinVersion[] {
    const chain: TwinVersion[] = [];
    let current = this.versionHistory.get(this.version);
    while (current) {
      chain.push(current);
      current = current.parentVersion > 0
        ? this.versionHistory.get(current.parentVersion)
        : undefined;
    }
    return chain;
  }

  /**
   * getVersionAt — 查找指定时间戳时生效的版本
   *
   * 返回在该时间戳最新已创建的版本（不晚于 timestamp）。
   *
   * @param timestamp - 目标时间戳
   * @returns TwinVersion | undefined
   */
  getVersionAt(timestamp: number): TwinVersion | undefined {
    let best: TwinVersion | undefined;
    for (const [, tv] of this.versionHistory) {
      if (tv.createdAt <= timestamp) {
        if (!best || tv.createdAt > best.createdAt) {
          best = tv;
        }
      }
    }
    return best;
  }

  /**
   * fork — 从当前版本分叉创建一个实验性孪生
   *
   * 返回一个新的 BehaviorTwin 实例，其版本继承自当前版本。
   * 实验结束后可合并回主孪生。
   *
   * @param experimentName - 实验名称
   * @returns BehaviorTwin 新实例
   */
  fork(experimentName: string): BehaviorTwin {
    const currentTwin = this.versionHistory.get(this.version);
    const forkTwin = new BehaviorTwin(this.userId + '_exp_' + experimentName);

    if (currentTwin) {
      // 复制当前版本的观察记录
      forkTwin.observations = [...this.observations];
      forkTwin.sourceEvents = [...this.sourceEvents, `fork_${experimentName}`];

      // 创建 fork 的初始版本（parentVersion 指向当前版本）
      forkTwin.version = 1;
      const forkProfile: BehaviorProfile = {
        ...currentTwin.snapshot,
        version: 1,
        sourceEvents: forkTwin.sourceEvents,
        lastUpdated: Date.now(),
      };

      const forkVersion: TwinVersion = {
        version: 1,
        snapshot: forkProfile,
        parentVersion: this.version,
        sourceEvents: forkTwin.sourceEvents,
        confidence: currentTwin.confidence,
        createdAt: Date.now(),
        changeDescription: `FORK: ${experimentName} (基于 v${this.version})`,
      };

      forkTwin.versionHistory.set(1, forkVersion);
    }

    return forkTwin;
  }

  /**
   * compare — 比较任意两个版本（别名，方便语义调用）
   *
   * @param v1 - 旧版本号
   * @param v2 - 新版本号
   * @returns 变化描述列表
   */
  compare(v1: number, v2: number): string[] {
    return this.diffVersions(v1, v2);
  }

  /**
   * diffVersions — 比较两个版本的差异
   *
   * 返回人类可读的变化描述列表。仅报告有变化的字段。
   *
   * @param v1 - 旧版本号
   * @param v2 - 新版本号
   * @returns 变化描述列表（无变化时返回空数组）
   */
  diffVersions(v1: number, v2: number): string[] {
    const tvA = this.versionHistory.get(v1);
    const tvB = this.versionHistory.get(v2);
    const profileA = tvA?.snapshot;
    const profileB = tvB?.snapshot;

    if (!profileA || !profileB) {
      return [`版本 ${v1} 或 ${v2} 不存在`];
    }

    const changes: string[] = [];

    // 结构型字段
    if (profileA.planningStyle !== profileB.planningStyle) {
      changes.push(`planningStyle: ${profileA.planningStyle} → ${profileB.planningStyle}`);
    }
    if (profileA.riskTolerance !== profileB.riskTolerance) {
      changes.push(`riskTolerance: ${profileA.riskTolerance} → ${profileB.riskTolerance}`);
    }
    if (profileA.reviewHabit !== profileB.reviewHabit) {
      changes.push(`reviewHabit: ${profileA.reviewHabit} → ${profileB.reviewHabit}`);
    }
    if (profileA.taskDecomposition !== profileB.taskDecomposition) {
      changes.push(`taskDecomposition: ${profileA.taskDecomposition} → ${profileB.taskDecomposition}`);
    }
    if (profileA.collaborationStyle !== profileB.collaborationStyle) {
      changes.push(`collaborationStyle: ${profileA.collaborationStyle} → ${profileB.collaborationStyle}`);
    }

    // 数值型字段
    if (profileA.confidence !== profileB.confidence) {
      changes.push(`confidence: ${profileA.confidence.toFixed(2)} → ${profileB.confidence.toFixed(2)}`);
    }
    if (profileA.evidenceCount !== profileB.evidenceCount) {
      changes.push(`evidenceCount: ${profileA.evidenceCount} → ${profileB.evidenceCount}`);
    }
    if (profileA.averageMissionDuration !== profileB.averageMissionDuration) {
      const oldSec = Math.round(profileA.averageMissionDuration / 1000);
      const newSec = Math.round(profileB.averageMissionDuration / 1000);
      changes.push(`averageMissionDuration: ${oldSec}s → ${newSec}s`);
    }

    // 数组型字段
    if (JSON.stringify(profileA.preferredAgentTypes) !== JSON.stringify(profileB.preferredAgentTypes)) {
      changes.push(`preferredAgentTypes: [${profileA.preferredAgentTypes}] → [${profileB.preferredAgentTypes}]`);
    }
    if (JSON.stringify(profileA.preferredDomains) !== JSON.stringify(profileB.preferredDomains)) {
      changes.push(`preferredDomains: [${profileA.preferredDomains}] → [${profileB.preferredDomains}]`);
    }

    // 工作时段
    if (profileA.workHours.startHour !== profileB.workHours.startHour ||
        profileA.workHours.endHour !== profileB.workHours.endHour) {
      changes.push(`workHours: ${profileA.workHours.startHour}:00-${profileA.workHours.endHour}:00 → ${profileB.workHours.startHour}:00-${profileB.workHours.endHour}:00`);
    }

    return changes;
  }

  /**
   * getCreationTimestamp — 获取孪生首次创建时间
   */
  getCreationTimestamp(): number {
    return this.createdAt;
  }

  /**
   * getSourceEvents — 获取记录的所有源事件 ID
   */
  getSourceEvents(): string[] {
    return [...this.sourceEvents];
  }



  /**
   * getPlanningStyle — 快速获取规划风格
   */
  getPlanningStyle(): BehaviorProfile['planningStyle'] {
    return this.inferPlanningStyle(
      this.observations.filter(o => o.type === 'mission_completed')
    );
  }

  /**
   * getRiskTolerance — 快速获取风险偏好
   */
  getRiskTolerance(): BehaviorProfile['riskTolerance'] {
    return this.inferRiskTolerance(
      this.observations.filter(o => o.type === 'approval'),
      this.observations.filter(o => o.type === 'mission_completed')
    );
  }

  // ═══════════════════════════════════════════════════════════
  // 推断算法（私有）
  // ═══════════════════════════════════════════════════════════

  private inferPlanningStyle(observations: BehaviorObservation[]): BehaviorProfile['planningStyle'] {
    if (observations.length === 0) return 'top-down'; // default

    let architectureCount = 0;
    let prototypeCount = 0;
    let topDownCount = 0;

    for (const obs of observations) {
      const plan = (obs.data as any).plan;
      if (!plan) continue;

      const deps = (plan.dependencies as string[]) || [];
      const stepCount = (plan.stepCount as number) || 0;

      if (deps.length > stepCount * 1.5) {
        architectureCount++; // many parallel deps = architecture-first
      } else if (deps.length < stepCount * 0.5 && stepCount > 3) {
        prototypeCount++; // few deps = prototype-first
      } else if (stepCount <= 3) {
        topDownCount++; // few steps = top-down
      }
    }

    const max = Math.max(architectureCount, prototypeCount, topDownCount);
    if (max === 0) return 'mixed';
    if (max === architectureCount) return 'architecture-first';
    if (max === prototypeCount) return 'prototype-first';
    if (max === topDownCount) return 'top-down';
    return 'mixed';
  }

  private inferRiskTolerance(
    approvalObs: BehaviorObservation[],
    missionObs: BehaviorObservation[]
  ): BehaviorProfile['riskTolerance'] {
    if (approvalObs.length === 0 && missionObs.length === 0) return 'medium'; // default

    // From approvals: approved/(approved+denied) ratio
    const approved = approvalObs.filter(o => (o.data as any).approved === true).length;
    const denied = approvalObs.filter(o => (o.data as any).approved === false).length;
    const totalDecisions = approved + denied;

    if (totalDecisions > 0) {
      const approvalRate = approved / totalDecisions;
      if (approvalRate >= 0.9) return 'high';
      if (approvalRate >= 0.7) return 'medium-high';
      if (approvalRate >= 0.4) return 'medium';
      if (approvalRate >= 0.2) return 'medium-low';
      return 'low';
    }

    // From missions: accepted risk levels
    const highRiskMissions = missionObs.filter(
      o => (o.data as any).plan?.riskLevel === 'high'
    ).length;
    const totalMissions = missionObs.length;

    if (totalMissions > 0) {
      const highRiskRatio = highRiskMissions / totalMissions;
      if (highRiskRatio >= 0.5) return 'high';
      if (highRiskRatio >= 0.3) return 'medium-high';
      return 'medium';
    }
    return 'medium';
  }

  private inferWorkHours(observations: BehaviorObservation[]): { startHour: number; endHour: number; timezone?: string } {
    if (observations.length === 0) {
      return { startHour: 9, endHour: 18 }; // default
    }

    const hours = observations
      .map(o => (o.data as any).hour as number)
      .filter(h => h != null)
      .sort((a, b) => a - b);

    if (hours.length === 0) return { startHour: 9, endHour: 18 };

    // Find the 10th and 90th percentile for active hours
    const p10Index = Math.floor(hours.length * 0.1);
    const p90Index = Math.floor(hours.length * 0.9);

    return {
      startHour: hours[Math.max(0, p10Index)],
      endHour: hours[Math.min(hours.length - 1, p90Index)],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  private inferReviewHabit(observations: BehaviorObservation[]): BehaviorProfile['reviewHabit'] {
    if (observations.length === 0) return 'milestone'; // default

    const thoughtfulReviews = observations.filter(o => (o.data as any).thoughtful === true).length;
    const immediateReviews = observations.filter(o => (o.data as any).immediate === true).length;
    const total = observations.length;

    // If most approvals are thoughtful (took >5min), user reviews carefully
    if (thoughtfulReviews > total * 0.5) return 'per-step';
    // If most are immediate (<1min), user reviews lightly
    if (immediateReviews > total * 0.5) return 'end-only';
    return 'milestone';
  }

  private inferTaskDecomposition(observations: BehaviorObservation[]): BehaviorProfile['taskDecomposition'] {
    if (observations.length === 0) return 'moderate';

    const stepCounts = observations
      .map(o => (o.data as any).plan?.stepCount as number)
      .filter((s): s is number => s != null);

    if (stepCounts.length === 0) return 'moderate';

    const avg = stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length;

    if (avg <= 3) return 'coarse';
    if (avg <= 6) return 'moderate';
    return 'fine-grained';
  }

  private inferCollaborationStyle(observations: BehaviorObservation[]): BehaviorProfile['collaborationStyle'] {
    if (observations.length === 0) return 'solo';
    return 'solo'; // Default for now, can be enhanced with multi-user data
  }

  private collectPreferredAgentTypes(observations: BehaviorObservation[]): string[] {
    // From mission plans, collect unique agent types used
    const types = new Set<string>();
    for (const obs of observations) {
      const plan = (obs.data as any).plan;
      if (!plan) continue;
    }
    return [...types].length > 0 ? [...types] : ['coding'];
  }

  private collectPreferredDomains(observations: BehaviorObservation[]): string[] {
    const domains = new Set<string>();
    for (const obs of observations) {
      const plan = (obs.data as any).plan;
      if (!plan) continue;
    }
    return [...domains];
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化 (★ v8.6: 包含版本历史)
  // ═══════════════════════════════════════════════════════════

  toJSON(): object {
    const hist: Record<string, TwinVersion> = {};
    for (const [ver, tv] of this.versionHistory) {
      hist[String(ver)] = tv;
    }
    return {
      userId: this.userId,
      createdAt: this.createdAt,
      version: this.version,
      observations: this.observations,
      sourceEvents: this.sourceEvents,
      versionHistory: hist,
    };
  }

  static fromJSON(data: {
    userId?: string;
    createdAt?: number;
    version?: number;
    observations: BehaviorObservation[];
    sourceEvents?: string[];
    versionHistory?: Record<string, TwinVersion>;
  }): BehaviorTwin {
    const twin = new BehaviorTwin(data.userId || 'default');
    twin.observations = data.observations || [];
    twin.createdAt = data.createdAt ?? Date.now();
    twin.version = data.version ?? 0;
    twin.sourceEvents = data.sourceEvents ?? [];
    if (data.versionHistory) {
      for (const [verStr, tv] of Object.entries(data.versionHistory)) {
        twin.versionHistory.set(Number(verStr), tv);
      }
    }
    return twin;
  }
}
