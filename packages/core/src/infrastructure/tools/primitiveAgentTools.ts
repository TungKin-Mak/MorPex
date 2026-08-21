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
import { createAskUserTool, setAskEventBus } from '../../execution/UserAskService.js';
import { getMailbox } from '../../execution/AgentMailbox.js';

/** 工具参数 schema 窄接口（inputSchema：JSON Schema 子集，仅用 required/properties 类型；
 *  会话 15 扩展 examples/minLength/additionalProperties 供 TypeBox 校验与 LLM 提示） */
interface ToolInputSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string; examples?: unknown[]; minLength?: number }>;
  additionalProperties?: boolean;
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
  /**
   * 会话 12：沙箱工作目录——step-agent 的产物/命令工作基准目录（如 data/agent-workspace/<stepId>/），
   * 防止工具写到仓库根（实测污染：开发设计规划/XC8P9530_main.c）。
   * file 工具 write 用相对/缺省 path 时落到此目录；shell 工具 cwd 缺省时指向此目录。
   */
  workspaceDir?: string;
  /**
   * 会话 13：step 目标（goal/description）——knowledge 工具 query 缺失时用它兜底
   * （step 目标即要查的内容），解决思考模式空参导致的 12/40 失败。
   */
  goal?: string;
  /**
   * 会话 16j（B2 指针消费端）：按 taskRef 拉取历史任务上下文（装配「可拉取详情」指针的消费端）。
   * 注入后 expose `recall_task` 工具——模型可据此拉回被预算裁剪的历史详情（零丢失闭环）。
   * 返回精简上下文文本；null/异常 → 工具返回失败（不阻断）。
   */
  recallTask?: (taskRef: string) => Promise<string | null>;
  /** 17i.15：EventBus（注册 ask_user 工具：LLM 自主决策问用户，暂停等回答）。 */
  eventBus?: import('../../infrastructure/common/EventBus.js').EventBus;
  /** 17i.15：所属会话 ID（ask_user 问题归属，前端按会话呈现）。 */
  sessionId?: string;
  /** P2：跨部门/工位交流（mail 原语）上下文——调用发起方角色与归属。eventBus + mailboxCtx 齐备才注册 mail 工具。 */
  mailboxCtx?: { from: string; spaceId?: string; taskId?: string; goal?: string };
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
 * 会话 15（工具可靠性 P0）：工具 schema 强化元数据。
 * - examples：每个必填参数给真实调用示例（LLM 知道填什么格式）
 * - minLengthFields：自由文本参数加 minLength:1（空串""在 pi-ai TypeBox 校验层即被拒绝，
 *   报精确错误回填 LLM——根治思考模式空参问题的第一道闸）
 * 注：knowledge query 不设 minLength——空 query 由 createPrimitiveBeforeToolCall 用 step goal 兜底注入。
 */
const TOOL_SCHEMA_ENRICH: Record<string, { examples?: Record<string, unknown[]>; minLengthFields?: string[] }> = {
  knowledge: {
    examples: {
      query: ['查询公司的技术栈与产品线', '查询 MCU 项目的历史交付记录', '查询电商订单数据模型'],
    },
  },
  shell: {
    examples: {
      command: ['ls -la', 'node build.js', 'mkdir -p dist && cp -r src dist/'],
    },
    minLengthFields: ['command'],
  },
  api: {
    examples: {
      url: ['https://api.example.com/v1/items'],
      method: ['GET', 'POST'],
    },
    // method 为 enum（空值已被枚举校验覆盖）→ 不设 minLength，避免冗余
    minLengthFields: ['url'],
  },
  file: {
    examples: {
      operation: ['read', 'write', 'list'],
      path: ['docs/report.md', 'src/main.ts'],
      content: ['# 标题\n正文内容…'],
    },
    minLengthFields: ['operation', 'path'],
  },
  artifact: {
    examples: {
      type: ['report', 'code', 'doc', 'config', 'data'],
      specification: ['生成一份产品需求文档，包含背景、目标、功能清单与验收标准'],
    },
    minLengthFields: ['type', 'specification'],
  },
};

/** 空串/空值判断（空参问题的统一判定） */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
}

/**
 * enrichSchemaForTool — 强化原语 inputSchema 为 AgentTool 工具 schema
 * - 顶层 additionalProperties: false（省略必填/多余参数即 TypeBox 校验报错）
 * - 必填字符串参数加 minLength:1（空串被 TypeBox 拒绝，报精确错误回填 LLM）
 * - 必填参数加 examples（LLM 知道填什么格式）
 */
