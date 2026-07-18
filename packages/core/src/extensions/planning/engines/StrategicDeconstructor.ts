/**
 * StrategicDeconstructor — 层次化战略拆解器
 *
 * v2 MetaPlanner 的第一认知引擎。
 *
 * 定位：
 *   在 DAG Generator 运行前介入。结合 KnowledgeGraph 与 ArtifactRegistry，
 *   将宏观意图拆解为高维度的"里程碑（Milestones）"骨架约束。
 *
 * 执行流程：
 *   1. 接收 PrePlanContext（用户输入、标签、会话信息）
 *   2. 查询 KnowledgeGraph：搜索与意图相关的实体和关系
 *   3. 查询 ArtifactRegistry：获取历史产物作为参考
 *   4. 综合分析，生成 Milestone[]
 *   5. 将 Milestones 注入 enrichedContext，供 DAG Generator 参考
 *
 * 设计原则：
 *   - KnowledgeGraph 和 ArtifactRegistry 为可选项，不可用时优雅降级
 *   - 只产生建议性约束（Milestones），不强制修改 DAG 拓扑
 *   - 所有操作只读，不对 KnowledgeGraph 或 ArtifactRegistry 做任何写入
 */

import type { IPlanningExtension } from './IPlanningExtension.js';
import type {
  PrePlanContext,
  PrePlanResult,
  PostPlanContext,
  PostPlanResult,
  Milestone,
} from '../types.js';

/**
 * StrategicDeconstructor — 层次化战略拆解器
 */
export class StrategicDeconstructor implements IPlanningExtension {
  public readonly name = 'StrategicDeconstructor';
  public readonly version = '2.0.0';
  public readonly priority = 10; // 在 V1CapabilityAdapter 之后执行
  public enabled = true;

  /** 知识图谱引用（可选） */
  private knowledgeGraph: any;
  /** 产物注册表引用（可选） */
  private artifactRegistry: any;

  constructor(config?: {
    knowledgeGraph?: any;
    artifactRegistry?: any;
    enabled?: boolean;
  }) {
    if (config?.knowledgeGraph) this.knowledgeGraph = config.knowledgeGraph;
    if (config?.artifactRegistry) this.artifactRegistry = config.artifactRegistry;
    if (config?.enabled !== undefined) this.enabled = config.enabled;
  }

  /**
   * onPrePlan — 执行战略拆解
   *
   * @param context - 计划前上下文
   * @returns 包含 Milestones 的 PrePlanResult
   */
  async onPrePlan(context: PrePlanContext): Promise<PrePlanResult> {
    if (!this.enabled) return {};

    const { userInput, tags, executionId } = context;
    const milestones: Milestone[] = [];

    try {
      // Step 1: 查询 KnowledgeGraph 获取相关实体
      const kgEntities = await this.queryKnowledgeGraph(userInput, tags);

      // Step 2: 查询 ArtifactRegistry 获取相关产物
      const registryArtifacts = await this.queryArtifactRegistry(tags);

      // Step 3: 综合分析，生成里程碑
      if (kgEntities.length > 0 || registryArtifacts.length > 0) {
        const derivedMilestones = this.deriveMilestones(
          kgEntities,
          registryArtifacts,
          userInput,
          tags,
          executionId,
        );
        milestones.push(...derivedMilestones);
      }

      // Step 4: 如果没有任何数据源可用，使用标签推断基本里程碑
      if (milestones.length === 0) {
        const fallbackMilestones = this.inferMilestonesFromTags(tags, executionId);
        milestones.push(...fallbackMilestones);
      }

    } catch (err: any) {
      console.warn(`[StrategicDeconstructor] 拆解过程异常: ${err.message}，使用标签推断`);
      const fallbackMilestones = this.inferMilestonesFromTags(tags, executionId);
      milestones.push(...fallbackMilestones);
    }

    // 构建 enrichedContext（string[] 类型，每行一个注入提示）
    const contextLines: string[] = [
      `[StrategicDeconstructor] 拆解出 ${milestones.length} 个里程碑`,
    ];
    for (const ms of milestones) {
      contextLines.push(`[Milestone] ${ms.name} (领域: ${ms.domain}, 优先级: ${ms.priority})`);
    }

    return {
      enrichedContext: contextLines,
      milestones,
    };
  }

  /**
   * onPostPlan — 当前无操作（战略拆解不关注 DAG 生成后阶段）
   */
  async onPostPlan(_context: PostPlanContext): Promise<PostPlanResult> {
    return {};
  }

  // ── 内部查询方法 ──

