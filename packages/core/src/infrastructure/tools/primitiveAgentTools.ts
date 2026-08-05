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

/** 工具参数 schema 窄接口（inputSchema：JSON Schema 子集，仅用 required/properties 类型） */
interface ToolInputSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string }>;
}
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
 * validateRequiredParams — 按 inputSchema.required 校验工具调用参数
 *
 * 会话 9 实测：GLM 思考模式下工具调用参数间歇性为空（query/url/command 不能为空，19/99 失败主因）。
 * 校验：必填字段缺失/为空 → 返回**精确可执行的重新调用指引**（告诉模型缺哪个字段、什么类型、
 * 期望的 JSON 形态），供 agent 循环重新调用（self-healing），而非把空参传给原语直接抛错。
 *
 * @returns 空数组 = 校验通过；非空 = 缺失字段错误消息列表
 */
export function validateRequiredParams(params: Record<string, unknown>, schema?: ToolInputSchema): string[] {
  if (!schema?.required || schema.required.length === 0) return [];
  const errors: string[] = [];
  for (const field of schema.required) {
    const v = params[field];
    const isEmpty = v === undefined || v === null || v === '' ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) {
      const prop = schema.properties?.[field];
      const type = prop?.type ?? 'string';
      const hint = prop?.description ? `（${prop.description}）` : '';
      errors.push(`缺失必需参数 "${field}"（类型 ${type}）${hint}`);
    }
  }
  return errors;
}

/** 必填参数缺失 → 精确重新调用指引（agent 循环 self-healing 用） */
export function buildMissingParamMessage(toolLabel: string, missing: string[]): string {
  return `工具 ${toolLabel} 调用参数不完整：${missing.join('；')}。请【重新调用】${toolLabel} 工具，并提供完整必需参数（一次调用填全，不要留空）。`;
}

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
    const schema = (primitive.inputSchema ?? {}) as ToolInputSchema;

    tools.push({
      name: def.label,
      label: primitive.name,
      description: primitive.description,
      parameters: schema,
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        const p = (params ?? {}) as Record<string, unknown>;
        // ═══ 会话 9：必填参数校验——空参不传给原语，返回精确重新调用指引（self-healing）═══
        const missing = validateRequiredParams(p, schema);
        if (missing.length > 0) {
          const text = buildMissingParamMessage(def.label, missing);
          console.warn(`[primitiveAgentTools] ⚠️ ${text}`);
          return {
            content: [{ type: 'text', text }],
            isError: true,
            details: { primitive: primitive.name, missingParams: missing, requiresApproval: false },
          };
        }

        const result = await primitive.execute(p, {
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