function enrichSchemaForTool(label: string, schema: ToolInputSchema): ToolInputSchema {
  if (!schema || typeof schema !== 'object') return schema;
  const enrich = TOOL_SCHEMA_ENRICH[label];
  const props = { ...(schema.properties ?? {}) };
  const required = schema.required ?? [];
  if (enrich) {
    for (const field of required) {
      const prop = props[field];
      if (!prop || typeof prop !== 'object') continue;
      const p = { ...prop };
      if (enrich.examples?.[field]?.length) p.examples = enrich.examples[field];
      if (enrich.minLengthFields?.includes(field) && (p.type === 'string' || p.type === undefined)) p.minLength = 1;
      props[field] = p;
    }
  }
  return { ...schema, type: 'object', properties: props, required, additionalProperties: false };
}

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

/** 必填参数缺失 → 精确重新调用指引（agent 循环 self-healing 用，含工具专属示例） */
export function buildMissingParamMessage(toolLabel: string, missing: string[]): string {
  // 工具专属正确调用示例（提高 opencode 重发成功率；shell/api 无法用 goal 兜底，示例尤其关键）
  const EXAMPLES: Record<string, string> = {
    shell: `正确示例：${'{"command":"ls -la","cwd":"<工作目录>"}'}`,
    api: `正确示例：${'{"url":"https://example.com/api","method":"GET"}'}`,
    knowledge: `正确示例：${'{"query":"<要查询的具体问题>"}'}`,
    file: `正确示例：${'{"operation":"write","path":"<文件相对路径>","content":"<内容>"}'}`,
    artifact: `正确示例：${'{"type":"report","specification":"<产物要求>"}'}`,
  };
  const example = EXAMPLES[toolLabel];
  return `工具 ${toolLabel} 调用参数不完整：${missing.join('；')}。${example ? `\n${example}\n` : ''}请【重新调用】${toolLabel} 工具，一次调用填全所有必需参数，不要留空、不要省略。`;
}

/**
 * createPrimitiveAgentTools — 将 5 个通用原语包装为 AgentTool 列表
 *
 * @param options - 部门/用户上下文（原语执行注入）
 * @returns 可直接传给 agentSpawner.spawn 的 AgentTool[]
 */
/**
 * ═══ 会话 16l·7（通用空参保险）：本地扩展类型——在类型系统不识别 AgentTool.prepareArguments
 *     （bundler 模式下 pi-ai Tool 基类遮蔽）时，仍声明该字段供构建。运行时 pi-agent-core
 *     prepareToolCallArguments 读取 tool.prepareArguments（运行时属性，与类型无关）。
 */
interface PrimitiveAgentTool extends AgentTool {
  prepareArguments?: (args: unknown) => unknown;
}

