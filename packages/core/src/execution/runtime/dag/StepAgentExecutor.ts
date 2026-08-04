/**
 * StepAgentExecutor — DAG 节点 step-agent 执行器（多 Agent 框架 P0c）
 *
 * 会话 3 架构落点：DAG 节点（总大脑拆分的 step）由【step-agent + 执行肢】执行，
 * 取代原先 ExecutionFabric 的单次 LLM 生成（无工具调用能力 → 生成类任务空转/卡死）。
 *
 * 执行流程：
 *   1. 组装 step-agent systemPrompt（职责 + 原语工具使用守则 + 知识优先原则）
 *   2. 注入上游成果（P1：upstreamResults → prompt 上下文）
 *   3. agentSpawner.spawn 创建执行肢（pi-agent-core Agent：LLM 思考 + 工具调用循环）
 *   4. prompt(node.description) 执行 → 提取最终输出
 *   5. 失败/Agent 不可用 → fallbackExecutor（ExecutionFabric 单次 LLM 生成）降级
 *
 * 输出形态（MVP）：文本（step-agent 的最终总结/产物说明）。
 * 产物落盘由 agent 通过 artifact_generation 原语工具完成。
 *
 * @packageDocumentation
 */

import { agentSpawner } from '../../../infrastructure/adapters/agent-spawner.js';
import { createPrimitiveAgentTools } from '../../../infrastructure/tools/primitiveAgentTools.js';
import type { AgentTool } from '../../../infrastructure/adapters/pi-bridge/index.js';

/** DAG 节点的窄接口（避免依赖 DAG 内部类型） */
export interface StepNodeInfo {
  id: string;
  name: string;
  description: string;
  agentType: string;
}

export interface StepAgentExecutorOptions {
  /** 部门 ID（原语隔离 + 知识路由） */
  departmentId?: string;
  /** 总目标（上下文锚点） */
  goal?: string;
  /** 额外注入的工具（叠加在原语工具之上） */
  extraTools?: AgentTool[];
  /**
   * 兜底执行器：Agent spawn/执行失败时降级（单次 LLM 生成）。
   * 不传时失败直接返回（由上层决定重试/失败）。
   */
  fallbackExecutor?: (node: StepNodeInfo, upstreamText: string) => Promise<unknown>;
  /** 是否禁用 Agent（纯 fallback 模式，测试用） */
  agentDisabled?: boolean;
}

export interface StepAgentResult {
  success: boolean;
  /** 执行模式：'agent' = step-agent 工具循环 ｜ 'fallback' = 单次 LLM 生成 */
  mode: 'agent' | 'fallback';
  output?: unknown;
  error?: string;
  duration: number;
}

/** 组装 step-agent 系统提示词 */
function buildStepSystemPrompt(node: StepNodeInfo, opts: StepAgentExecutorOptions): string {
  return [
    '你是一名 MorPex step-agent，负责完成总大脑分配给你的一个执行步骤。',
    `【本步骤职责】${node.name}`,
    node.description ? `【职责详情】${node.description}` : '',
    opts.goal ? `【总目标】${opts.goal}` : '',
    '',
    '【工作守则】',
    '1. 知识优先：任何生成/创建前，先用 knowledge 工具查询知识库；查询有结果再行动。',
    '2. 使用工具完成动手工作：file 读写文件、shell 执行命令、api 调用接口、artifact 生成产物。',
    '3. artifact 工具负责把最终产物落盘（代码/文档/数据/报告），并报告产物路径与内容摘要。',
    '4. 完成后输出：最终交付摘要（含产物路径、关键决策、遗留风险），格式精炼。',
    '5. 若某工具不可用或失败，说明原因并尝试替代方案，不要假装成功。',
    '',
    '输出格式要求：最后以 "## 交付摘要" 开头输出最终总结。',
  ].filter(Boolean).join('\n');
}

/** 序列化上游成果（Map<nodeId, output> → 文本） */
function formatUpstreamResults(upstreamResults: Map<string, unknown> | Record<string, unknown> | undefined): string {
  if (!upstreamResults) return '';
  const entries = upstreamResults instanceof Map ? [...upstreamResults.entries()] : Object.entries(upstreamResults);
  if (entries.length === 0) return '';
  const lines = entries.map(([id, out]) => {
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? null);
    return `### 上游节点 ${id}\n${text}`;
  });
  return `\n\n【上游步骤成果（供你参考，是你的输入）】\n${lines.join('\n\n')}`;
}

/**
 * StepAgentExecutor — step-agent 节点执行器
 */
export class StepAgentExecutor {
  private opts: StepAgentExecutorOptions;

  constructor(opts: StepAgentExecutorOptions = {}) {
    this.opts = opts;
  }

  /**
   * executeStep — 执行单个 DAG 节点（step-agent + 执行肢）
   *
   * @param node - 节点信息（name/description/agentType）
   * @param upstreamResults - 上游节点成果（nodeId → output，P1）
   */
  async executeStep(
    node: StepNodeInfo,
    upstreamResults?: Map<string, unknown> | Record<string, unknown>,
  ): Promise<StepAgentResult> {
    const start = Date.now();
    const upstreamText = formatUpstreamResults(upstreamResults);

    // ── 降级路径：Agent 禁用/未就绪 → fallback（单次 LLM 生成）──
    if (this.opts.agentDisabled) {
      return this.runFallback(node, upstreamText, start);
    }

    try {
      const tools = [
        ...createPrimitiveAgentTools({ departmentId: this.opts.departmentId }),
        ...(this.opts.extraTools ?? []),
      ];

      const agent = await agentSpawner.spawn({
        identityToken: `step-agent:${node.id}`,
        ring: 0,
        tools,
        systemPrompt: buildStepSystemPrompt(node, this.opts),
        domainId: this.opts.departmentId ?? 'general',
      });

      const input = [
        `请开始执行本步骤。${node.description ? `\n\n${node.description}` : ''}`,
        upstreamText,
        '\n\n请按守则执行并给出交付摘要。',
      ].join('\n');

      const res = await agent.prompt(input);
      const text = extractText(res.content);

      if (!text.trim()) {
        throw new Error('[StepAgentExecutor] Agent 返回空内容');
      }

      return {
        success: true,
        mode: 'agent',
        output: { text: text.trim(), nodeId: node.id, agentType: node.agentType },
        duration: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[StepAgentExecutor] ⚠️ step-agent 执行失败（${msg}），降级 fallback`);
      return this.runFallback(node, upstreamText, start);
    }
  }

  private async runFallback(node: StepNodeInfo, upstreamText: string, start: number): Promise<StepAgentResult> {
    if (!this.opts.fallbackExecutor) {
      return {
        success: false,
        mode: 'fallback',
        error: '[StepAgentExecutor] Agent 不可用且未配置 fallbackExecutor',
        duration: Date.now() - start,
      };
    }
    try {
      const output = await this.opts.fallbackExecutor(node, upstreamText);
      return { success: true, mode: 'fallback', output, duration: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, mode: 'fallback', error: msg, duration: Date.now() - start };
    }
  }
}

/** 从 Agent prompt 返回的 content 中提取文本 */
export function extractText(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => (c as { text: string }).text)
    .join('\n')
    .trim();
}
