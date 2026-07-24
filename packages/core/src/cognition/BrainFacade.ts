/**
 * BrainFacade — 统一大脑门面
 *
 * Phase 4.5 / 架构打磨 — P1 修复
 *
 * 将 4 套重叠的大脑系统统一为一个入口：
 *   - PersonalBrain   (cognition/memory/) — 五层记忆，内存级
 *   - MemoryWiki       (packages/memory/)   — SQLite+ZVec 持久层
 *   - LearningLoop     (learning/)          — 经验提取 + 策略优化
 *   - EvolutionEngine  (evolution/)         — 模式挖掘 + 失败分析
 *
 * 设计原则：
 *   - Facade 模式：不修改现有模块，只在外部包裹统一 API
 *   - 优雅降级：任一套系统不可用时自动跳过
 *   - 学习闭环：任务完成 → BrainFacade.learn() → 所有子系统
 *
 * 使用方式：
 *   const brain = new BrainFacade(eventBus);
 *   brain.setPersonalBrain(personalBrain);
 *   brain.setMemoryWiki(memoryWiki);
 *   await brain.learn({ taskId, goal, result, output, duration });
 *   const memories = await brain.recall('登录模块', { departmentId: 'dept_xxx' });
 */

import { EventBus } from '../common/EventBus.js';

// ── Types ──

export interface BrainContext {
  departmentId?: string;
  taskId?: string;
  source?: 'task_completed' | 'task_failed' | 'manual' | 'reflection';
  metadata?: Record<string, unknown>;
}

export interface BrainExperience {
  taskId: string;
  goal: string;
  result: 'success' | 'failure';
  output?: string;
  error?: string;
  duration: number;
  departmentId?: string;
  capabilities: string[];
}

export interface BrainMemory {
  id: string;
  content: string;
  relevance: number;
  source: string;
  timestamp: number;
  layer?: 'working' | 'episodic' | 'semantic' | 'procedural' | 'workflow';
}

export interface BrainInsight {
  type: 'improvement' | 'warning' | 'pattern' | 'suggestion';
  message: string;
  confidence: number;
  source: string;
}

export interface BrainStats {
  totalMemories: number;
  totalExperiences: number;
  totalPatterns: number;
  totalInsights: number;
  lastLearningAt: number;
  systems: {
    personalBrain: boolean;
    memoryWiki: boolean;
    learningLoop: boolean;
    evolutionEngine: boolean;
  };
}

export interface BrainForgetCriteria {
  olderThan?: number;
  layer?: string;
  departmentId?: string;
  maxCount?: number;
}

export interface ConsolidationResult {
  consolidated: number;
  summariesCreated: number;
  freedEntries: number;
}

export interface CEOReport {
  timestamp: number;
  summary: string;
  departments: Array<{
    name: string;
    health: 'good' | 'warning' | 'error';
    recentActivity: number;
    topLearnings: string[];
  }>;
  patterns: string[];
  recommendations: string[];
}

export interface CrossDeptSynthesis {
  topic: string;
  departments: string[];
  insight: string;
  confidence: number;
}

// ── 子系统接口（松耦合） ──

export interface PersonalBrainLike {
  remember(content: string, options?: Record<string, unknown>): Promise<void>;
  recall(query: string, options?: Record<string, unknown>): Promise<Array<{ content: string; relevance: number }>>;
  readonly name: string;
}

export interface MemoryWikiLike {
  remember(content: string, metadata?: Record<string, unknown>): Promise<void>;
  search(query: string, options?: Record<string, unknown>): Promise<Array<{ content: string; score: number }>>;
  readonly name: string;
}

export interface LearningLoopLike {
  extractExperience(record: Record<string, unknown>): Promise<unknown>;
  evaluatePlan(plan: Record<string, unknown>): Promise<unknown>;
  optimize(insights: unknown[]): Promise<unknown>;
  readonly name: string;
}

export interface EvolutionEngineLike {
  minePatterns(history: unknown[]): Promise<unknown[]>;
  analyzeFailure(error: string, context: Record<string, unknown>): Promise<unknown>;
  extractPatterns(data: unknown[]): Promise<unknown[]>;
  readonly name: string;
}

// ── BrainFacade ──

export class BrainFacade {
  name = 'BrainFacade';
  version = '1.0.0';

  private eventBus: EventBus;

  // 可注入的子系统（全部可选 — 优雅降级）
  private personalBrain: PersonalBrainLike | null = null;
  private memoryWiki: MemoryWikiLike | null = null;
  private learningLoop: LearningLoopLike | null = null;
  private evolutionEngine: EvolutionEngineLike | null = null;