export function createPrimitiveAgentTools(options: PrimitiveToolOptions = {}): AgentTool[] {
  const tools: PrimitiveAgentTool[] = [];

  for (const def of PRIMITIVE_TOOL_DEFS) {
    const primitive = DomainPrimitiveRegistry.get(def.name);
    if (!primitive) continue; // 原语未注册（测试环境可能只注册部分）→ 跳过
    const schema = enrichSchemaForTool(def.label, (primitive.inputSchema ?? {}) as ToolInputSchema);

    tools.push({
      name: def.label,
      label: primitive.name,
      description: primitive.description,
      parameters: schema,
      // ═══ 会话 16l·7（通用空参保险 L0）：prepareArguments——在 schema 校验之前运行，
      //     用任务上下文智能填充可推断参数。模型无关（不依赖 LLM 是否乖乖填参，MorPex 主动兜底），
      //     对任意模型（含 GLM 等老模型）生效。不可推断的参数保持原样 → 由 L1 校验报错强制重发。
      prepareArguments: (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        // knowledge：query 缺失/空 → 注入 step goal（step 目标即要查的内容）
        if (def.label === 'knowledge' && isEmptyValue(args.query) && options.goal) {
          args.query = options.goal;
          console.warn(`[primitiveAgentTools] 🛡️ 通用保险：knowledge query 为空 → 注入 step goal 兜底: ${String(options.goal).slice(0, 60)}…`);
        }
        // file：path 缺失/空且有沙箱目录 → 注入默认路径（相对路径落沙箱）
        if (def.label === 'file' && isEmptyValue(args.path) && options.workspaceDir) {
          args.path = '.'; // 相对路径由 file 原语落沙箱
        }
        return args;
      },
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        const p = (params ?? {}) as Record<string, unknown>;
        // ═══ 会话 13：knowledge 空 query → 用 step goal 兜底（step 目标即要查的内容）═══
        // 解决思考模式空参导致的失败（审计 12/40 为 query 空）。其余原语空参无法安全推断 → 保持错误。
        if (def.label === 'knowledge' && !p.query && options.goal) {
          p.query = options.goal;
          console.warn(`[primitiveAgentTools] 🔄 knowledge query 为空 → 用 step goal 兜底: ${String(options.goal).slice(0, 60)}…`);
        }
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
          // ⬅️ 会话 12：沙箱工作目录（file/shell 默认落此，防写仓库根）
          workspaceDir: options.workspaceDir,
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

  // ═══ 会话 16j（B2 指针消费端）：追加 recall_task 工具（按 taskRef 拉取被裁详情，零丢失闭环）═══
  const recallTool = recallTaskTool(options)
  if (recallTool) tools.push(recallTool as unknown as PrimitiveAgentTool)

  // ═══ 会话 17i.15：追加 ask_user 工具——LLM 自主决策问用户（暂停等回答，前端拟人对话呈现）═══
  if (options.eventBus) {
    setAskEventBus(options.eventBus);
    tools.push(createAskUserTool({ sessionId: options.sessionId, spaceId: options.mailboxCtx?.spaceId ?? options.departmentId, goal: options.goal }) as unknown as PrimitiveAgentTool);
  }

  // ═══ P2：追加 mail 工具——跨部门/工位真交流（step-agent 主动咨询另一工位/部门，LLM 扮演目标角色回复）═══
  if (options.eventBus && options.mailboxCtx && getMailbox()) {
    tools.push(createMailTool(options.mailboxCtx) as unknown as PrimitiveAgentTool);
  }

  // ═══ 会话 16l·7：PrimitiveAgentTool 运行时含 prepareArguments（pi-agent-core 运行时读取），
  //     类型层面以 AgentTool[] 对外（bundler 模式类型遮蔽规避）
  return tools as unknown as AgentTool[];
}
/**
 * recallTaskTool — 指针消费端工具（会话 16j B2）：按 taskRef 拉取历史任务上下文。
 * 装配层将预算裁剪的项保留 ref 拼成【可拉取详情】；本工具让 step-agent 能真正按 ref 拉回详情（零丢失闭环）。
 */
function recallTaskTool(options: PrimitiveToolOptions): AgentTool | null {
  if (!options.recallTask) return null;
  return {
    name: 'recall_task',
    label: 'recall_task',
    description: '按任务引用 ID（taskRef）拉取该历史任务的上下文详情（目标/结果/快照）。用于装配时被预算裁剪的可拉取详情。',
    parameters: {
      type: 'object',
      properties: { taskRef: { type: 'string', description: '历史任务引用 ID（形如 msn_xxx）', examples: ['msn_1786001780299_m15p'] } },
      required: ['taskRef'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskRef = typeof p.taskRef === 'string' ? p.taskRef.trim() : '';
      if (!taskRef) {
        return { content: [{ type: 'text', text: '缺失必需参数 "taskRef"，请【重新调用】recall_task 并提供 taskRef' }], isError: true };
      }
      try {
        const text = await options.recallTask!(taskRef);
        if (!text) {
          return { content: [{ type: 'text', text: `未找到 taskRef=${taskRef} 的历史上下文（可能已清理或不存在）` }], isError: true };
        }
        return { content: [{ type: 'text', text: `taskRef=${taskRef} 的上下文详情：\n${text.slice(0, 4000)}` }], isError: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `recall_task 拉取失败: ${msg}` }], isError: true };
      }
    },
  };
}

/**
 * createPrimitiveBeforeToolCall — 工具执行前钩子（会话 15 工具可靠性 P0）
 *
 * 挂载到 pi-agent-core AgentHarness 的 beforeToolCall（经 PiBridge/agent-spawner 透传）。
 * 在 pi-ai TypeBox schema 校验通过后、原语 execute 执行前触发：
 *   1. knowledge query 空 → 用 step goal 兜底注入（思考模式空参主因之一，query 空 12/40 失败）
 *   2. 其余工具必填空参 → 返回 { block: true, reason } 拦截本次调用，reason 作为错误结果回填 LLM，
 *      强制其【补全参数重新调用】（根治"LLM 拿错误后放弃工具转输出文本"的空参空转）
 *
 * @param options - 与 createPrimitiveAgentTools 同源上下文（goal 供 knowledge 兜底）
 */
export function createPrimitiveBeforeToolCall(options: PrimitiveToolOptions = {}): (
  params: { toolCallId: string; toolName: string; args: Record<string, unknown> },
) => Promise<{ block?: boolean; reason?: string } | undefined> {
  // 按工具 label 索引原语 schema（与工具创建同源，校验口径一致）
  const schemas = new Map<string, ToolInputSchema>();
  for (const def of PRIMITIVE_TOOL_DEFS) {
    const primitive = DomainPrimitiveRegistry.get(def.name);
    if (primitive) schemas.set(def.label, (primitive.inputSchema ?? {}) as ToolInputSchema);
  }

  return async (params: { toolCallId: string; toolName: string; args: Record<string, unknown> }): Promise<{ block?: boolean; reason?: string } | undefined> => {
    const { toolName, args } = params;
    const p = (args ?? {}) as Record<string, unknown>;

    // 1. knowledge query 空 → step goal 兜底注入（在 schema 校验通过后、execute 前，直接改 args 引用）
    if (toolName === 'knowledge' && isEmptyValue(p.query) && options.goal) {
      p.query = options.goal;
      console.warn(`[primitiveAgentTools] 🔄 beforeToolCall: knowledge query 为空 → 注入 step goal 兜底: ${String(options.goal).slice(0, 60)}…`);
      return undefined;
    }

    // 2. 其余工具必填空参 → block + 精确重发指令（强制 LLM 补全重发，不靠 LLM 自觉）
    const schema = schemas.get(toolName);
    if (schema?.required?.length) {
      const missing = validateRequiredParams(p, schema);
      if (missing.length > 0) {
        const reason = buildMissingParamMessage(toolName, missing);
        console.warn(`[primitiveAgentTools] ⛔ beforeToolCall 拦截空参工具调用（${toolName}）: ${reason}`);
        return { block: true, reason };
      }
    }
    return undefined;
  };
}

/** 便捷函数：列出当前可用的原语 AgentTool 名称（诊断用） */
export function listPrimitiveAgentToolNames(): string[] {
  return createPrimitiveAgentTools().map(t => t.name);
}

/**
 * createMailTool — P2 跨部门/工位交流工具（LLM 扮演目标角色回复，阻塞等 reply）。
 * 指导 LLM：当步骤需要另一工位/部门的专业信息时调用（如问采购部预算、问电路设计工位外设方案）。
 * 调用会暂停等待回复；任何失败/超时都降级为「按不知道继续」，绝不使任务失败。
 */
function createMailTool(ctx: { from: string; spaceId?: string; taskId?: string; goal?: string }): AgentTool {
  const mailbox = getMailbox();
  // 无实例时返回一个安全占位（不应发生：注册时已判 getMailbox()）
  const sayUnavailable = (): AgentToolResult => ({
    content: [{ type: 'text', text: '[mail 不可用] 未配置 AgentMailbox，按「不知道」继续。' }],
    isError: false,
  });
  return {
    name: 'mail',
    label: 'mail',
    description:
      '跨工位/部门咨询工具：当你的步骤需要另一工位（station:xxx）或部门（dept:xxx）的专业信息时调用。' +
      '例如：问采购部预算（to="dept:hardware"）、问电路设计工位外设方案（to="station:circuit_design"）。' +
      '传入对方角色 to 与具体问题 question，对方会回复。调用会暂停等待回复，收到后继续执行。',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '目标角色：station:<工位名> 或 dept:<部门工作流id>，如 station:circuit_design、dept:hardware。' },
        question: { type: 'string', description: '咨询问题（请具体、对方可回答）。' },
      },
      required: ['to', 'question'],
    },
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
      if (!mailbox) return sayUnavailable();
      const p = (params ?? {}) as Record<string, unknown>;
      const to = String(p.to ?? '').trim();
      const question = String(p.question ?? '').trim();
      if (!to || !question) {
        return { content: [{ type: 'text', text: '[mail] 缺少必填参数：to、question。请补全后重新调用。' }], isError: true };
      }
      try {
        const reply = await mailbox.sendAndWait({
          from: ctx.from,
          to,
          question,
          spaceId: ctx.spaceId,
          taskId: ctx.taskId,
          goal: ctx.goal,
        });
        return { content: [{ type: 'text', text: `[${to} 回复] ${reply}` }], isError: false };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `[mail 失败] ${err instanceof Error ? err.message : String(err)}，按「不知道」继续。` }],
          isError: false,
        };
      }
    },
  };
}
