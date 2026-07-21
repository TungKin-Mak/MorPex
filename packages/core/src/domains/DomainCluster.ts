/**
 * DomainCluster — 领域知识+工具提供者
 *
 * ★ v3.2 多Session架构改造：剥离 harness 管理
 *
 * DomainCluster 不再管理 AgentHarness 生命周期。
 * Harness 由 SessionManager 统一管理，DomainCluster 只提供：
 *   - 领域技能工具（Skill Tool）
 *   - 领域 system prompt
 *   - 工具链组装（buildTools）
 *
 * 生命周期（仅状态追踪，不含 harness 创建/销毁）：
 *   sleeping ──[wake()]──→ waking ──→ active
 *      ↑                                    │
 *      └─────────[sleep()]──────────────────←┘
 *
 * Phase 3.1 (Cgroup): Token 配额管理 + 子 Agent 工具继承。
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 所有类型基于 pi-ai/pi-agent-core 扩展
 *   0.4 (删除优先法则): 不对已有 pi 功能做二次封装
 */

import type { AgentTool } from '../adapters/pi-types.js';
import {
  createInMemorySessionRepo,
  createNodeExecutionEnv,
  resolveModel,
  createAgentHarness,
  type AgentHarness,
  type InMemorySessionRepo,
} from '../adapters/domain-cluster.js';
import type { DomainManifest, ClusterStatus, ClusterStatusReport } from './types.js';
// LLMProvider, extractJson removed in v2.4 (decomposeSingleIntent/SubIntent deleted)
import { compileExpertPrompt } from '../prompts/expert-prompt.js';
import { ForkExecuteTool } from '../tools/ForkExecuteTool.js';
import { AgentCreateTool } from '../tools/AgentCreateTool.js';
import { TeamSayTool, type AgentRegistry } from '../tools/TeamSayTool.js';
import { ReadArtifactTool } from '../tools/ReadArtifactTool.js';
import { createAskUserTool } from '../tools/ask-user-tool.js';
import type { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';

/**
 * DomainCluster — 领域集群
 *
 * ★ v3.2 不再管理 harness，只提供领域知识与工具。
 * 支持动态拉起（wake）和休眠释放（sleep）。
 * 支持 Cgroup 配额管理（Phase 3.1）。
 */
export class DomainCluster {
  readonly manifest: DomainManifest;

  /** Skill 工具池 */
  private _skillPool: Map<string, AgentTool> = new Map();
  /** 当前状态 */
  private _status: ClusterStatus = 'sleeping';
  /** 唤醒时间戳 */
  private _wokenAt: number = 0;
  /** 任务计数器 */
  private _taskCount: number = 0;
  /** 内存 session repo（仅供 spawnSubAgent 使用） */
  private repo: InMemorySessionRepo;
  /** Cgroup: Token 配额上限（默认 2,000,000） */
  // @VALIDATE-TODO: 硬编码配额值，应从 DomainManifest 读取
  private _tokenQuota: number = 2_000_000;
  /** Cgroup: 已使用 Token 数 */
  private _usedTokens: number = 0;
  /** Cgroup: 当前活跃子 Agent 数 */
  private _subAgentCount: number = 0;
  /** Cgroup: 最大并发子 Agent 数 */
  private _maxSubAgents: number = 5;
  /** 子 Agent 注册表 */
  private _subAgentRegistry: Map<string, AgentHarness> = new Map();
  /** 外部依赖注入 */
  private deps: {
    builtinTools?: AgentTool[];
    artifactRegistry?: ArtifactRegistry;
    agentRegistry?: AgentRegistry;
  };

  /** 状态变化回调 */
  onStatusChange: ((status: ClusterStatus, prevStatus: ClusterStatus) => void) | null = null;
  /** 子 Agent 创建回调 */
  onSubAgentCreated: ((name: string, harness: AgentHarness) => void) | null = null;
  /** 节点执行中需要用户输入时的回调：接收问题文本，返回用户回复的 Promise */
  onUserInputNeeded: ((question: string, harnessId: string, taskId?: string, options?: string[]) => Promise<string>) | null = null;
  /** 当前执行的 ask_user handler（每次 execute 前设置） */
  _askHandler: ((question: string, options?: string[]) => Promise<string>) | null = null;
  /** DomainDispatcher 执行节点前设置当前 taskId，供 onUserInputNeeded 使用 */
  _currentTaskId: string = '';

  constructor(
    manifest: DomainManifest,
    deps?: {
      builtinTools?: AgentTool[];
      artifactRegistry?: ArtifactRegistry;
      agentRegistry?: AgentRegistry;
    },
    tokenQuota?: number,
  ) {
    this.manifest = manifest;
    this._tokenQuota = tokenQuota ?? 2_000_000;
    this.deps = deps ?? {};
    this.repo = createInMemorySessionRepo();
  }

  // ═══════════════════════════════════════════════════════════════
  // Properties
  // ═══════════════════════════════════════════════════════════════

  get status(): ClusterStatus { return this._status; }
  get skillPool(): Map<string, AgentTool> { return new Map(this._skillPool); }
  get taskCount(): number { return this._taskCount; }
  get uptime(): number {
    return this._status === 'active' ? Date.now() - this._wokenAt : 0;
  }
  get tokenQuota(): number { return this._tokenQuota; }
  get usedTokens(): number { return this._usedTokens; }
  get subAgentCount(): number { return this._subAgentCount; }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期管理
  // ═══════════════════════════════════════════════════════════════

  async wake(): Promise<void> {
    if (this._status !== 'sleeping') {
      console.log(`[DomainCluster:${this.manifest.domain_id}] 当前状态 ${this._status}，无需唤醒`);
      return;
    }
    const prevStatus = this._status;
    this._status = 'waking';
    this.onStatusChange?.(this._status, prevStatus);
    console.log(`[DomainCluster:${this.manifest.domain_id}] 正在唤醒...`);

    try {
      await this.loadSkills();
      this._wokenAt = Date.now();
      const prev2 = this._status;
      this._status = 'active';
      this.onStatusChange?.(this._status, prev2);
      console.log(`[DomainCluster:${this.manifest.domain_id}] ✅ 已唤醒 (active)`);
    } catch (err: unknown) {
      console.error(`[DomainCluster:${this.manifest.domain_id}] ❌ 唤醒失败:`, (err as Error).message);
      this._status = 'sleeping';
      this.onStatusChange?.(this._status, 'waking');
      throw err;
    }
  }

  async sleep(): Promise<void> {
    if (this._status === 'sleeping') return;
    const prevStatus = this._status;
    this._status = 'draining';
    this.onStatusChange?.(this._status, prevStatus);
    console.log(`[DomainCluster:${this.manifest.domain_id}] 正在休眠...`);

    try {
      this._skillPool.clear();
      const prev2 = this._status;
      this._status = 'sleeping';
      this.onStatusChange?.(this._status, prev2);
      console.log(`[DomainCluster:${this.manifest.domain_id}] 💤 已休眠`);
    } catch (err: unknown) {
      console.error(`[DomainCluster:${this.manifest.domain_id}] ❌ 休眠失败:`, (err as Error).message);
      this._status = prevStatus;
      this.onStatusChange?.(this._status, 'draining');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 任务执行（★ v3.2 接收外部 harness）
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — 使用外部 harness 执行任务
   *
   * ★ v3.2 改造：不再自建 harness，由调用方传入
   *
   * @param goal - 任务目标
   * @param harness - 外部 AgentHarness（由 SessionManager 创建）
   */
  async execute(goal: string, harness: AgentHarness): Promise<any> {
    if (!harness) {
      throw new Error(`[DomainCluster:${this.manifest.domain_id}] 缺少 harness`);
    }
    this._taskCount++;

    // 桥接：ask_user 工具 → onUserInputNeeded 回调
    const harnessId = `${this.manifest.domain_id}_${Date.now()}`;
    this._askHandler = (question: string, options?: string[]) => {
      if (this.onUserInputNeeded) {
        return this.onUserInputNeeded(question, harnessId, this._currentTaskId, options);
      }
      return Promise.resolve('');
    };

    try {
      return await harness.prompt(goal);
    } finally {
      this._askHandler = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 工具链构建（★ v3.2 新增）
  // ═══════════════════════════════════════════════════════════════

  /**
   * buildTools — 构建完整工具链
   *
   * 供 SessionManager.ensureHarness() 调用。
   * 组装领域技能 + 内置工具 + 通信工具。
   */
  async buildTools(): Promise<AgentTool[]> {
    // 确保技能已加载
    if (this._skillPool.size === 0 && this.manifest.skills.length > 0) {
      await this.loadSkills();
    }

    const askUserTool = createAskUserTool(
      (question: string, _hid: string, opts?: string[]) => this._askHandler?.(question, opts) ?? Promise.resolve(''),
      `${this.manifest.domain_id}`
    );

    return [
      ...(this.deps.builtinTools ?? []),
      ...this._skillPool.values(),
      askUserTool,
      new AgentCreateTool(this),
      new TeamSayTool(this.deps.agentRegistry ?? new Map(), this.manifest.domain_id),
      new ReadArtifactTool(this.deps.artifactRegistry!),
    ] as AgentTool[];
  }

  // decomposeSingleIntent / decomposeSubIntent removed in v2.4 (superseded by CrossDomainRouter Single-Shot)

  // ═══════════════════════════════════════════════════════════════
  // Cgroup: Token 配额管理 (Phase 3.1)
  // ═══════════════════════════════════════════════════════════════

  setTokenQuota(quota: number): void {
    this._tokenQuota = quota;
  }

  getTokenQuota(): number {
    return this._tokenQuota;
  }

  getUsedTokens(): number {
    return this._usedTokens;
  }

  consumeTokens(amount: number): boolean {
    if (this._usedTokens + amount > this._tokenQuota) return false;
    this._usedTokens += amount;
    return true;
  }

  resetTokens(): void {
    this._usedTokens = 0;
    this._subAgentCount = 0;
  }

  hasTokenCapacity(estimatedTokens: number): boolean {
    return this._usedTokens + estimatedTokens <= this._tokenQuota;
  }

  /**
   * spawnSubAgent — 在配额内创建子 Agent
   *
   * 配额检查 + 工具继承（manifest.allowedTools 白名单 ∩ 减去 manifest.disallowedTools）。
   * 子 Agent 的工具链不可由 LLM 指定。
   */
  async spawnSubAgent(params: {
    name: string;
    description: string;
    prompt: string;
    estimatedTokens?: number;
  }): Promise<AgentHarness> {
    const estimated = params.estimatedTokens ?? 10000;

    // 1. 配额检查
    if (!this.hasTokenCapacity(estimated)) {
      throw new Error(
        `[Cgroup] Domain ${this.manifest.domain_id} token 配额不足 (used: ${this._usedTokens}, quota: ${this._tokenQuota}, need: ${estimated})`,
      );
    }

    // 2. 并发检查
    if (this._subAgentCount >= this._maxSubAgents) {
      throw new Error(
        `[Cgroup] Domain ${this.manifest.domain_id} 子 Agent 并发上限 (${this._subAgentCount}/${this._maxSubAgents})`,
      );
    }

    // 3. 工具继承：白名单 ∩ 排除黑名单
    const allowedToolNames = new Set(this.manifest.allowedTools ?? []);
    const disallowedToolNames = new Set(this.manifest.disallowedTools ?? []);
    let tools: AgentTool[] = [];
    if (allowedToolNames.size > 0) {
      tools = [...this._skillPool.values()]
        .filter(t => allowedToolNames.has(t.name) && !disallowedToolNames.has(t.name));
    } else {
      tools = [...this._skillPool.values()]
        .filter(t => !disallowedToolNames.has(t.name));
    }

    // 4. 注入 ForkExecute 工具
    const toolsWithFork = [...tools, new ForkExecuteTool()] as AgentTool[];

    // 5. 创建子 Agent（仍使用内部 repo + AgentHarness）
    const sessionId = `sub_${params.name}_${Date.now()}`;
    const session = await this.repo.create({ id: sessionId });
    const systemPrompt = this.buildSubAgentPrompt(params);
    const env = createNodeExecutionEnv();
    const modelStr = this.manifest.master_agent_config.model || 'deepseek-v4-flash';
    const modelParts = modelStr.split('/');
    const provider = modelParts.length > 1 ? modelParts[0] : 'deepseek';
    const modelId = modelParts.length > 1 ? modelParts[1] : modelParts[0];
    const model = resolveModel(provider, modelId);
    const harness = createAgentHarness({
      env,
      model,
      session,
      tools: toolsWithFork,
      systemPrompt,
    });

    this._subAgentRegistry.set(params.name, harness);
    this._subAgentCount++;
    this._usedTokens += estimated;
    this.onSubAgentCreated?.(params.name, harness);

    console.log(
      `[Cgroup:${this.manifest.domain_id}] 🧬 子 Agent "${params.name}" 已创建 (count: ${this._subAgentCount}/${this._maxSubAgents}, tokens: ${this._usedTokens}/${this._tokenQuota})`,
    );

    return harness;
  }

  /**
   * getSubAgent — 获取已创建的子 Agent
   */
  getSubAgent(name: string): AgentHarness | undefined {
    return this._subAgentRegistry.get(name);
  }

  /**
   * releaseSubAgent — 释放子 Agent（回收配额）
   */
  async releaseSubAgent(name: string, tokensUsed?: number): Promise<void> {
    const harness = this._subAgentRegistry.get(name);
    if (harness) {
      await harness.abort().catch(() => {});
      this._subAgentRegistry.delete(name);
    }
    this._subAgentCount = Math.max(0, this._subAgentCount - 1);
    this._usedTokens = Math.max(0, this._usedTokens - (tokensUsed ?? 10000));
    console.log(`[Cgroup:${this.manifest.domain_id}] 子 Agent "${name}" 已释放`);
  }

  /**
   * buildSubAgentPrompt — 构建子 Agent 的 system prompt
   *
   * 使用三级分封架构的 Expert (Ring 1) 提示词模板 + 领域特定提示词。
   * Expert 提示词定义了惰性灌水、ForkExecute 隔离、脏日志阻断等行为准则。
   * 领域提示词来自 manifest 中的 master_agent_config.system_prompt（领域知识）。
   */
  private buildSubAgentPrompt(params: {
    name: string;
    description: string;
    prompt: string;
  }): string {
    // 1. Expert 通用行为准则（Ring 1 特权级约束）
    const expertPrompt = compileExpertPrompt({
      domainName: this.manifest.domain_name,
      domainId: this.manifest.domain_id,
      goal: params.description,
      vfsMountUri: '由父 Agent 通过 AgentCreate 的 vfsMountUri 参数指定',
      timestamp: Date.now(),
    });

    // 2. 领域特定知识（来自 manifest）
    const domainPrompt = this.manifest.master_agent_config.system_prompt;

    // 3. 将父 Agent 指令追加为对话上下文
    return `${expertPrompt}\n\n---\n## 5. 领域特定知识\n${domainPrompt}\n\n## 6. 当前任务\n你的名称: ${params.name}\n父 Agent 指令:\n${params.prompt}\n\n约束:\n- 完成的产物必须写入 ArtifactRegistry\n- 遇到不确定性时，通过 EventBus 上报给父 Agent`;
  }

  /**
   * getCgroupStatus — 获取 Cgroup 状态报告
   */
  getCgroupStatus(): {
    tokenQuota: number;
    usedTokens: number;
    availableTokens: number;
    subAgentCount: number;
    maxSubAgents: number;
  } {
    return {
      tokenQuota: this._tokenQuota,
      usedTokens: this._usedTokens,
      availableTokens: Math.max(0, this._tokenQuota - this._usedTokens),
      subAgentCount: this._subAgentCount,
      maxSubAgents: this._maxSubAgents,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  getStatusReport(): ClusterStatusReport {
    return {
      domain_id: this.manifest.domain_id,
      domain_name: this.manifest.domain_name,
      status: this._status,
      version: this.manifest.version,
      uptime: this.uptime,
      task_count: this._taskCount,
    };
  }

  getSkillNames(): string[] {
    return [...this._skillPool.keys()];
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private async loadSkills(): Promise<void> {
    for (const skillName of this.manifest.skills) {
      try {
        const tool = await this.loadSkillTool(skillName);
        if (tool) {
          this._skillPool.set(skillName, tool);
          console.log(`  ├─ Skill: ${skillName} ✅`);
        } else {
          console.warn(`  ├─ Skill: ${skillName} ⚠️ 未找到`);
        }
      } catch (err: unknown) {
        console.warn(`  ├─ Skill: ${skillName} ❌ 加载失败: ${(err as Error).message}`);
      }
    }
  }

  private async loadSkillTool(skillName: string): Promise<AgentTool | null> {
    const fs = await import('fs');
    const path = await import('path');
    const skillDir = path.resolve(process.cwd(), 'data', 'skills', skillName);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillFile)) {
      return null;
    }

    const content = fs.readFileSync(skillFile, 'utf-8');
    const { mpType: Type } = await import('../adapters/pi-utils.js');

    return {
      name: skillName,
      label: skillName,
      description: content.substring(0, 500),
      parameters: Type.Object({
        input: Type.String({ description: '技能执行输入' }),
      }),
      execute: async (_toolCallId: string, params: unknown, _signal?: any, _onUpdate?: any) => {
        const { input } = params as { input: string };
        const resultText = "[Skill: " + skillName + "]\n" + content + "\n\n请根据以上技能定义，处理以下输入:\n" + input;
        return {
          content: [{ type: "text", text: resultText }],
          details: {},
        };
      },
    };
  }
}
