/**
 * primitiveAgentTools — 领域原语 → AgentTool 桥（多 Agent 框架 P0b）
 *
 * 会话 3 架构：step-agent（执行肢）通过 agentSpawner 创建，在 LLM 工具调用循环中
 * 调用【原语工具】knowledge/file/shell/api/artifact。本文件将 DomainPrimitiveRegistry
 * 的 5 个通用原语包装为 pi-agent-core AgentTool（含可执行 execute），
 * 使 Agent 声明工具后能真正调用原语执行。
 *
 * 数据流：
 *   StepAgentExecutor.executeStep()
 *     → createPrimitiveAgentTools({ departmentId })
 *     → agentSpawner.spawn({ tools })
 *     → pi-agent-core Agent 工具调用循环 → 原语 execute() → 结果回填 Agent
 *
 * @packageDocumentation
 */

import type { AgentTool, AgentToolResult } from '../adapters/pi-bridge/index.js';
import { DomainPrimitiveRegistry } from './DomainPrimitiveRegistry.js';
import type { KnowledgeContextPackage } from '../../gate/context.js';

export interface PrimitiveToolOptions {
  /** 部门 ID（原语部门隔离，必传） */
  departmentId?: string;
  /** 用户 ID（可选） */
  userId?: string;
  /**
   * Gate 凭证（会话 4 执行肢解锁）：orchestrator 经 Gate 两阶段签发后传入，
   * 使破坏性原语（file write / shell / api POST）凭有效凭证通过 gateDestructive 硬校验。
   */
  gateContext?: KnowledgeContextPackage;
}

/** 原语 → AgentTool 名称映射（name 为原语注册名） */
const PRIMITIVE_TOOL_DEFS: Array<{ name: string; label: string }> = [
  { name: 'knowledge_query', label: 'knowledge' },
  { name: 'file_operation', label: 'file' },
  { name: 'shell_execution', label: 'shell' },
  { name: 'api_call', label: 'api' },
  { name: 'artifact_generation', label: 'artifact' },
];

/**
 * createPrimitiveAgentTools — 将 5 个通用原语包装为 AgentTool 列表
 *
 * @param options - 部门/用户上下文（原语执行注入）
 * @returns 可直接传给 agentSpawner.spawn 的 AgentTool[]
 */
export function createPrimitiveAgentTools(options: PrimitiveToolOptions = {}): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const def of PRIMITIVE_TOOL_DEFS) {
    const primitive = DomainPrimitiveRegistry.get(def.name);
    if (!primitive) continue; // 原语未注册（测试环境可能只注册部分）→ 跳过

    tools.push({
      name: def.label,
      label: primitive.name,
      description: primitive.description,
      parameters: primitive.inputSchema ?? { type: 'object', properties: {} },
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        const result = await primitive.execute((params ?? {}) as Record<string, unknown>, {
          departmentId: options.departmentId,
          userId: options.userId,
          // ⬅️ 会话 4：Gate 凭证透传——破坏性原语凭有效凭证通过 gateDestructive 硬校验
          gateContext: options.gateContext,
        });
        const text = result.success
          ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? null))
          : `[primitive:${primitive.name} failed] ${result.error ?? 'unknown error'}`;
        return {
          content: [{ type: 'text', text }],
          isError: !result.success,
          details: { primitive: primitive.name, requiresApproval: result.requiresApproval ?? false },
        };
      },
    });
  }

  return tools;
}

/** 便捷函数：列出当前可用的原语 AgentTool 名称（诊断用） */
export function listPrimitiveAgentToolNames(): string[] {
  return createPrimitiveAgentTools().map(t => t.name);
}
