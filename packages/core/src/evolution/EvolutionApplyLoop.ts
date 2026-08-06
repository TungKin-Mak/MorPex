/**
 * EvolutionApplyLoop — 进化提案落地通道（会话 16e · 3-3 半自动应用闭环）
 *
 * 闭环：可学习事件（evolution.experience.mined）→ 生成策略提案 → EvolutionSandbox
 * 沙箱试跑 → pending_approval → （有 Gate 凭证提供者则）半自动应用 → PromptStrategyRegistry
 * 版本化落地 → 装配/执行路径注入 → 影响后续行为 → 可回滚（EvolutionSandbox.rollback）。
 *
 * 半自动语义（AGENTS.md 3.7 Verifiable Evolution）：
 *   - 提案自动生成 + 沙箱试跑（不绕过沙箱）
 *   - 应用需经 EvolutionSandbox.approveAndApply（Gate 硬校验）：注入 gateContextProvider 时
 *     自动批准低风险策略；否则停留 pending_approval（人工审批通道，观测端点可见）
 *   - 每次提案携带 apply/revert 具体动作（注册表 setHint/removeHint），可真正回滚
 *
 * @packageDocumentation
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';
import type { KnowledgeContextPackage } from '../gate/context.js';
import { EvolutionSandbox, type EvolutionChangeRecord } from './EvolutionSandbox.js';
import { PromptStrategyRegistry, type StrategyType } from './PromptStrategyRegistry.js';

/** 策略类型 → 生成的规避提示（"落地为提示词"的默认策略） */
const STRATEGY_HINTS: Record<StrategyType, string> = {
  'empty-param': '调用工具前必须确认所有必需参数非空（knowledge 需 query、shell 需 command、api 需 url+method、file 需 operation+path）；一次调用填全，禁止省略。',
  'safety-block': '破坏性操作（写文件/执行命令/调外部 API）前必须先经知识检索取得 Gate 凭证，否则会被硬拦；取不到凭证就说明原因，不假装成功。',
  'high-retry': '一次调用把参数填完整，避免思考模式空转反复重试；重试超限会判定失败。',
};

export interface EvolutionApplyLoopOptions {
  /** Gate 凭证提供者（可选）：提供时半自动应用；否则提案停留 pending_approval */
  gateContextProvider?: () => Promise<KnowledgeContextPackage | null>;
  /** 同类策略重提防抖（ms，默认 10 分钟）——避免同类型事件反复提案 */
  cooldownMs?: number;
  /** 沙箱试跑校验（可选，默认恒通过——策略文本注入为低风险） */
  sandboxCheck?: () => Promise<boolean> | boolean;
}

export class EvolutionApplyLoop {
  private sandbox: EvolutionSandbox;
  private registry: PromptStrategyRegistry;
  private opts: EvolutionApplyLoopOptions;
  private lastProposedAt = new Map<StrategyType, number>();
  private appliedCount = 0;

  constructor(
    sandbox: EvolutionSandbox,
    registry: PromptStrategyRegistry,
    opts: EvolutionApplyLoopOptions = {},
  ) {
    this.sandbox = sandbox;
    this.registry = registry;
    this.opts = opts;
  }

  /** 挂载事件监听（EventBus 就绪后调用） */
  init(eventBus: EventBus): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on('evolution.experience.mined', (e: any) => { void this.onExperienceMined(e); });
  }

  getAppliedCount(): number {
    return this.appliedCount;
  }

  /** 当前 pending 提案（观测端点可见，等待人工审批） */
  listPending(): EvolutionChangeRecord[] {
    return this.sandbox.listChanges().filter(c => c.status === 'pending_approval');
  }

  // ── 内部 ──

  private async onExperienceMined(e: {
    payload?: { events?: Array<{ type: string }> };
  }): Promise<void> {
    const events = e.payload?.events ?? [];
    const types = new Set<StrategyType>();
    for (const ev of events) {
      if (ev.type === 'empty-param' || ev.type === 'safety-block' || ev.type === 'high-retry') {
        types.add(ev.type);
      }
    }
    for (const type of types) {
      await this.proposeStrategy(type);
    }
  }

  private async proposeStrategy(type: StrategyType): Promise<void> {
    // 防抖：同类策略冷却期内不重复提案
    const last = this.lastProposedAt.get(type) ?? 0;
    const cooldown = this.opts.cooldownMs ?? 10 * 60 * 1000;
    if (Date.now() - last < cooldown) return;
    this.lastProposedAt.set(type, Date.now());

    const hint = STRATEGY_HINTS[type];
    const sandboxPass = this.opts.sandboxCheck ? await this.opts.sandboxCheck() : true;

    // 提案（带 apply/revert 具体动作：注册表版本化写入 / 回滚恢复）
    const record = await this.sandbox.proposeChange({
      summary: `应用策略：${type}（提示词注入规避）`,
      run: () => sandboxPass,
      apply: () => { this.registry.setHint(type, hint); },
      revert: () => { this.registry.removeHint(type); },
    });
    if (record.status !== 'pending_approval') return; // 沙箱未过 → rejected

    // 半自动应用：有 Gate 凭证提供者 → 自动批准；否则停留 pending（人工审批）
    if (this.opts.gateContextProvider) {
      try {
        const gateContext = await this.opts.gateContextProvider();
        if (gateContext) {
          const applied = await this.sandbox.approveAndApply(record.id, gateContext);
          if (applied?.status === 'applied') {
            this.appliedCount++;
            console.log(`[EvolutionApplyLoop] ✅ 策略已应用（半自动）: ${type}`);
          }
        }
      } catch (err) {
        console.warn(`[EvolutionApplyLoop] ⚠️ 策略应用失败（停留 pending）: ${type} — ${(err as Error).message}`);
      }
    }
  }
}