  /** SOPEngine — 将成功经验转为 SOP（Phase 5） */
  private sopEngine?: { extractSOP: (exp: BrainExperience) => unknown };

  // 内部统计
  private totalMemories = 0;
  private totalExperiences = 0;
  private totalPatterns = 0;
  private totalInsights = 0;
  private lastLearningAt = 0;

  // 内存级 Fallback 存储（当所有子系统都不可用时）
  private fallbackStore: Array<{ content: string; timestamp: number; context: BrainContext }> = [];
  private static readonly MAX_FALLBACK = 500;

  // 自动整合定时器（每日运行）
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  private autoConsolidateEnabled = true;
  private static readonly CONSOLIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

  /** 主动反思定时器（每 6 小时） */
  private reflectionTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly REFLECTION_INTERVAL = 6 * 60 * 60 * 1000;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[BrainFacade] EventBus 是必填参数');
    this.eventBus = eventBus;

    // 监听学习事件（供外部触发）
    this.eventBus.on('brain.learn.request', (event: any) => {
      const exp = event.payload as BrainExperience;
      if (exp) {
        this.learn(exp).catch(err =>
          console.warn('[BrainFacade] 异步学习失败:', err),
        );
      }
    });

    // 启动自动整合定时器（每日一次）
    // 主动反思定时器（每 6 小时）
    this.reflectionTimer = setInterval(() => {
      this.activeReflect().catch(err =>
        console.warn('[BrainFacade] 主动反思失败:', err),
      );
    }, BrainFacade.REFLECTION_INTERVAL);
    if (this.reflectionTimer && typeof this.reflectionTimer === 'object' && 'unref' in this.reflectionTimer) {
      this.reflectionTimer.unref();
    }

