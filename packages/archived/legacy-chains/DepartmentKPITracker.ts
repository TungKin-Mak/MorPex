/**
 * DepartmentKPITracker — 部门 KPI 追踪器
 *
 * Phase 5 / VCOS 升级 — P1: Department KPI System
 *
 * 为每个部门定义和追踪关键绩效指标（KPI）。
 *
 * 内置模板：
 *   - 编程部: bugs_fixed, features_shipped, code_quality, release_count
 *   - 电商部: traffic, conversion_rate, revenue, campaign_count
 *   - 市场部: leads_generated, content_published, engagement, reach
 *   - 通用: tasks_completed, avg_quality, response_time, uptime
 *
 * 设计原则：
 *   - 纯计数器（不依赖外部数据库）
 *   - 部门模板自动初始化
 *   - getHealth() 生成人类可读报告
 */

import { EventBus } from '../common/EventBus.js';
import type { DepartmentId } from '../department/types.js';

// ── Types ──

export interface KPIDefinition {
  name: string;
  displayName: string;
  unit: string;
  target: number;
  current: number;
  trend: 'up' | 'down' | 'stable';
  history: number[];  // 最近 7 天的值
}

export interface DepartmentHealth {
  departmentId: string;
  departmentName: string;
  kpis: KPIDefinition[];
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  lastUpdated: number;
}

export interface KPIStats {
  totalDepartments: number;
  departmentsWithKPIs: number;
  averageScore: number;
  topPerformer: string | null;
  needsAttention: string[];
}

// ── 内置 KPI 模板 ──

const KPI_TEMPLATES: Record<string, Omit<KPIDefinition, 'current' | 'trend' | 'history'>[]> = {
  programming: [
    { name: 'bugs_fixed', displayName: 'Bug 修复', unit: '个', target: 10 },
    { name: 'features_shipped', displayName: '功能交付', unit: '个', target: 5 },
    { name: 'code_quality', displayName: '代码质量', unit: '%', target: 90 },
    { name: 'release_count', displayName: '发布次数', unit: '次', target: 2 },
  ],
  ecommerce: [
    { name: 'traffic', displayName: '流量', unit: '次', target: 10000 },
    { name: 'conversion_rate', displayName: '转化率', unit: '%', target: 3 },
    { name: 'revenue', displayName: '销售额', unit: '元', target: 50000 },
    { name: 'campaign_count', displayName: '营销活动', unit: '个', target: 4 },
  ],
  marketing: [
    { name: 'leads_generated', displayName: '线索生成', unit: '个', target: 200 },
    { name: 'content_published', displayName: '内容发布', unit: '篇', target: 15 },
    { name: 'engagement', displayName: '互动率', unit: '%', target: 5 },
    { name: 'reach', displayName: '覆盖人数', unit: '人', target: 50000 },
  ],
  design: [
    { name: 'designs_delivered', displayName: '设计交付', unit: '个', target: 8 },
    { name: 'revision_rounds', displayName: '修改轮次', unit: '次', target: 2 },
    { name: 'client_satisfaction', displayName: '满意度', unit: '%', target: 85 },
    { name: 'design_system_coverage', displayName: '设计系统覆盖', unit: '%', target: 70 },
  ],
  general: [
    { name: 'tasks_completed', displayName: '完成任务', unit: '个', target: 20 },
    { name: 'avg_quality', displayName: '平均质量', unit: '%', target: 80 },
    { name: 'response_time', displayName: '响应时间', unit: '分钟', target: 30 },
    { name: 'uptime', displayName: '可用率', unit: '%', target: 99 },
  ],
};

// ── DepartmentKPITracker ──

export class DepartmentKPITracker {
  name = 'DepartmentKPITracker';
  version = '1.0.0';

  private eventBus: EventBus;
  private departments: Map<DepartmentId, DepartmentHealth> = new Map();
  private departmentNames: Map<DepartmentId, string> = new Map();

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[DepartmentKPITracker] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  // ═══════════════════════════════════════════════════════════════
  // 部门初始化
  // ═══════════════════════════════════════════════════════════════

