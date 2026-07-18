/**
 * AgentService — AgentHarness 实例生命周期管理（精简版）
 *
 * v2.4 迁移：所有子 Agent 创建必须通过 AgentFactory.spawn()。
 * 此类仅保留通用工具方法（getEnv/getModel）和 Expert 创建转发。
 *
 * v3.x 重构：所有 pi 包直接依赖已隔离到适配层。
 */

import { agentSpawner } from '../adapters/agent-spawner.js';
import { piModelRegistry } from '../adapters/model-registry.js';
import { createKnowledgeGraphSkill } from '../tools/knowledge-graph-skill.js';
import { createArtifactRegistrySkill } from '../tools/artifact-registry-skill.js';
import { KnowledgeGraph } from '../planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import type { DomainCluster } from '../domains/DomainCluster.js';
import { compileExpertPrompt } from '../prompts/expert-prompt.js';

/** AgentHarness 创建选项 */
export interface AgentServiceOptions {
  provider?: string;
  modelId?: string;
  systemPrompt?: string;
}

/**
 * AgentService — AgentHarness 管理器
 *
 * 仅用于创建 Expert 级 AgentHarness 和获取运行时环境。
 * 所有 Agent 创建已收敛至 AgentFactory.spawn()。
 */
export class AgentService {
  private env: any;
  private defaultSystemPrompt: string;
  private knowledgeGraph?: KnowledgeGraph;
  private artifactRegistry?: ArtifactRegistry;

  constructor(options?: AgentServiceOptions & {
    knowledgeGraph?: KnowledgeGraph;
    artifactRegistry?: ArtifactRegistry;
  }) {
    this.env = agentSpawner.createEnv();
    this.defaultSystemPrompt = options?.systemPrompt ?? '你是一个有用的助手。';
    this.knowledgeGraph = (options as any)?.knowledgeGraph;
    this.artifactRegistry = (options as any)?.artifactRegistry;
  }

  /**
   * createExpertHarness — 创建 Expert 级 AgentHarness（v2.4 推荐路径）
   *
   * 委托给 DomainCluster.spawnSubAgent()，经过 Cgroup 配额检查 + Expert 提示词注入。
   */
  async createExpertHarness(
    cluster: DomainCluster,
    params: {
      name: string;
      description: string;
      goal: string;
      vfsMountUri?: string;
    },
  ): Promise<any> {
    const expertPrompt = compileExpertPrompt({
      domainName: cluster.manifest.domain_name ?? params.name,
      domainId: cluster.manifest.domain_id,
      goal: params.goal,
      vfsMountUri: params.vfsMountUri ?? '无',
      timestamp: Date.now(),
    });

    return cluster.spawnSubAgent({
      name: params.name,
      description: params.description,
      prompt: expertPrompt,
    });
  }

  /**
   * 释放所有 Expert 资源
   */
  async disposeAll(): Promise<void> {
    // AgentService 不再直接持有 harness，全部由 AgentFactory 管理
  }

  getEnv(): any {
    return this.env;
  }

  getModel(): any {
    return piModelRegistry.getDefaultModel();
  }
}