    this.consolidationTimer = setInterval(() => {
      if (this.autoConsolidateEnabled) {
        this.consolidate().then(result => {
          if (result.consolidated > 0) {
            console.log(`[BrainFacade] 自动整合: ${result.consolidated}条→${result.summariesCreated}条摘要, 释放${result.freedEntries}条`);
            this.eventBus.emit({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'brain.consolidation.auto_completed',
              timestamp: Date.now(),
              executionId: 'brain',
              source: 'brain-facade',
              payload: result,
            });
          }
        }).catch(err => console.warn('[BrainFacade] 自动整合失败:', err));
      }
    }, BrainFacade.CONSOLIDATION_INTERVAL);
    // 不阻止进程退出
    if (this.consolidationTimer && typeof this.consolidationTimer === 'object' && 'unref' in this.consolidationTimer) {
      this.consolidationTimer.unref();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 依赖注入
  // ═══════════════════════════════════════════════════════════════

  setPersonalBrain(brain: PersonalBrainLike): void {
    this.personalBrain = brain;
  }

  setMemoryWiki(wiki: MemoryWikiLike): void {
    this.memoryWiki = wiki;
  }

  setLearningLoop(loop: LearningLoopLike): void {
    this.learningLoop = loop;
  }

  setEvolutionEngine(engine: EvolutionEngineLike): void {
    this.evolutionEngine = engine;
  }

  /** setSOPEngine — 注入 SOPEngine（Phase 5） */
  setSOPEngine(engine: { extractSOP: (exp: BrainExperience) => unknown }): void {
    this.sopEngine = engine;
  }

  /**
   * isReady — 是否有至少一个子系统可用
   */
  isReady(): boolean {
    return !!(this.personalBrain || this.memoryWiki || this.learningLoop || this.evolutionEngine);
  }

  /**
   * stop — 停止自动整合定时器
   */
  /**
   * activeReflect — 主动反思
   * 定时触发，发现洞察并广播
   */
  private async activeReflect(): Promise<void> {
    const insights = await this.reflect();
    if (insights.length > 0) {
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'brain.active_reflection',
        timestamp: Date.now(),
        executionId: 'brain',
        source: 'brain-facade',
        payload: { insightCount: insights.length, insights },
      });
      this.totalInsights += insights.length;
      console.log(`[BrainFacade] 主动反思: 发现 ${insights.length} 条洞察`);
    }
  }

  stop(): void {
    if (this.reflectionTimer) {
      clearInterval(this.reflectionTimer);
      this.reflectionTimer = null;
    }
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
  }

  /**
   * enableAutoConsolidation — 启用自动整合
   */
  enableAutoConsolidation(): void {
    this.autoConsolidateEnabled = true;
  }

  /**
   * disableAutoConsolidation — 禁用自动整合
   */
  disableAutoConsolidation(): void {
    this.autoConsolidateEnabled = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // 统一 API
  // ═══════════════════════════════════════════════════════════════

  /**
   * remember — 存储记忆到所有可用的脑系统
   *
   * 写入顺序：
   *   1. PersonalBrain（内存级，快速）
   *   2. MemoryWiki（磁盘级，持久化）
   *   3. Fallback store（都不可用时）
   *
   * @param content - 记忆内容
   * @param context - 记忆上下文
   */
  async remember(content: string, context: BrainContext): Promise<void> {
    let stored = false;

    // 尝试 PersonalBrain
    if (this.personalBrain) {
      try {
        await this.personalBrain.remember(content, {
          departmentId: context.departmentId,
          taskId: context.taskId,
          source: context.source,
        });
        stored = true;
      } catch (err) {
        console.warn('[BrainFacade] PersonalBrain.remember 失败:', (err as Error).message);
      }
    }

    // 尝试 MemoryWiki
    if (this.memoryWiki) {
      try {
        await this.memoryWiki.remember(content, {
          departmentId: context.departmentId,
          taskId: context.taskId,
          source: context.source,
          timestamp: Date.now(),
        });
        stored = true;
      } catch (err) {
        console.warn('[BrainFacade] MemoryWiki.remember 失败:', (err as Error).message);
      }
    }

    // Fallback
    if (!stored) {
      this.fallbackStore.push({ content, timestamp: Date.now(), context });
      if (this.fallbackStore.length > BrainFacade.MAX_FALLBACK) {
        this.fallbackStore.shift();
      }
    }

    this.totalMemories++;

    // 事件通知
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.memory.stored',
      timestamp: Date.now(),
      executionId: context.taskId ?? 'brain',
      source: 'brain-facade',
      payload: {
        content: content.substring(0, 100),
        departmentId: context.departmentId,
        source: context.source,
        systemsUsed: {
          personalBrain: !!this.personalBrain && stored,
          memoryWiki: !!this.memoryWiki && stored,
          fallback: !stored,
        },
      },
    });
  }

  /**
   * recall — 检索相关记忆
   *
   * 查询顺序：
   *   1. PersonalBrain（内存级，快速）
   *   2. MemoryWiki（磁盘级，完整）
   *   3. Fallback store
   *
   * 结果按相关性合并去重。
   *
   * @param query - 查询文本
   * @param context - 上下文（可选 departmentId 过滤）
   * @returns 相关记忆列表
   */
  async recall(query: string, context?: BrainContext): Promise<BrainMemory[]> {
    const memories: BrainMemory[] = [];
    const seen = new Set<string>();

    // PersonalBrain
    if (this.personalBrain) {
      try {
        const results = await this.personalBrain.recall(query, {
          departmentId: context?.departmentId,
        });
        for (const r of results) {
          const key = r.content.substring(0, 50);
          if (!seen.has(key)) {
            seen.add(key);
            memories.push({
              id: `pb_${Date.now()}_${memories.length}`,
              content: r.content,
              relevance: r.relevance,
              source: 'personal-brain',
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn('[BrainFacade] PersonalBrain.recall 失败:', (err as Error).message);
      }
    }

    // MemoryWiki
    if (this.memoryWiki) {
      try {
        const results = await this.memoryWiki.search(query, {
          departmentId: context?.departmentId,
        });
        for (const r of results) {
          const key = r.content.substring(0, 50);
          if (!seen.has(key)) {
            seen.add(key);
            memories.push({
              id: `mw_${Date.now()}_${memories.length}`,
              content: r.content,
              relevance: r.score,
              source: 'memory-wiki',
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn('[BrainFacade] MemoryWiki.search 失败:', (err as Error).message);
      }
    }

    // Fallback
    if (memories.length === 0 && this.fallbackStore.length > 0) {
      const keyword = query.toLowerCase();
      for (const item of this.fallbackStore) {
        if (item.content.toLowerCase().includes(keyword)) {
          memories.push({
            id: `fb_${item.timestamp}`,
            content: item.content,
            relevance: 0.5,
            source: 'fallback',
            timestamp: item.timestamp,
          });
        }
      }
    }

    // 按相关性排序
    return memories.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * learn — 学习闭环核心
   *
   * 记录一次执行结果，并触发所有学习子系统：
   *   1. remember() — 持久化原始经验
   *   2. LearningLoop — 提取经验模式
   *   3. EvolutionEngine — 挖掘工作流模式 + 分析失败
   *   4. 广播 brain.learning.completed 事件
   *
   * @param experience - 执行经验
   */
  async learn(experience: BrainExperience): Promise<void> {
    const startTime = Date.now();
    let patternsExtracted = 0;

    // 1. 持久化原始经验
    const content = experience.result === 'success'
      ? `✅ [${experience.departmentId ?? 'global'}] 任务完成: ${experience.goal}\n输出: ${(experience.output ?? '').substring(0, 200)}\n耗时: ${experience.duration}ms`
      : `❌ [${experience.departmentId ?? 'global'}] 任务失败: ${experience.goal}\n错误: ${experience.error ?? '未知'}\n耗时: ${experience.duration}ms`;

    await this.remember(content, {
      taskId: experience.taskId,
      departmentId: experience.departmentId,
      source: experience.result === 'success' ? 'task_completed' : 'task_failed',
    });

    // 2. LearningLoop — 提取经验
    if (this.learningLoop) {
      try {
        await this.learningLoop.extractExperience({
          taskId: experience.taskId,
          goal: experience.goal,
          result: experience.result,
          output: experience.output,
          error: experience.error,
          duration: experience.duration,
          departmentId: experience.departmentId,
        });
      } catch (err) {
        console.warn('[BrainFacade] LearningLoop 失败:', (err as Error).message);
      }
    }

    // 3. EvolutionEngine — 模式挖掘
    if (this.evolutionEngine) {
      try {
        // 成功 → 挖掘模式
        if (experience.result === 'success') {
          const patterns = await this.evolutionEngine.minePatterns([{
            taskId: experience.taskId,
            goal: experience.goal,
            capabilities: experience.capabilities,
            duration: experience.duration,
          }]);
          patternsExtracted = patterns.length;
          this.totalPatterns += patterns.length;
        }

        // 失败 → 分析原因
        if (experience.result === 'failure' && experience.error) {
          await this.evolutionEngine.analyzeFailure(experience.error, {
            taskId: experience.taskId,
            goal: experience.goal,
            departmentId: experience.departmentId,
          });
        }
      } catch (err) {
        console.warn('[BrainFacade] EvolutionEngine 失败:', (err as Error).message);
      }
    }

    // 4. 统计
    this.totalExperiences++;
    this.lastLearningAt = Date.now();

    // 4.5. SOPEngine — 成功经验 → SOP（Phase 5）
    if (experience.result === 'success' && this.sopEngine) {
      try {
        const sop = this.sopEngine.extractSOP(experience);
        if (sop) {
          console.log(`[BrainFacade] 📋 SOP 已提取: ${(sop as Record<string,unknown>).title}`);
        }
      } catch (err) {
        console.warn('[BrainFacade] SOPEngine 失败:', (err as Error).message);
      }
    }

    // 5. 广播学习完成事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.learning.completed',
      timestamp: Date.now(),
      executionId: experience.taskId,
      source: 'brain-facade',
      payload: {
        taskId: experience.taskId,
        goal: experience.goal.substring(0, 80),
        result: experience.result,
        patternsExtracted,
        duration: Date.now() - startTime,
        departmentId: experience.departmentId,
      },
    });

    // 6. 广播规划洞察事件（Brain→Planning 反馈闭环）
    // DeliveryPlanner 监听此事件来调整规划策略
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.planning.insight',
      timestamp: Date.now(),
      executionId: experience.taskId,
      source: 'brain-facade',
      payload: {
        taskId: experience.taskId,
        goal: experience.goal.substring(0, 80),
        result: experience.result,
        patternsExtracted,
        duration: Date.now() - startTime,
        departmentId: experience.departmentId,
        capabilities: experience.capabilities,
      },
    });
  }

  /**
   * reflect — 反思分析
   *
   * 分析最近的执行表现，给出改进建议。
   *
   * @param departmentId - 可选，按部门过滤
   * @returns 洞察列表
   */
  async reflect(departmentId?: string): Promise<BrainInsight[]> {
    const insights: BrainInsight[] = [];

    // 从 LearningLoop 获取优化建议
    if (this.learningLoop) {
      try {
        const result = await this.learningLoop.optimize([]);
        if (result && typeof result === 'object') {
          const suggestions = (result as Record<string, unknown>).suggestions as string[] | undefined;
          if (suggestions) {
            for (const s of suggestions) {
              insights.push({
                type: 'suggestion',
                message: s,
                confidence: 0.7,
                source: 'learning-loop',
              });
            }
          }
        }
      } catch (err) {
        console.warn('[BrainFacade] LearningLoop.reflect 失败:', (err as Error).message);
      }
    }

    // 从 EvolutionEngine 获取模式
    if (this.evolutionEngine) {
      try {
        const patterns = await this.evolutionEngine.extractPatterns([]);
        for (const p of patterns) {
          const pattern = p as Record<string, unknown>;
          insights.push({
            type: 'pattern',
            message: `发现模式: ${String(pattern.name ?? pattern.type ?? 'unknown')}`,
            confidence: (pattern.confidence as number) ?? 0.6,
            source: 'evolution-engine',
          });
        }
      } catch (err) {
        console.warn('[BrainFacade] EvolutionEngine.reflect 失败:', (err as Error).message);
      }
    }

    // 从 Fallback 统计生成基础洞察
    if (insights.length === 0 && this.totalExperiences > 0) {
      const successRate = this.totalExperiences > 0
        ? Math.round((this.totalMemories / (this.totalExperiences * 2)) * 100)
        : 0;
      insights.push({
        type: 'suggestion',
        message: `已完成 ${this.totalExperiences} 次学习，记忆库有 ${this.totalMemories} 条记录`,
        confidence: 0.9,
        source: 'brain-facade',
      });
    }

    this.totalInsights += insights.length;
    return insights;
  }

  /**
   * forget — 遗忘旧记忆
   *
   * @param criteria - 遗忘条件
   * @returns 遗忘的记忆数量
   */
  async forget(criteria: BrainForgetCriteria): Promise<number> {
    let forgotten = 0;

    // Fallback store 按条件清理
    if (criteria.olderThan) {
      const cutoff = Date.now() - criteria.olderThan;
      const before = this.fallbackStore.length;
      this.fallbackStore = this.fallbackStore.filter(item => item.timestamp >= cutoff);
      forgotten += before - this.fallbackStore.length;
    }

    if (criteria.maxCount && this.fallbackStore.length > criteria.maxCount) {
      const toRemove = this.fallbackStore.length - criteria.maxCount;
      this.fallbackStore.splice(0, toRemove);
      forgotten += toRemove;
    }

    // 通知子系统（PersonalBrain/MemoryWiki 有自己的 TTL 机制，这里只触发信号）
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.memory.forgotten',
      timestamp: Date.now(),
      executionId: 'brain',
      source: 'brain-facade',
      payload: { forgotten, criteria },
    });

    this.totalMemories = Math.max(0, this.totalMemories - forgotten);
    return forgotten;
  }

  // ═══════════════════════════════════════════════════════════════
  // 记忆整合
  // ═══════════════════════════════════════════════════════════════

  /**
   * consolidate — 记忆整合
   *
   * 将旧的、相似的记忆合并为摘要，减少存储冗余。
   * 默认整合 7 天前的记忆。
   *
   * @param olderThan - 整合早于此时间戳的记忆（毫秒）
   * @param departmentId - 可选，按部门整合
   * @returns 整合统计
   */
  async consolidate(olderThan?: number, departmentId?: string): Promise<ConsolidationResult> {
    const cutoff = olderThan ?? (Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oldItems = this.fallbackStore.filter(
      item => item.timestamp < cutoff && (!departmentId || item.context.departmentId === departmentId),
    );

    if (oldItems.length === 0) {
      return { consolidated: 0, summariesCreated: 0, freedEntries: 0 };
    }

    // 按上下文分组（同部门同来源）
    const groups = new Map<string, typeof oldItems>();
    for (const item of oldItems) {
      const key = `${item.context.departmentId ?? 'global'}:${item.context.source}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    // 为每组创建摘要
    let summariesCreated = 0;
    for (const [key, items] of groups) {
      const content = items.map(i => i.content).join('\n---\n');
      const summary = `[整合摘要] ${items.length} 条 ${key} 相关记录\n${content.substring(0, 500)}`;
      this.fallbackStore.push({
        content: summary,
        timestamp: Date.now(),
        context: { source: 'reflection', departmentId: items[0].context.departmentId },
      });
      summariesCreated++;
    }

    // 移除旧条目
    const before = this.fallbackStore.length;
    this.fallbackStore = this.fallbackStore.filter(item => item.timestamp >= cutoff);
    const freedEntries = before - this.fallbackStore.length;

    // 发射整合事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.memory.consolidated',
      timestamp: Date.now(),
      executionId: 'brain',
      source: 'brain-facade',
      payload: { consolidated: oldItems.length, summariesCreated, freedEntries, departmentId },
    });

    return { consolidated: oldItems.length, summariesCreated, freedEntries };
  }

  // ═══════════════════════════════════════════════════════════════
  // CEO 报告与跨部门知识合成
  // ═══════════════════════════════════════════════════════════════

  /**
   * generateCEOReport — 生成 CEO 智能摘要报告
   *
   * 聚合所有部门的活跃度、最近学习结果、发现的模式，
   * 给出一句话摘要和推荐行动。
   *
   * @param departmentManager - 部门管理器（用于获取部门名）
   * @returns CEO 报告
   */
  async generateCEOReport(departmentManager?: {
    listDepartments: () => Array<{ name: string; id: string }>;
  }): Promise<CEOReport> {
    const insights = await this.reflect();
    const departmentSections: CEOReport['departments'] = [];

    // 按部门聚合
    if (departmentManager) {
      for (const dept of departmentManager.listDepartments()) {
        const deptInsights = insights.filter(() => true);
        departmentSections.push({
          name: dept.name,
          health: deptInsights.filter(i => i.type === 'warning').length > 2 ? 'error'
            : deptInsights.filter(i => i.type === 'warning').length > 0 ? 'warning'
            : 'good',
          recentActivity: this.totalExperiences,
          topLearnings: deptInsights
            .filter(i => i.type === 'pattern' || i.type === 'suggestion')
            .slice(0, 3)
            .map(i => i.message),
        });
      }
    }

    // 汇总
    const patterns = insights.filter(i => i.type === 'pattern').map(i => i.message);
    const recommendations = insights.filter(i => i.type === 'suggestion').map(i => i.message);

    const summary = [
      `🧠 大脑报告 | ${new Date().toLocaleDateString()}`,
      `记忆: ${this.totalMemories} 条 | 经验: ${this.totalExperiences} 次 | 模式: ${this.totalPatterns} 个`,
      departmentSections.length > 0 ? `部门: ${departmentSections.length} 个活跃` : '',
      patterns.length > 0 ? `发现 ${patterns.length} 个新模式` : '',
      recommendations.length > 0 ? `${recommendations.length} 条建议` : '',
    ].filter(Boolean).join(' | ');

    return {
      timestamp: Date.now(),
      summary,
      departments: departmentSections,
      patterns,
      recommendations,
    };
  }

  /**
   * synthesize — 跨部门知识合成
   *
   * 分析所有部门的记忆/经验/模式，找出跨部门的共性知识。
   *
   * @returns 合成的跨部门知识列表（仅包含涉及 2+ 部门的主题）
   */
  async synthesize(): Promise<CrossDeptSynthesis[]> {
    const insights = await this.reflect();

    // 按主题相似度分组
    const topicGroups = new Map<string, {
      insight: string;
      departments: Set<string>;
      confidence: number;
    }>();

    for (const insight of insights) {
      const words = insight.message.split(/\s+/).slice(0, 5).join(' ');
      const topic = words.substring(0, 40);

      if (!topicGroups.has(topic)) {
        topicGroups.set(topic, {
          insight: insight.message,
          departments: new Set(),
          confidence: insight.confidence,
        });
      }
      topicGroups.get(topic)!.departments.add(insight.source);
      topicGroups.get(topic)!.confidence = Math.max(
        topicGroups.get(topic)!.confidence,
        insight.confidence,
      );
    }

    // 返回跨部门主题（出现在 2+ 部门中）
    return [...topicGroups.entries()]
      .filter(([_, group]) => group.departments.size >= 2)
      .map(([topic, group]) => ({
        topic,
        departments: [...group.departments],
        insight: group.insight,
        confidence: group.confidence,
      }));
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStats — 获取大脑统计
   */
  getStats(): BrainStats {
    return {
      totalMemories: this.totalMemories,
      totalExperiences: this.totalExperiences,
      totalPatterns: this.totalPatterns,
      totalInsights: this.totalInsights,
      lastLearningAt: this.lastLearningAt,
      systems: {
        personalBrain: !!this.personalBrain,
        memoryWiki: !!this.memoryWiki,
        learningLoop: !!this.learningLoop,
        evolutionEngine: !!this.evolutionEngine,
      },
    };
  }
}
