/**
 * AgentFactory — Agent 实例唯一工厂（v2.4 纯净新系统）
 *
 * 所有 Agent 创建必须通过此工厂。
 *
 * v3.x 重构：所有 pi-agent-core 直接依赖已隔离到 AgentSpawnerAdapter，
 * 此文件不再直接 import pi 包。
 */

import { config } from '../../config/MorPexConfig.js';
import { agentSpawner } from '../adapters/agent-spawner.js';
import type { AgentTool } from '../adapters/agent-spawner.js';

/** 安全边界异常 — Agent 创建校验失败时抛出 */
export class SecurityBoundaryException extends Error {
  constructor(reason: string) {
    super(`[SecurityBoundary] ${reason}`);
    this.name = 'SecurityBoundaryException';
  }
}

/** Agent 创建上下文 — 所有字段必填校验 */
export interface AgentSpawnContext {
  /** 调用方身份令牌（必填） */
  identityToken: string;
  /** Cgroup 配额引用（必填） */
  cgroupQuota: { tokenLimit: number; usedTokens: number };
  /** 领域 ID */
  domainId?: string;
  /** 角色: 0=Leader, 1=Expert, 2=Fork */
  ring: 0 | 1 | 2;
  /** 工具集 */
  tools?: AgentTool[];
  /** 系统提示词 */
  systemPrompt?: string;
  /** 模型提供商（默认 deepseek） */
  provider?: string;
  /** 模型 ID（默认 deepseek-v4-flash） */
  modelId?: string;
}

/**
 * AgentFactory — Agent 唯一工厂
 *
 * 用法：
 *   const harness = await AgentFactory.spawn({
 *     identityToken: 'exe_a1b2c3',
 *     cgroupQuota: { tokenLimit: 2_000_000, usedTokens: 0 },
 *     ring: 1,
 *     systemPrompt: compileExpertPrompt({...}),
 *   });
 */
export class AgentFactory {
  /**
   * spawn — 创建 AgentHarness（唯一入口）
   *
   * @throws SecurityBoundaryException 校验失败时
   */
  async spawn(context: AgentSpawnContext): Promise<any> {
    // 硬编码强校验 — 无降级路径
    if (!context.identityToken) {
      throw new SecurityBoundaryException('缺少 IdentityToken，拒绝创建 Agent');
    }
    if (!context.cgroupQuota) {
      throw new SecurityBoundaryException('缺少 CgroupQuota，拒绝创建 Agent');
    }
    if (context.cgroupQuota.usedTokens >= context.cgroupQuota.tokenLimit) {
      throw new SecurityBoundaryException(
        `Cgroup 配额耗尽 (used: ${context.cgroupQuota.usedTokens}, limit: ${context.cgroupQuota.tokenLimit})`
      );
    }

    return agentSpawner.spawn({
      identityToken: context.identityToken,
      ring: context.ring,
      tools: context.tools ?? [],
      systemPrompt: context.systemPrompt ?? '你是一个有用的助手。',
      provider: context.provider,
      modelId: context.modelId,
      domainId: context.domainId,
    });
  }
}

/** 全局单例 — 必须在 bootstrap 阶段初始化 */
let _factory: AgentFactory | null = null;

/**
 * setAgentFactory — 设置 AgentFactory 全局单例（bootstrap 阶段调用）
 */
export function setAgentFactory(factory: AgentFactory): void {
  _factory = factory;
}

/**
 * getAgentFactory — 获取 AgentFactory 全局单例
 *
 * @throws SecurityBoundaryException 如果未初始化
 */
export function getAgentFactory(): AgentFactory {
  if (!_factory) {
    throw new SecurityBoundaryException('AgentFactory 未初始化，请在 bootstrap 阶段调用 setAgentFactory()');
  }
  return _factory;
}