  /**
   * queryKnowledgeGraph — 从知识图谱获取相关实体
   *
   * 使用用户输入和标签搜索知识图谱中的实体和关系。
   * 如果 KnowledgeGraph 不可用，优雅降级返回空数组。
   */
  private async queryKnowledgeGraph(userInput: string, tags: string[]): Promise<any[]> {
    if (!this.knowledgeGraph) return [];

    try {
      const results: any[] = [];

      // 1. 按标签搜索实体
      if (typeof this.knowledgeGraph.searchEntities === 'function') {
        const taggedEntities = this.knowledgeGraph.searchEntities({
          text: userInput,
          tags,
          limit: 20,
        });
        if (Array.isArray(taggedEntities)) {
          results.push(...taggedEntities);
        }
      }

      // 2. 按文本搜索
      if (typeof this.knowledgeGraph.searchEntities === 'function') {
        const textEntities = this.knowledgeGraph.searchEntities({
          text: userInput,
          limit: 10,
        });
        if (Array.isArray(textEntities)) {
          for (const entity of textEntities) {
            if (!results.find((e: any) => e.id === entity.id)) {
              results.push(entity);
            }
          }
        }
      }

      return results;
    } catch (err: any) {
      console.warn(`[StrategicDeconstructor] KnowledgeGraph 查询异常: ${err.message}`);
      return [];
    }
  }

  /**
   * queryArtifactRegistry — 从产物注册表获取相关历史产物
   *
   * 如果 ArtifactRegistry 不可用，优雅降级返回空数组。
   */
  private async queryArtifactRegistry(tags: string[]): Promise<any[]> {
    if (!this.artifactRegistry) return [];

    try {
      const results: any[] = [];

      // 按领域/标签搜索产物
      if (typeof this.artifactRegistry.listByDomain === 'function') {
        for (const tag of tags) {
          try {
            const domainArtifacts = this.artifactRegistry.listByDomain(tag);
            if (Array.isArray(domainArtifacts)) {
              results.push(...domainArtifacts);
            }
          } catch {
            // 单个领域查询失败不影响其他
          }
        }
      }

      return results.slice(0, 30); // 最多取 30 个
    } catch (err: any) {
      console.warn(`[StrategicDeconstructor] ArtifactRegistry 查询异常: ${err.message}`);
      return [];
    }
  }

  // ── 里程碑推导方法 ──