  /**
   * registerDepartment — 注册部门并自动初始化 KPI
   *
   * 根据部门名称自动匹配 KPI 模板。
   *
   * @param departmentId - 部门 ID
   * @param departmentName - 部门名称（用于模板匹配）
   * @param templateName - 可选，强制指定模板（programming/ecommerce/marketing/design/general）
   */
  registerDepartment(
    departmentId: DepartmentId,
    departmentName: string,
    templateName?: string,
  ): DepartmentHealth {
    this.departmentNames.set(departmentId, departmentName);

    // 自动匹配模板
    let templateKey = templateName ?? 'general';
    if (!templateName) {
      const lower = departmentName.toLowerCase();
      if (/编程|开发|工程|代码|tech|engineering|dev/.test(lower)) templateKey = 'programming';
      else if (/电商|电商|shop|store/.test(lower)) templateKey = 'ecommerce';
      else if (/市场|营销|marketing|推广|growth/.test(lower)) templateKey = 'marketing';
      else if (/设计|design|UI|UX|创意/.test(lower)) templateKey = 'design';
    }

    const template = KPI_TEMPLATES[templateKey] ?? KPI_TEMPLATES['general']!;
    const kpis: KPIDefinition[] = template.map(t => ({
      ...t,
      current: 0,
      trend: 'stable' as const,
      history: [],
    }));

    const health: DepartmentHealth = {
      departmentId,
      departmentName,
      kpis,
      overallScore: 0,
      strengths: [],
      weaknesses: [],
      recommendations: [],
      lastUpdated: Date.now(),
    };

    this.departments.set(departmentId, health);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'department.kpi.initialized',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'department-kpi-tracker',
      payload: { departmentId, departmentName, templateKey, kpiCount: kpis.length },
    });

    console.log(`[DepartmentKPITracker] 📊 "${departmentName}" KPI 已初始化 (${templateKey} 模板, ${kpis.length} 项指标)`);
    return health;
  }

  // ═══════════════════════════════════════════════════════════════
  // KPI 记录
  // ═══════════════════════════════════════════════════════════════

  /**
   * recordMetric — 记录一个 KPI 值
   *
   * 自动更新 trend（相比上次值的走向）和历史（最近 7 天）。
   *
   * @param departmentId - 部门 ID
   * @param kpiName - KPI 名称
   * @param value - 当前值
   */
  recordMetric(departmentId: DepartmentId, kpiName: string, value: number): void {
    const health = this.departments.get(departmentId);
    if (!health) {
      console.warn(`[DepartmentKPITracker] 部门 "${departmentId}" 未注册`);
      return;
    }

    const kpi = health.kpis.find(k => k.name === kpiName);
    if (!kpi) {
      console.warn(`[DepartmentKPITracker] KPI "${kpiName}" 在部门 "${departmentId}" 中不存在`);
      return;
    }

    // 更新趋势
    if (kpi.current > 0) {
      const change = value - kpi.current;
      if (change > kpi.current * 0.05) kpi.trend = 'up';
      else if (change < -kpi.current * 0.05) kpi.trend = 'down';
      else kpi.trend = 'stable';
    }

    kpi.current = value;

    // 更新历史（最近 7 天）
    kpi.history.push(value);
    if (kpi.history.length > 7) kpi.history = kpi.history.slice(-7);

    health.lastUpdated = Date.now();
    this.recalculateHealth(health);
  }

  /**
   * incrementMetric — 增量更新 KPI（当前值 +delta）
   */
  incrementMetric(departmentId: DepartmentId, kpiName: string, delta: number = 1): void {
    const health = this.departments.get(departmentId);
    if (!health) return;
    const kpi = health.kpis.find(k => k.name === kpiName);
    if (!kpi) return;
    this.recordMetric(departmentId, kpiName, kpi.current + delta);
  }

  // ═══════════════════════════════════════════════════════════════
  // 健康评分
  // ═══════════════════════════════════════════════════════════════

  /**
   * recalculateHealth — 重新计算部门健康评分
   *
   * 算法：
   *   每项 KPI 的达成率 = min(current/target, 1.5) × 100
   *   总评分 = 各项达成率的加权平均
   */
  private recalculateHealth(health: DepartmentHealth): void {
    if (health.kpis.length === 0) {
      health.overallScore = 0;
      return;
    }

    const scores = health.kpis.map(kpi => {
      if (kpi.target === 0) return 100;
      return Math.min(kpi.current / kpi.target, 1.5) * 100;
    });

    health.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    // 强项（达成率 > 100%）
    health.strengths = health.kpis
      .filter(kpi => kpi.target > 0 && kpi.current >= kpi.target)
      .map(kpi => `${kpi.displayName}: ${kpi.current}/${kpi.target}${kpi.unit} ✅`);

    // 弱项（达成率 < 50%）
    health.weaknesses = health.kpis
      .filter(kpi => kpi.target > 0 && kpi.current < kpi.target * 0.5)
      .map(kpi => `${kpi.displayName}: ${kpi.current}/${kpi.target}${kpi.unit} ⚠️`);

    // 建议
    health.recommendations = [];
    if (health.weaknesses.length > 0) {
      health.recommendations.push(`关注 ${health.weaknesses.length} 项未达标指标`);
    }
    if (health.overallScore >= 90) {
      health.recommendations.push('🏆 部门表现优秀，可考虑扩展能力边界');
    } else if (health.overallScore >= 70) {
      health.recommendations.push('📈 部门运行良好，关注弱项即可');
    } else {
      health.recommendations.push('⚠️ 需要重点关注，建议增加资源投入');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getHealth — 获取部门健康报告
   */
  getHealth(departmentId: DepartmentId): DepartmentHealth | undefined {
    return this.departments.get(departmentId);
  }

  /**
   * getAllHealth — 获取所有部门健康报告
   */
  getAllHealth(): DepartmentHealth[] {
    return [...this.departments.values()]
      .sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * getStats — 获取 KPI 系统统计
   */
  getStats(): KPIStats {
    const all = [...this.departments.values()];
    const scores = all.map(d => d.overallScore);

    return {
      totalDepartments: this.departmentNames.size,
      departmentsWithKPIs: this.departments.size,
      averageScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      topPerformer: all.length > 0 ? all.reduce((best, d) => d.overallScore > best.overallScore ? d : best).departmentName : null,
      needsAttention: all.filter(d => d.overallScore < 60).map(d => d.departmentName),
    };
  }

  /**
   * generateCEOReport — 生成 CEO 日报
   *
   * 包含所有部门的关键 KPI 和健康状态。
   */
  generateCEOReport(): string {
    const all = this.getAllHealth();
    if (all.length === 0) return '📊 暂无部门数据。使用 registerDepartment() 注册部门。';

    const stats = this.getStats();
    const lines: string[] = [
      `# 📊 CEO 日报 — ${new Date().toLocaleDateString()}`,
      '',
      `## 总览`,
      `- ${stats.departmentsWithKPIs} 个部门有 KPI 追踪`,
      `- 平均健康分: ${stats.averageScore}/100`,
      `- 最佳部门: ${stats.topPerformer ?? 'N/A'}`,
      ...(stats.needsAttention.length > 0
        ? [`- ⚠️ 需要关注: ${stats.needsAttention.join(', ')}`]
        : []),
      '',
      '## 各部门详情',
      '',
    ];

    for (const dept of all) {
      const statusEmoji = dept.overallScore >= 90 ? '🟢' : dept.overallScore >= 70 ? '🟡' : '🔴';
      lines.push(`### ${statusEmoji} ${dept.departmentName} (${dept.overallScore}/100)`);
      for (const kpi of dept.kpis) {
        const trendIcon = kpi.trend === 'up' ? '📈' : kpi.trend === 'down' ? '📉' : '➡️';
        const pct = kpi.target > 0 ? Math.round(kpi.current / kpi.target * 100) : 0;
        lines.push(`  ${trendIcon} ${kpi.displayName}: ${kpi.current}/${kpi.target}${kpi.unit} (${pct}%)`);
      }
      if (dept.recommendations.length > 0) {
        lines.push(`  💡 ${dept.recommendations.join(' | ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
