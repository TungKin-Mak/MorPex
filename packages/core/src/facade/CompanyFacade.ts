/**
 * CompanyFacade — CEO 高层操作入口（v16 Unified）
 *
 * ═══ 硬管道 ═══
 * - Runtime 与 ControlPlane 构造时强制（NODE_ENV=production 旧签名抛错）
 * - executeGoal: ControlPlane.checkAll() + RunOptions 透传
 * - sendTask: 委托 executeGoal（不跳过门禁）
 */

import { DepartmentManager } from '../governance/control-plane/DepartmentManager.js';
import { RoleRegistry } from '../governance/control-plane/RoleRegistry.js';
import type { Department, DepartmentStats } from '../governance/control-plane/department-types.js';
import type { CreateDepartmentParams } from '../governance/control-plane/department-types.js';
import type { GoalContext } from '../infrastructure/protocol/contracts/goal.js';
import type { MorPexRuntime, RunOptions } from '../execution/runtime/MorPexRuntime.js';
import type { ControlPlane } from '../governance/control-plane/ControlPlane.js';
// ═══ 去黑盒化（L0 任务摘要，方案定义层首次落地）═══
import { getSharedDeblackboxRecorder } from '../infrastructure/observability/deblackbox/DeblackboxRecorder.js';
import { IntentClassifier } from '../cognition/planning/goal-intelligence/IntentClassifier.js';
import { CHAT_REPLY_SYSTEM } from '../cognition/prompts/company-prompts.js';

