/**
 * DomainClusterManager — 领域集群管理器
 *
 * 管理所有 DomainCluster 的生命周期。
 * 支持注册、唤醒、休眠、查询。
 *
 * 职责：
 *   - 注册 DomainCluster（基于 DomainManifest）
 *   - 按需唤醒/休眠领域集群
 *   - 根据用户意图匹配领域
 *   - 提供集群状态报告
 *
 * 设计约束：
 *   - 领域间互不干扰
 *   - 资源使用可控（限制活跃集群数量）
 */

import type { DomainManifest, ClusterStatus, ClusterStatusReport } from './types.js';
import { DomainCluster } from './DomainCluster.js';
import type { AgentTool } from '../adapters/pi-types.js';
import type { AgentEvent } from '../adapters/pi-types.js';
import {
  createInMemorySessionRepo,
  createNodeExecutionEnv,
  createAgentHarness,
  type AgentHarness,
  type InMemorySessionRepo,
} from '../adapters/domain-cluster.js';
import { KnowledgeGraph } from '../planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import { LLMProvider } from '../services/LLMProvider.js';

/** LLM 调用函数签名 */
export type LLMCaller = (prompt: string, systemPrompt?: string) => Promise<string>;

/**
 * DomainClusterManager — 领域集群管理器
 *
 * 用法：
 *   const manager = new DomainClusterManager();
 *   manager.register(manifest);
 *   await manager.wake('software_engineering');
 *   const result = await manager.execute('software_engineering', '请设计一个 API');
 *   await manager.sleep('legal_compliance');
 */
export class DomainClusterManager {
  /** 所有已注册的领域集群 */
  private clusters: Map<string, DomainCluster> = new Map();
  /** 最大同时活跃集群数（0 = 不限制） */
  private maxActiveClusters: number;
  /** 外部依赖 */
  private deps: {
    knowledgeGraph?: KnowledgeGraph;
    artifactRegistry?: ArtifactRegistry;
    builtinTools?: AgentTool[];
    agentRegistry?: Map<string, any>;  // 跨领域 Agent 注册表 (TeamSay 通信)
  };
  /** 全局 AgentEvent 回调 (由 DomainCluster 的 onStatusChange 转发) */
  onAgentEvent: ((domainId: string, event: any) => void) | null = null;