  /**
   * deriveMilestones — 从知识图谱实体和产物记录推导里程碑
   *
   * 核心拆解逻辑：
   *   1. 按 domain 对实体分组
   *   2. 每个 domain 生成一个里程碑
   *   3. 根据实体之间的关系确定里程碑间的依赖
   *   4. 参考历史产物确定 expectedArtifacts
   */
  private deriveMilestones(
    entities: any[],
    artifacts: any[],
    userInput: string,
    tags: string[],
    executionId: string,
  ): Milestone[] {
    const milestoneMap = new Map<string, Milestone>();
    const domainSet = new Set<string>();

    // 1. 从实体中提取领域信息
    for (const entity of entities) {
      const domain = entity.domainId ?? entity.domain ?? 'default';
      domainSet.add(domain);
    }

    // 2. 从产物中提取领域信息
    for (const artifact of artifacts) {
      const domain = artifact.domain ?? artifact.domainId ?? 'default';
      domainSet.add(domain);
    }

    // 3. 为每个领域生成里程碑
    let index = 0;
    const domainList = [...domainSet];

    for (const domain of domainList) {
      index++;
      const domainEntities = entities.filter((e: any) =>
        (e.domainId ?? e.domain ?? 'default') === domain,
      );
      const domainArtifacts = artifacts.filter((a: any) =>
        (a.domain ?? a.domainId ?? 'default') === domain,
      );

      const milestoneId = `ms_${executionId}_${domain}_${Date.now()}`;
      const milestone: Milestone = {
        id: milestoneId,
        name: this.inferMilestoneName(domain, domainEntities),
        description: this.inferMilestoneDescription(domain, domainEntities, domainArtifacts, userInput),
        domain,
        expectedArtifacts: this.inferExpectedArtifacts(domain, domainArtifacts, tags),
        priority: index === 0 ? 10 : Math.max(1, 10 - index), // 第一个领域最高优先级
        dependsOn: index > 1 ? domainList.slice(0, index - 1).map((d, i) =>
          `ms_${executionId}_${d}_${Date.now()}`
        ) : [],
        constraints: {
          sourceEntityCount: domainEntities.length,
          referenceArtifactCount: domainArtifacts.length,
        },
      };

      milestoneMap.set(domain, milestone);
    }

    // 4. 如果没有识别出任何领域，创建一个通用里程碑
    if (milestoneMap.size === 0) {
      const milestoneId = `ms_${executionId}_general_${Date.now()}`;
      const milestone: Milestone = {
        id: milestoneId,
        name: this.inferMilestoneName('general', entities),
        description: `通用战略里程碑：${userInput.slice(0, 100)}`,
        domain: 'general',
        expectedArtifacts: tags.length > 0 ? tags.map(t => `${t}_report`) : ['analysis_report'],
        priority: 5,
        dependsOn: [],
        constraints: {},
      };
      milestoneMap.set('general', milestone);
    }

    return [...milestoneMap.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * inferMilestonesFromTags — 从标签推断基本里程碑（兜底策略）
   */
  private inferMilestonesFromTags(tags: string[], executionId: string): Milestone[] {
    const milestones: Milestone[] = [];

    // 为每个标签生成一个里程碑
    const domainPriority: Record<string, number> = {
      'ai_ml': 10,
      'web_dev': 9,
      'mobile': 8,
      'data_engineering': 7,
      'devops': 6,
      'security': 8,
      'testing': 5,
      'hardware': 7,
      'startup': 9,
      'design': 6,
      'build': 8,
      'analyze': 7,
      'fix': 6,
      'optimize': 7,
      'deploy': 5,
      'general': 3,
    };

    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const milestone: Milestone = {
        id: `ms_${executionId}_${tag}_${Date.now()}`,
        name: `${tag} 领域分析`,
        description: `基于标签 "${tag}" 推断的战略里程碑`,
        domain: tag,
        expectedArtifacts: [`${tag}_analysis`, `${tag}_plan`],
        priority: domainPriority[tag] ?? 5,
        dependsOn: i > 0 ? tags.slice(0, i).map(t =>
          `ms_${executionId}_${t}_${Date.now()}`
        ) : [],
        constraints: { source: 'tag_inference' },
      };
      milestones.push(milestone);
    }

    return milestones;
  }

  // ── 辅助推断方法 ──

  /**
   * inferMilestoneName — 推断里程碑名称
   */
  private inferMilestoneName(domain: string, entities: any[]): string {
    if (entities.length > 0) {
      // 使用实体名称前缀作为里程碑名称
      const topEntity = entities[0];
      const entityName = topEntity.name ?? topEntity.type ?? domain;
      return `${entityName} 分析与实施`;
    }
    return `${domain} 领域里程碑`;
  }

  /**
   * inferMilestoneDescription — 推断里程碑描述
   */
  private inferMilestoneDescription(
    domain: string,
    entities: any[],
    artifacts: any[],
    userInput: string,
  ): string {
    const parts: string[] = [];
    parts.push(`领域: ${domain}`);

    if (entities.length > 0) {
      parts.push(`关联 ${entities.length} 个知识实体`);
    }
    if (artifacts.length > 0) {
      parts.push(`参考 ${artifacts.length} 个历史产物`);
    }
    parts.push(`目标: ${userInput.slice(0, 80)}`);

    return parts.join(' | ');
  }

  /**
   * inferExpectedArtifacts — 推断期望产物
   */
  private inferExpectedArtifacts(
    domain: string,
    artifacts: any[],
    tags: string[],
  ): string[] {
    // 1. 从历史产物中提取产物类型
    const artifactTypes = new Set<string>();
    for (const artifact of artifacts) {
      const type = artifact.type ?? artifact.artifactType ?? '';
      if (type) artifactTypes.add(type);
    }

    // 2. 从标签推断产物类型
    const tagArtifactMap: Record<string, string[]> = {
      'ai_ml': ['model_card', 'training_data', 'evaluation_report'],
      'web_dev': ['architecture_diagram', 'api_spec', 'frontend_code', 'backend_code'],
      'data_engineering': ['data_pipeline', 'schema_definition', 'etl_script'],
      'devops': ['deployment_config', 'ci_pipeline', 'infrastructure_code'],
      'security': ['security_audit', 'threat_model', 'compliance_report'],
      'testing': ['test_plan', 'test_report', 'coverage_report'],
      'startup': ['market_analysis', 'business_plan', 'mvp_roadmap'],
      'design': ['design_spec', 'prototype', 'ux_research'],
    };

    const fromTags = new Set<string>();
    for (const tag of tags) {
      const mapped = tagArtifactMap[tag];
      if (mapped) {
        for (const item of mapped) {
          fromTags.add(item);
        }
      }
    }

    // 合并：历史产物类型优先，标签推断补充
    const combined = [...artifactTypes, ...fromTags];
    return combined.slice(0, 8);
  }
}
