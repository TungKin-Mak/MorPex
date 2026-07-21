/**
 * AgentCreateTool — 派生二级领域专家智能体
 *
 * Leader (Ring 0) 通过此工具动态派生 Expert (Ring 1) 领域专家。
 * 底层调用 DomainCluster.spawnSubAgent() 进行配额检查 + 工具继承。
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 类型基于 pi-agent-core 扩展
 *   0.4 (删除优先法则): 使用已有的 spawnSubAgent，不重复实现 Cgroup 逻辑
 */

import type { AgentTool, AgentToolResult as _AgentToolResult } from '../adapters/pi-types.js';
type AgentToolResultAny = _AgentToolResult;
import { Type, optionalProp } from '../adapters/pi-ai-types.js';
import { DomainCluster } from '../domains/DomainCluster.js';
import { compileExpertPrompt } from '../prompts/expert-prompt.js';
import { createAstroMTrace } from '../prompts/prompt-types.js';

/**
 * AgentCreateTool — 创建子 Agent 的 AgentTool 包装
 *
 * 用法：
 *   const tool = new AgentCreateTool(domainCluster);
 *   // 注册到 Leader Agent 的工具列表
 *   // Leader LLM 通过 tool_call 调用此工具派生专家
 */
export class AgentCreateTool implements AgentTool {
  name = 'AgentCreate';
  label = '创建子 Agent';
  description = '派生一个二级领域专家智能体，挂载双层 VFS，用于执行垂直领域任务。Leader 只能通过此工具创建专家，严禁直接操作底层工具。';

  parameters = Type.Object({
    domain: Type.String({ description: '目标领域 ID（如 hardware_engineering）' }),
    expert_name: Type.String({ description: '专家名称（如 pcb-designer、firmware-engineer）' }),
    goal: Type.String({ description: '任务目标描述' }),
    vfsMountUri: optionalProp(Type.String({ description: '产物 URI 摘要，用于惰性灌水。格式: artifact://{domain}/{type}/{id}' })),
  });

  private cluster: DomainCluster;

  constructor(cluster: DomainCluster) {
    this.cluster = cluster;
  }

  async execute(
    toolCallId: string,
    params: unknown,
    _signal?: AbortSignal,
    _onUpdate?: (data: unknown) => void,
  ): Promise<AgentToolResultAny> {
    const { domain, expert_name, goal, vfsMountUri } = (params || {}) as {
      domain: string;
      expert_name: string;
      goal: string;
      vfsMountUri?: string;
    };

    // 构建 Expert 系统提示词
    const expertPrompt = compileExpertPrompt({
      domainName: this.cluster.manifest.domain_name ?? domain,
      domainId: domain,
      goal,
      vfsMountUri: vfsMountUri ?? '无',
      timestamp: Date.now(),
    });

    // 调用 spawnSubAgent（含 Cgroup 配额检查 + 工具继承）
    const harness = await this.cluster.spawnSubAgent({
      name: expert_name,
      description: goal,
      prompt: expertPrompt,
    });

    // 构建 AstroM trace
    const trace = createAstroMTrace(
      `domain_cluster_${this.cluster.manifest.domain_id}`,
      domain,
      'tool_call',
    );

    return {
      content: [{
        type: 'text' as const,
        text: `✅ 已派生专家 "${expert_name}"（领域: ${domain}）\n任务: ${goal}\n${vfsMountUri ? `VFS 挂载: ${vfsMountUri}` : ''}`,
      }],
      details: {
        success: true,
        expertName: expert_name,
        domain,
        goal,
        vfsMountUri,
        harnessSessionId: (harness as any)?.session?.id,
        astro_m_trace: trace,
      },
    };
  }
}

/**
 * createAgentCreateTool — AgentCreateTool 工厂函数
 */
export function createAgentCreateTool(cluster: DomainCluster): AgentCreateTool {
  return new AgentCreateTool(cluster);
}