  constructor(config?: {
    maxActiveClusters?: number;
    knowledgeGraph?: KnowledgeGraph;
    artifactRegistry?: ArtifactRegistry;
    builtinTools?: AgentTool[];
  }) {
    this.maxActiveClusters = config?.maxActiveClusters ?? 0;
    this.deps = {
      knowledgeGraph: config?.knowledgeGraph,
      artifactRegistry: config?.artifactRegistry,
      builtinTools: config?.builtinTools,
      agentRegistry: new Map(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 注册管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * register — 注册一个新的领域集群
   *
   * 基于 DomainManifest 创建 DomainCluster 实例。
   * 注册后处于 sleeping 状态，需要显式 wake()。
   *
   * @param manifest - 领域清单
   * @throws 如果 domain_id 已存在
   */
  register(manifest: DomainManifest): DomainCluster {
    if (this.clusters.has(manifest.domain_id)) {
      throw new Error(`领域 ${manifest.domain_id} 已注册`);
    }

    const cluster = new DomainCluster(manifest, this.deps);

    this.clusters.set(manifest.domain_id, cluster);
    console.log(`[DomainClusterManager] 📋 已注册领域: ${manifest.domain_name} (${manifest.domain_id})`);
    return cluster;
  }

  /**
   * unregister — 注销领域集群
   *
   * 先休眠再移除。
   *
   * @param domainId - 领域 ID
   */
  async unregister(domainId: string): Promise<boolean> {
    const cluster = this.clusters.get(domainId);
    if (!cluster) return false;

    await cluster.sleep();
    this.clusters.delete(domainId);
    console.log(`[DomainClusterManager] 🗑️ 已注销领域: ${domainId}`);
    return true;
  }

  /**
   * registerMultiple — 批量注册领域集群
   */
  registerMultiple(manifests: DomainManifest[]): DomainCluster[] {
    return manifests.map(m => this.register(m));
  }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期控制
  // ═══════════════════════════════════════════════════════════════

  /**
   * wake — 唤醒指定领域集群
   *
   * 如果达到 maxActiveClusters 上限，会自动休眠最久未使用的集群。
   *
   * @param domainId - 领域 ID
   */
  async wake(domainId: string): Promise<void> {
    const cluster = this.clusters.get(domainId);
    if (!cluster) {
      throw new Error(`领域 ${domainId} 未注册`);
    }

    // 如果已达上限，自动休眠策略
    if (this.maxActiveClusters > 0) {
      const activeCount = this.getActiveClusters().length;
      if (activeCount >= this.maxActiveClusters && cluster.status !== 'active') {
        // 休眠最久未使用的活跃集群
        const oldest = this.findOldestActiveCluster(domainId);
        if (oldest) {
          console.log(`[DomainClusterManager] ⏳ 已达上限(${this.maxActiveClusters})，自动休眠: ${oldest.manifest.domain_id}`);
          await oldest.sleep();
        }
      }
    }

    await cluster.wake();
  }

  /**
   * sleep — 休眠指定领域集群
   *
   * @param domainId - 领域 ID
   */
  async sleep(domainId: string): Promise<void> {
    const cluster = this.clusters.get(domainId);
    if (!cluster) return;
    await cluster.sleep();
  }

  /**
   * sleepAll — 休眠所有领域集群
   */
  async sleepAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const cluster of this.clusters.values()) {
      promises.push(cluster.sleep());
    }
    await Promise.all(promises);
  }

  // ═══════════════════════════════════════════════════════════════
  // 任务执行
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — 在指定领域执行任务
   *
   * ★ v3.2 改造：接收外部 harness，不再自建。
   * Harness 由 SessionManager 统一管理，透传到 cluster.execute()。
   * 自动唤醒目标领域。
   *
   * @param domainId - 领域 ID
   * @param goal - 任务目标
   * @param harness - 外部 AgentHarness（由 SessionManager 创建）
   * @param sessionCtx - 会话上下文（可选，注入上游产物等）
   */
  async execute(domainId: string, goal: string, harness: AgentHarness, sessionCtx?: import('../common/types.js').SessionContext): Promise<any> {
    const cluster = this.clusters.get(domainId);
    if (!cluster) {
      throw new Error(`领域 ${domainId} 未注册`);
    }

    if (cluster.status === 'sleeping') {
      await this.wake(domainId);
    }

    // 注入 SessionContext 到 cluster（如果 cluster 支持）
    if (sessionCtx && typeof (cluster as any).setSessionContext === 'function') {
      (cluster as any).setSessionContext(sessionCtx);
    }

    return cluster.execute(goal, harness);
  }

  // ═══════════════════════════════════════════════════════════════
  // 意图匹配
  // ═══════════════════════════════════════════════════════════════

  /** LLM 意图匹配系统提示词 */
  private static readonly INTENT_MATCH_SYSTEM_PROMPT = `你是一个领域匹配引擎。请分析用户输入，判断其属于哪个领域。

可用领域列表（含领域 ID、名称和描述关键词）：
{availableDomains}

匹配规则：
1. 选择最匹配用户意图的一个领域
2. 如果不属于任何领域，返回 null
3. 如果属于多个领域，选最相关的

请严格按以下 JSON 格式返回，不要包含其他文字：
{
  "domain_id": "匹配的领域 ID 或 null",
  "confidence": 0.0-1.0,
  "reasoning": "简短理由"
}`;

  /**
   * findDomainByIntent — 根据用户意图匹配领域
   *
   * 如果配置了 callLLM，优先使用 LLM 进行语义匹配。
   * LLM 不可用时回退到关键词匹配。
   *
   * @param intent - 用户输入文本
   * @returns 匹配到的 DomainManifest 或 null
   */
  async findDomainByIntent(intent: string): Promise<DomainManifest | null> {
    // 优先 LLM 匹配
    try {
      const result = await this.findDomainByIntentLLM(intent);
      if (result) return result;
    } catch (err) {
      console.warn('[DomainClusterManager] LLM 意图匹配失败，回退到关键词:', (err as Error).message);
    }

    // 回退：关键词匹配
    return this.findDomainByIntentKeyword(intent);
  }

  /**
   * findDomainsByIntent — 查找所有匹配的领域（含匹配度）
   *
   * @param intent - 用户输入文本
   * @param threshold - 最低匹配阈值（仅关键词匹配时生效）
   * @returns 匹配的领域清单列表（按匹配度降序）
   */
  async findDomainsByIntent(intent: string, threshold: number = 0): Promise<Array<{ manifest: DomainManifest; score: number }>> {
    // 优先使用 LLM 返回多个领域
    try {
      const prompt = `分析以下用户输入，列出所有可能相关的领域（从可用列表中选）：

用户输入: "${intent}"

可用领域：
${this.getDomainContextText()}

请严格按 JSON 格式返回，只返回匹配的领域 ID 数组：
{"domains": ["domain_id_1", "domain_id_2"], "reasoning": "简短理由"}`;

      const raw = await LLMProvider.get()(prompt);
      const jsonMatch = raw.match(/{[\s\S]*}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.domains && Array.isArray(data.domains)) {
          const results: Array<{ manifest: DomainManifest; score: number }> = [];
          for (const domainId of data.domains) {
            const cluster = this.clusters.get(domainId);
            if (cluster) {
              results.push({ manifest: cluster.manifest, score: 1.0 });
            }
          }
          if (results.length > 0) return results;
        }
      }
    } catch (err) {
      console.warn('[DomainClusterManager] LLM 多领域匹配失败，回退到关键词:', (err as Error).message);
    }

    // 回退：关键词匹配
    return this.findDomainsByIntentKeyword(intent, threshold);
  }