type LLMProviderFn = (system: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;

export interface ExecuteGoalOptions {
  simulationHardFail?: boolean;
  ontologyHardFail?: boolean;
  awaitApproval?: boolean;
  approvalTimeoutMs?: number;
  departmentName?: string;
  departmentId?: string;
  createIfMissing?: boolean;
  /** P1 部门 Space：部门经理 persona（路由选中部门后注入编排器） */
  managerPersona?: string;
  /** P1 部门 Space：工位能力提示 */
  capabilities?: string[];
  /**
   * P1 部门 Space：意图预判提示（chat/send 已用 IntentClassifier 判过一次，避免二次判断不一致）。
   * 缺省：executeGoal 自行判断（现状）。
   */
  intentHint?: 'chat' | 'task';
  /** 预估成本（用于资源检查） */
  estimatedCost?: number;
  /** T0 多轮连续：orchestrator 账本路径（存在时 resume 同一本账，多轮对话历史不丢；由 StudioServer 按 chatSessionId resolve） */
  orchestratorSessionPath?: string;
  [key: string]: unknown;
}

export class CompanyFacade {
  private departmentManager: DepartmentManager;
  private roleRegistry: RoleRegistry;
  private runtime!: MorPexRuntime;
  private controlPlane!: ControlPlane;
  private ceoId: string;
  private _bootstrapped = false;

  constructor(
    departmentManager: DepartmentManager,
    roleRegistry: RoleRegistry,
    runtimeOrCeoId: MorPexRuntime | string,
    controlPlane?: ControlPlane,
    ceoId: string = 'ceo-default',
  ) {
    if (!departmentManager) throw new Error('[CompanyFacade] DepartmentManager 是必填参数');
    if (!roleRegistry) throw new Error('[CompanyFacade] RoleRegistry 是必填参数');
    this.departmentManager = departmentManager;
    this.roleRegistry = roleRegistry;

    if (typeof runtimeOrCeoId === 'object' && runtimeOrCeoId !== null) {
      // 新签名 — 强制
      this.runtime = runtimeOrCeoId as MorPexRuntime;
      if (!controlPlane) throw new Error('[CompanyFacade] ControlPlane 是必填参数');
      this.controlPlane = controlPlane;
      this.ceoId = ceoId;
    } else {
      // 旧签名 — 生产环境抛错，开发环境警告 + 懒自举
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[CompanyFacade] 生产环境禁止旧 3 参数构造签名。请使用 bootstrapUnified()');
      }
      console.warn('[CompanyFacade] ⚠️ 使用旧 3 参数构造签名（仅开发/测试允许），建议改为新 5 参数签名');
      this.ceoId = (runtimeOrCeoId as string) || ceoId;
    }
  }

  /**
   * ensureBootstrapped — 惰性自举（仅旧构造签名需要）
   * 注意：不 await container.ready 会导致 EventStore 竞态
   */
  private async ensureBootstrapped(): Promise<void> {
    if (this._bootstrapped) return;
    this._bootstrapped = true;
    if (!this.runtime) {
      const { ServiceContainer } = await import('../execution/runtime/ServiceContainer.js');
      const c = new ServiceContainer();
      await c.ready; // ⬅️ 关键修复：等待 EventStore 就绪
      this.runtime = c.runtime;
      this.controlPlane = c.controlPlane;
    }
  }

  async createDepartment(name: string, options?: { type?: 'template' | 'project'; templateName?: string; description?: string }): Promise<Department> {
    const params: CreateDepartmentParams = { name, type: options?.type ?? 'template', templateName: options?.templateName, description: options?.description, ceoId: this.ceoId };
    const dept = await this.departmentManager.createDepartment(params);
    this.roleRegistry.defineRole({ name: 'ceo', departmentId: dept.id, agentId: this.ceoId, capabilities: ['manage', 'oversee', 'assign'], permissions: ['read', 'write', 'admin'] });
    console.log(`[CompanyFacade] ✅ 部门 "${dept.name}" 已创建（ID: ${dept.id}）`);
    return dept;
  }

  private brainFacade: any = null;
  private teamOrchestrator: { listTeams(): unknown[]; getTeam(id: string): unknown } | null = null;
  private llmProvider: LLMProviderFn | null = null;
  private goalIntelligence: { understandGoal(goal: string, ctx?: Record<string, unknown>): Promise<{ intent?: 'chat' | 'task' }> } | null = null;

  /** 注入 LLM 提供器（意图判别 + 闲聊直答；bootstrap 装配调用） */
  setLLMProvider(fn: LLMProviderFn): void {
    this.llmProvider = fn;
  }

  /** 17i.32：注入流式闲聊生成器（bootstrap 装配；逐 token onDelta，返回完整文本）。 */
  private chatStreamer: ((system: string, prompt: string, onDelta: (d: string) => void) => Promise<string>) | null = null;
  setChatStreamer(fn: (system: string, prompt: string, onDelta: (d: string) => void) => Promise<string>): void {
    this.chatStreamer = fn;
  }

  /** 功能③：上下文组装引擎（可选注入，无则跳过——零风险） */
  private contextAssemblyEngine: import('../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine | null = null;

  /** 功能③：注入上下文组装引擎（bootstrap 装配调用） */
  setContextAssemblyEngine(engine: import('../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine): void {
    this.contextAssemblyEngine = engine;
  }

  /**
   * sendTask — 委托 executeGoal（不跳过 ControlPlane 门禁）
   */
  async sendTask(departmentName: string, task: string): Promise<{ ok: boolean; message: string; departmentId?: string }> {
    const result = await this.executeGoal(task, { departmentName });
    return {
      ok: result.ok,
      message: result.ok ? `✅ 任务已路由到部门「${departmentName}」` : `❌ 失败: ${result.error || '未知错误'}`,
      departmentId: result.executionId ?? result.goalContext?.goalId,
    };
  }

  getDepartmentStatus(departmentName: string): Department | undefined { return this.departmentManager.findByName(departmentName); }
  listDepartments(): Department[] { return this.departmentManager.listDepartments('active'); }
  getStats(): { departments: DepartmentStats } { return { departments: this.departmentManager.getStats() }; }

  async executeGoal(goal: string, options: ExecuteGoalOptions = {}): Promise<{
    ok: boolean; goalContext?: GoalContext; executionId?: string; result?: unknown;
    report: string; error?: string; missionId?: string; teamId?: string;
    /** 意图模式：chat（闲聊直答）| goal（执行编排） */
    mode?: 'chat' | 'goal';
    /** L3 非 Mission 路径：规划层生成的计划信息（未介入/失败时 undefined） */
    plan?: { planId?: string; taskCount?: number; ontologyRefs?: string[] };
  }> {
    await this.ensureBootstrapped();
    console.log(`[CompanyFacade] 🎯 executeGoal: ${goal.substring(0, 80)}`);
    const startTime = Date.now();

    // ═══ 0. 意图分流：闲聊/问候 → 轻量直答（不建 Mission/团队/产物，不进 ControlPlane 门禁）═══
    //     P1：intentHint 优先生效（chat/send 已预判，避免二次判断不一致）；缺省自行判断（现状）。
    const intent = options.intentHint
      ?? (this.goalIntelligence
        ? (await this.goalIntelligence.understandGoal(goal)).intent
        : await IntentClassifier.classify(goal, this.llmProvider ?? undefined));
    if (intent === 'chat') {
      const FALLBACK = '你好！我是 MorPex，可以帮你完成各类任务，比如写代码、做分析、生成文档等。';
      let reply = FALLBACK;
      // 17i.32：优先流式生成（onDelta 由装配层转发为 chat.stream.delta → SSE）
      if (this.chatStreamer) {
        try {
          reply = (await this.chatStreamer(CHAT_REPLY_SYSTEM, goal, () => { /* onDelta 由装配层转发 */ })).trim() || FALLBACK;
        } catch (err) {
          console.warn('[CompanyFacade] ⚠️ 闲聊流式生成失败，用兜底回复:', err instanceof Error ? err.message : String(err));
        }
      } else if (this.llmProvider) {
        try {
          const r = (await this.llmProvider(CHAT_REPLY_SYSTEM, goal, { temperature: 0.7, maxTokens: 500 })).trim();
          if (r) reply = r; // 模型空回复/限流 → 保留兜底
        } catch (err) {
          console.warn('[CompanyFacade] ⚠️ 闲聊直答 LLM 失败，用兜底回复:', err instanceof Error ? err.message : String(err));
        }
      }
      console.log(`[CompanyFacade] 💬 意图=chat，闲聊直答（不走执行编排）: ${goal.substring(0, 50)}`);
      return { ok: true, report: reply, mode: 'chat' as const };
    }


    // ── 0. 部门存在性校验（先于审批门禁：不存在则不进入审批） ──
    if (options.departmentName) {
      const dept = this.departmentManager.findByName(options.departmentName);
      if (!dept) {
        return { ok: false, report: `❌ 部门 "${options.departmentName}" 不存在`, error: `部门 "${options.departmentName}" 不存在` };
      }
    }

    // ── 1. ControlPlane 全量门禁（含 options 透传） ──
    const gate = await this.controlPlane.checkAll(goal, {
      actor: this.ceoId,
      domain: options.departmentName,
      estimatedCost: options.estimatedCost ?? 100,
    });
    if (!gate.approved) {
      return { ok: false, report: `❌ ControlPlane 拒绝: ${gate.rejection || '无原因'}`, error: gate.rejection };
    }
    console.log(`  ├─ ControlPlane: 通过 (goal=${gate.goal.approved}, policy=${gate.policy?.allowed ?? true}, resource=${gate.resource?.available ?? true})`);

    // ── 2. 构造 RunOptions（执行 mode 已收敛内部化——不再透传；引擎内部 auto 选） ──
    const deptId = options.departmentName ? this.departmentManager.findByName(options.departmentName)?.id : undefined;
    const runOpts: RunOptions = {
      simulationHardFail: options.simulationHardFail ?? true,
      ontologyHardFail: options.ontologyHardFail ?? false,
      awaitApproval: options.awaitApproval ?? false,
      approvalTimeoutMs: options.approvalTimeoutMs,
      departmentId: options.departmentId ?? deptId,
      managerPersona: options.managerPersona,
      capabilities: options.capabilities,
      orchestratorSessionPath: options.orchestratorSessionPath,
    };

    // ── 3. 执行 Runtime 管线（统一入口：orchestrate 创建 Mission → MissionRuntime 内部规划/编排/执行）──
    //    功能③ 聚焦装配在 MorPexRuntime orchestrate 后统一执行（读真实 Mission 数据，taskRef=真实 missionId）
    try {
      const result = await this.runtime.run(goal, runOpts);
      const duration = Date.now() - startTime;
      const lines = [
        '='.repeat(50),
        `📋 CEO 执行报告 | ${new Date().toLocaleTimeString('zh-CN')}`,
        '='.repeat(50),
        `🎯 目标: ${goal.substring(0, 120)}`,
        `📋 Mission: ${result.context?.mission?.missionId || 'N/A'}`,
        `👥 团队: ${result.context?.team?.name || 'N/A'}`,
        `📦 产物: ${result.artifacts?.length || 0} 个`,
        `⏱ 耗时: ${duration}ms`,
        `📊 结果: ${result.ok ? '✅ 成功' : '❌ 失败'}`,
      ];
      if (result.errors.length > 0) {
        lines.push('❌ 错误:');
        result.errors.forEach(e => lines.push(`   • ${e}`));
      }
      lines.push('='.repeat(50));
      // L4 全功能实现：任务完成后喂给 Brain 学习闭环（持久化经验 + 提模式）
      if (this.brainFacade?.learn) {
        try {
          await this.brainFacade.learn({
            taskId: result.context?.executionId ?? `exec_${Date.now()}`,
            goal: goal,
            result: result.ok ? 'success' : 'failure',
            output: result.ok ? (result.executionResult as { output?: unknown })?.output ?? undefined : undefined,
            error: result.ok ? undefined : (result.errors?.[0] ?? undefined),
            duration: Date.now() - startTime,
            departmentId: runOpts.departmentId,
            capabilities: ((result.context?.capabilities as { name?: string }[] | undefined) ?? []).map((c) => c.name ?? String(c)),
          });
        } catch {
          // Brain 学习失败不阻断主流程
        }
      }
      // ═══ 去黑盒化（L0 任务摘要，永久）：任务级 目标/结果/耗时/成败（成本明细在 llm.call 决策单，按 executionId 关联）═══
      try {
        getSharedDeblackboxRecorder().record({
          category: 'task.summary',
          source: 'company-facade',
          executionId: result.context?.executionId ?? `exec_${Date.now()}`,
          level: 'L0',
          isError: !result.ok,
          summary: {
            goal: goal.substring(0, 300),
            missionId: result.context?.mission?.missionId ?? null,
            team: result.context?.team?.name ?? null,
            artifactsCount: result.artifacts?.length ?? 0,
            durationMs: Date.now() - startTime,
            success: result.ok,
            errors: result.ok ? [] : result.errors,
            departmentId: runOpts.departmentId ?? null,
            decision: result.ok ? '任务成功' : '任务失败',
            reasoning: `耗时 ${Date.now() - startTime}ms，产物 ${result.artifacts?.length ?? 0} 个${result.ok ? '' : `，错误 ${result.errors.join('; ')}`}`,
          },
        });
      } catch (err) {
        console.warn('[CompanyFacade] ⚠️ L0 任务摘要记录失败（忽略）:', err instanceof Error ? err.message : String(err));
      }
      return { ok: result.ok, goalContext: result.context?.goal, executionId: result.context?.executionId, result: result.executionResult, report: lines.join('\n'), error: result.errors[0], missionId: result.context?.mission?.missionId, teamId: result.context?.team?.id, plan: undefined, mode: 'goal' as const };
    } catch (err) {
      return { ok: false, report: `❌ Runtime 执行失败: ${(err as Error).message}`, error: (err as Error).message };
    }
  }

  async generateDailyReport(): Promise<string> {
    const now = new Date();
    const lines = ['='.repeat(50), `📊 每日运营报告 | ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`, '='.repeat(50)];
    for (const dept of this.departmentManager.listDepartments()) {
      lines.push(`  ${dept.status === 'active' ? '✅' : '⏸️'} ${dept.name} (${dept.type})`);
    }
    lines.push('\n' + '='.repeat(50));
    return lines.join('\n');
  }

  async searchAcrossDepartments(_q: string, _o?: { limit?: number; departmentFilter?: string[] }): Promise<Array<{ content: string; departmentName?: string; relevance: number }>> { return []; }

  setBrainFacade(brain: any): void { this.brainFacade = brain; }

  /** 治理：团队编排器注入（团队查询能力接线——审计发现 listTeams/getTeam 零消费） */
  setTeamOrchestrator(t: { listTeams(): unknown[]; getTeam(id: string): unknown }): void {
    this.teamOrchestrator = t;
  }

  /** 治理：列出全部团队（架构欠缺的团队查询能力，已接线） */
  getTeams(): unknown[] {
    return this.teamOrchestrator?.listTeams() ?? [];
  }

  /** 治理：按 ID 查团队 */
  getTeam(teamId: string): unknown {
    return this.teamOrchestrator?.getTeam(teamId) ?? null;
  }

  setGoalIntelligenceFacade(facade: { understandGoal(goal: string, ctx?: Record<string, unknown>): Promise<{ intent?: 'chat' | 'task' }> }): void {
    this.goalIntelligence = facade;
  }
  setFeedbackService(_: any): void {}
  setOntology(_o: any, _g: any, _p: any): void {}
  setCEO(id: string): void { this.ceoId = id; }
}

