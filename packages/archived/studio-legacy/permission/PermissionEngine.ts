/**
 * PermissionEngine — 运行时工具调用拦截器（动态审计层）
 *
 * 与 AgentFactory Cgroup（静态物理死线）并存，各司其职：
 *   - Cgroup: Ring 边界、工作目录硬锁、工具白名单（创建期约束）
 *   - PermissionEngine: 每一轮 Tool Call 运行时动态审计，可触发 HITL SUSPENDED
 *
 * 数据流:
 *   AgentHarness.beforeToolCall → PermissionEngine.check()
 *     → 'allow': 放行
 *     → 'block': 拒绝，返回错误消息给 Agent
 *     → 'ask': 触发 HITL，发射 human.pause.created 事件，FSM SUSPENDED
 *       → 用户决策 → onHumanDecision callback → 恢复执行
 */

export type PermissionMode = 'default' | 'explore' | 'accept_edits' | 'bypass' | 'dont_ask';

export type PermissionDecision = 'allow' | 'block' | 'ask';

export interface PermissionRule {
  /** 匹配模式：正则字符串或 RegExp */
  pattern: string | RegExp;
  /** 命中时的决策 */
  decision: PermissionDecision;
  /** 向 Agent 展示的拒绝理由（仅 block 时） */
  reason?: string;
  /** 向用户展示的询问说明（仅 ask 时） */
  prompt?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  params: Record<string, unknown>;
  domain: string;
  agentName: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
  prompt?: string;
  rule?: PermissionRule;
}

export class PermissionEngine {
  private mode: PermissionMode;
  private rules: PermissionRule[];
  private _pendingAsks: Map<string, { toolCall: ToolCallInfo; resolve: (decision: 'allow' | 'block') => void }> = new Map();

  /**
   * @param mode 默认权限模式
   * @param rules 自定义规则列表
   */
  constructor(mode: PermissionMode = 'default', rules: PermissionRule[] = []) {
    this.mode = mode;
    this.rules = rules;
  }

  /** 默认规则集：敏感文件 + 高危命令 */
  static defaultRules(): PermissionRule[] {
    return [
      { pattern: /\/etc\/passwd|\/etc\/shadow|\/root\//, decision: 'ask', prompt: '正在访问系统敏感文件，是否允许？' },
      { pattern: /rm\s+-rf\s+\//, decision: 'block', reason: '禁止执行根目录递归删除' },
      { pattern: /chmod\s+777/, decision: 'ask', prompt: '正在修改文件权限为 777，是否允许？' },
      { pattern: /curl\s+.*\|\s*bash/, decision: 'block', reason: '禁止执行管道下载脚本' },
      { pattern: /git\s+push/, decision: 'ask', prompt: '正在推送代码到远程仓库，是否允许？' },
      { pattern: /npm\s+publish/, decision: 'ask', prompt: '正在发布 npm 包，是否允许？' },
      { pattern: /rm\s+-rf\s+\.git/, decision: 'block', reason: '禁止删除 .git 目录' },
    ];
  }

  /**
   * check — 运行时审计单次工具调用
   *
   * @returns PermissionResult
   *   allow: 放行
   *   block: 拒绝（Agent 收到错误）
   *   ask: 需要人工确认（触发 HITL）
   */
  check(toolCall: ToolCallInfo): PermissionResult {
    // bypass 模式全部放行
    if (this.mode === 'bypass') return { decision: 'allow' };

    // 遍历规则，取第一条匹配
    for (const rule of this.rules) {
      if (!this.matches(toolCall, rule)) continue;

      if (rule.decision === 'block') {
        return { decision: 'block', reason: rule.reason || `操作 "${toolCall.name}" 被安全策略禁止`, rule };
      }

      if (rule.decision === 'ask') {
        if (this.mode === 'accept_edits' || this.mode === 'explore') {
          return { decision: 'allow' };
        }
        return { decision: 'ask', prompt: rule.prompt || `Agent ${toolCall.agentName} 请求执行: ${toolCall.name}`, rule };
      }
    }

    // default 模式：敏感操作按模式决定
    if (this.mode === 'default' && this.isSensitiveOperation(toolCall)) {
      return { decision: 'ask', prompt: `Agent ${toolCall.agentName} 请求执行敏感操作: ${toolCall.name}` };
    }

    return { decision: 'allow' };
  }

  /**
   * approvePending — 人工批准挂起的工具调用
   */
  approvePending(toolCallId: string): boolean {
    const pending = this._pendingAsks.get(toolCallId);
    if (!pending) return false;
    pending.resolve('allow');
    this._pendingAsks.delete(toolCallId);
    return true;
  }

  /**
   * rejectPending — 人工拒绝挂起的工具调用
   */
  rejectPending(toolCallId: string): boolean {
    const pending = this._pendingAsks.get(toolCallId);
    if (!pending) return false;
    pending.resolve('block');
    this._pendingAsks.delete(toolCallId);
    return true;
  }

  /**
   * waitForHumanDecision — 等待人工决策（返回 Promise，外部 await）
   */
  async waitForHumanDecision(toolCall: ToolCallInfo): Promise<'allow' | 'block'> {
    return new Promise((resolve) => {
      this._pendingAsks.set(toolCall.id, { toolCall, resolve });
    });
  }

  /**
   * getPendingAsks — 获取当前所有挂起的人工确认请求
   */
  getPendingAsks(): Array<{ toolCallId: string; toolCall: ToolCallInfo }> {
    return Array.from(this._pendingAsks.entries()).map(([id, v]) => ({
      toolCallId: id,
      toolCall: v.toolCall,
    }));
  }

  // ── 私有方法 ──

  private matches(toolCall: ToolCallInfo, rule: PermissionRule): boolean {
    const target = `${toolCall.name} ${JSON.stringify(toolCall.params)}`;
    if (typeof rule.pattern === 'string') {
      return target.includes(rule.pattern) || toolCall.name.includes(rule.pattern);
    }
    return rule.pattern.test(target);
  }

  private isSensitiveOperation(toolCall: ToolCallInfo): boolean {
    const sensitive = ['exec_command', 'ForkExecute', 'write_file', 'AgentCreate'];
    return sensitive.includes(toolCall.name);
  }
}