  /**
   * findDomainByIntentLLM — 使用 LLM 进行语义意图匹配
   *
   * @param intent - 用户输入文本
   * @returns 匹配到的 DomainManifest 或 null
   */
  private async findDomainByIntentLLM(intent: string): Promise<DomainManifest | null> {
    const domainContext = this.getDomainContextText();
    const systemPrompt = DomainClusterManager.INTENT_MATCH_SYSTEM_PROMPT.replace('{availableDomains}', domainContext || '无已注册领域');

    const raw = await LLMProvider.get()(intent, systemPrompt);

    // 解析 JSON 响应
    const jsonMatch = raw.match(/{[\s\S]*}/);
    if (!jsonMatch) {
      console.warn('[DomainClusterManager] LLM 返回非 JSON 格式:', raw.substring(0, 100));
      return null;
    }

    try {
      const data = JSON.parse(jsonMatch[0]);
      if (data.domain_id && typeof data.domain_id === 'string' && data.domain_id !== 'null') {
        const cluster = this.clusters.get(data.domain_id);
        if (cluster) return cluster.manifest;
      }
      return null;
    } catch (err) {
      console.warn('[DomainClusterManager] LLM 意图 JSON 解析失败:', (err as Error).message);
      return null;
    }
  }

  /**
   * getDomainContextText — 生成领域列表文本（供 LLM prompt 使用）
   */
  getDomainContextText(): string {
    const domains = this.getAllClusters().map(c => c.manifest);
    return domains.map(d =>
      `- domain_id: "${d.domain_id}", name: "${d.domain_name}", 唤醒词: ${d.wake_conditions.intent_patterns.join(', ')}`
    ).join('\n');
  }

  /**
   * findDomainByIntentKeyword — 关键词意图匹配（回退方案）
   */
  private findDomainByIntentKeyword(intent: string): DomainManifest | null {
    const lower = intent.toLowerCase();
    let bestMatch: DomainManifest | null = null;
    let bestScore = 0;

    for (const cluster of this.clusters.values()) {
      const patterns = cluster.manifest.wake_conditions.intent_patterns;
      let score = 0;

      for (const pattern of patterns) {
        if (lower.includes(pattern.toLowerCase())) {
          score += 1;
        }
      }

      // 归一化分数
      score = patterns.length > 0 ? score / patterns.length : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cluster.manifest;
      }
    }

    return bestMatch;
  }

  /**
   * findDomainsByIntentKeyword — 查找所有匹配的领域（关键词版）
   */
  private findDomainsByIntentKeyword(intent: string, threshold: number = 0): Array<{ manifest: DomainManifest; score: number }> {
    const lower = intent.toLowerCase();
    const results: Array<{ manifest: DomainManifest; score: number }> = [];

    for (const cluster of this.clusters.values()) {
      const patterns = cluster.manifest.wake_conditions.intent_patterns;
      let score = 0;

      for (const pattern of patterns) {
        if (lower.includes(pattern.toLowerCase())) {
          score += 1;
        }
      }

      score = patterns.length > 0 ? score / patterns.length : 0;

      if (score >= threshold) {
        results.push({ manifest: cluster.manifest, score });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getCluster — 获取指定领域的集群
   */
  getCluster(domainId: string): DomainCluster | undefined {
    return this.clusters.get(domainId);
  }

  /**
   * getActiveClusters — 获取所有活跃领域集群
   */
  getActiveClusters(): DomainCluster[] {
    return [...this.clusters.values()].filter(c => c.status === 'active');
  }

  /**
   * getSleepingClusters — 获取所有休眠领域集群
   */
  getSleepingClusters(): DomainCluster[] {
    return [...this.clusters.values()].filter(c => c.status === 'sleeping');
  }

  /**
   * getAllClusters — 获取所有已注册的领域集群
   */
  getAllClusters(): DomainCluster[] {
    return [...this.clusters.values()];
  }

  /**
   * getStatusReports — 获取所有领域集群的状态报告
   */
  getStatusReports(): ClusterStatusReport[] {
    return [...this.clusters.values()].map(c => c.getStatusReport());
  }

  /**
   * getRegisteredDomainIds — 获取所有已注册的领域 ID
   */
  getRegisteredDomainIds(): string[] {
    return [...this.clusters.keys()];
  }

  /**
   * getActiveCount — 获取活跃集群数量
   */
  get activeCount(): number {
    return this.getActiveClusters().length;
  }

  /**
   * get registeredCount — 获取已注册集群数量
   */
  get registeredCount(): number {
    return this.clusters.size;
  }

  /**
   * hasDomain — 检查领域是否已注册
   */
  hasDomain(domainId: string): boolean {
    return this.clusters.has(domainId);
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * findOldestActiveCluster — 查找最久未使用的活跃集群
   *
   * @param excludeDomainId - 排除的领域 ID
   */
  private findOldestActiveCluster(excludeDomainId?: string): DomainCluster | undefined {
    const active = this.getActiveClusters().filter(
      c => c.manifest.domain_id !== excludeDomainId,
    );

    if (active.length === 0) return undefined;

    // 按唤醒时间升序（最早唤醒的最久未使用）
    return active.sort((a, b) => a.uptime - b.uptime)[0];
  }
}
