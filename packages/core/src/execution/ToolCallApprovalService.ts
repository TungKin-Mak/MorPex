/**
 * ToolCallApprovalService — 工具调用级审批门（T3，docs/SINGLE_TRANSCRIPT_DESIGN.md §6）
 *
 * 与 UserAskService / PlanGateService / AgentMailbox 同构：request → wait(promise) → decide。
 * 差异：挂在 beforeToolCall 钩子上——高危工具执行前暂停等用户批准；超时=拒绝。
 *
 * 落库：request/decision 各写一条 custom_message 存根（display:true）到发起方账本，
 *       customType 前缀 morpex.approval_* → Indexer 分类 kind='approval'（审计可查，T2 投影渲染卡片）。
 *
 * 铁律：本文件不 import @earendil-works/*（钩子参数用最小结构类型）；EventBus Only。
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';

/** 与 spawner/PiBridge 的 beforeToolCall 兼容的最小结构签名（不 import pi 类型） */
export type ToolApprovalHook = (params: {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}) => Promise<{ block?: boolean; reason?: string } | undefined>;

export type ToolApprovalDecision = 'approve' | 'deny' | 'timeout';

export interface PendingToolApproval {
  id: string;
  sessionId?: string;
  sessionPath?: string;
  toolName: string;
  argsSummary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  createdAt: number;
  timeoutAt: number;
}

interface PendingRecord {
  info: PendingToolApproval;
  resolve: (d: ToolApprovalDecision) => void;
}

const pending = new Map<string, PendingRecord>();
let seq = 0;
let approvalEventBus: EventBus | null = null;

export function setToolApprovalEventBus(bus: EventBus): void {
  approvalEventBus = bus;
}

/** 默认需审批的高危工具判定：shell 一律审；file 写操作、api 非 GET 审 */
export function needsToolApproval(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === 'shell') return true;
  if (toolName === 'file' && String(args.operation ?? '') === 'write') return true;
  if (toolName === 'api' && String(args.method ?? 'GET').toUpperCase() !== 'GET') return true;
  return false;
}

function riskOf(toolName: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (toolName === 'shell') return 'HIGH';
  return 'MEDIUM';
}

function summarizeArgs(args: Record<string, unknown>, max = 200): string {
  try {
    const s = JSON.stringify(args);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return '[unserializable]';
  }
}

export interface ToolApprovalHookOptions {
  sessionId?: string;
  /** 发起方账本路径（写存根用；缺省则只走内存队列不落账本） */
  sessionPath?: string;
  /** 写 custom_message 存根的回调（接线层绑定 AgentSessionStore.appendCustomMessage） */
  recordStub?: (customType: string, content: unknown, display: boolean) => Promise<void> | void;
  timeoutMs?: number;
  /** 审批事件出口（approval.request；与模块级 setToolApprovalEventBus 二选一或并用） */
  eventBus?: EventBus;
}

/**
 * createToolCallApprovalHook — 生成与 spawner.beforeToolCall 兼容的审批钩子。
 * 返回 undefined = 放行；{block:true} = 拒绝/超时（reason 回填 LLM 错误结果）。
 */
export function createToolCallApprovalHook(opts: ToolApprovalHookOptions = {}): ToolApprovalHook {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  return async ({ toolName, args }) => {
    if (!needsToolApproval(toolName, args)) return undefined;

    const id = `ap_${Date.now()}_${++seq}`;
    const info: PendingToolApproval = {
      id,
      sessionId: opts.sessionId,
      sessionPath: opts.sessionPath,
      toolName,
      argsSummary: summarizeArgs(args),
      riskLevel: riskOf(toolName),
      createdAt: Date.now(),
      timeoutAt: Date.now() + timeoutMs,
    };

    await opts.recordStub?.('morpex.approval_request', {
      requestId: id,
      tool: toolName,
      argsSummary: info.argsSummary,
      riskLevel: info.riskLevel,
      createdAt: info.createdAt,
      timeoutAt: info.timeoutAt,
    }, true);
    const bus = opts.eventBus ?? approvalEventBus;
    bus?.emit({
      id: `evt_${id}`,
      type: 'approval.request',
      timestamp: Date.now(),
      executionId: info.sessionId ?? 'unknown',
      source: 'tool-approval',
      payload: { ...info },
    });

    console.warn(`[ToolApproval] ⏸️ 工具 ${toolName} 待审批 (${id})，等待决策或 ${Math.round(timeoutMs / 1000)}s 超时`);
    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      const rec: PendingRecord = { info, resolve };
      pending.set(id, rec);
      setTimeout(() => {
        if (pending.get(id) === rec) {
          pending.delete(id);
          resolve('timeout');
        }
      }, timeoutMs);
    });

    await opts.recordStub?.('morpex.approval_decision', {
      requestId: id,
      decision,
      decidedBy: decision === 'timeout' ? 'system' : 'user',
      decidedAt: Date.now(),
    }, true);

    if (decision === 'approve') {
      console.log(`[ToolApproval] ✅ ${toolName} 已批准 (${id})`);
      return undefined;
    }
    const reason = decision === 'timeout' ? `审批超时（${Math.round(timeoutMs / 60000)} 分钟），工具被自动拒绝` : '用户拒绝了本次工具调用';
    console.warn(`[ToolApproval] ⛔ ${toolName} 被拒绝（${decision}，${id}）`);
    return { block: true, reason };
  };
}

/** 决策入口（StudioServer 的 /api/approval/:id/decision 接线调用；幂等：未决才生效） */
export function resolveToolApproval(id: string, decision: 'approve' | 'deny'): boolean {
  const rec = pending.get(id);
  if (!rec) return false;
  pending.delete(id);
  rec.resolve(decision);
  return true;
}

export function listPendingToolApprovals(): PendingToolApproval[] {
  return [...pending.values()].map(r => r.info);
}
