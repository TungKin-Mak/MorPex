/**
 * EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环）
 *
 * vNext+ L8：禁止「分析完直接改生产行为」。演化产物必须先：
 *   1. 沙箱试跑（dry-run golden tasks，隔离 Runtime）
 *   2. 版本化落地（version ledger，EventStore 持久化）
 *   3. 人工审批（未批准 = proposal 状态 pending）
 *   4. 自动回滚（L8：携带 revert() 的具体变更真正撤销 + verify() 校验；
 *      失败可重试，不产生悬挂态；无 revert() 时仅标记 rolled_back 兼容旧行为）
 */

import type { IEventStore } from '../infrastructure/protocol/events/store/IEventStore.js';
import { requireKnowledgeContext, type KnowledgeContextPackage } from '../gate/context.js';

export interface EvolutionChangeRecord {
  id: string;
  version: number;
  proposalId?: string;
  summary: string;
  sandboxPassed: boolean;
  sandboxFailures: string[];
  /** 含 failed：apply 执行失败（可补偿回滚） */
  status: 'pending_approval' | 'applied' | 'rolled_back' | 'rejected' | 'failed';
  createdAt: number;
  appliedAt?: number;
  rolledBackAt?: number;
  // ── L8 自动回滚：apply/revert 执行结果（记录为纯数据，可序列化进 EventStore）──
  applyOutcome?: 'ok' | 'failed';
  applyError?: string;
  revertOutcome?: 'ok' | 'failed';
  revertError?: string;
  verifyOutcome?: 'ok' | 'failed';
}

export interface EvolutionSandboxOptions {
  /** 沙箱试跑用的 golden tasks（dry-run） */
  goldenTasks?: Array<{ id: string; run: () => Promise<boolean> | boolean }>;
  /** EventStore（版本化持久化 + 回放） */
  eventStore?: IEventStore;
}

/**
 * EvolutionChangeInput — 演化变更输入（L8 自动回滚具体变更）
 *
 * 除描述外，可携带「具体变更的可执行动作」：
 * - apply  审批通过后真正落地（默认不落地，仅标记 applied）
 * - revert 回滚时真正撤销（默认仅标记 rolled_back）
 * - verify 回滚后验证是否恢复原状（可选）
 *
 * apply/revert 建议做成「补偿式」：apply 保存旧值并写入新值，revert 恢复旧值，
 * 使回滚可幂等重试。动作函数存于沙箱侧表，不进 EventStore 记录（保持记录可序列化）。
 */
export interface EvolutionChangeInput {
  proposalId?: string;
  summary: string;
  /** 沙箱试跑（dry-run），缺省使用 goldenTasks */
  run?: () => Promise<boolean> | boolean;
  /** 具体变更：审批通过后真正落地执行 */
  apply?: () => Promise<void> | void;
  /** 具体变更的撤销：回滚时真正执行（自动回滚） */
  revert?: () => Promise<void> | void;
  /** 回滚后验证是否恢复原状（可选） */
  verify?: () => Promise<boolean> | boolean;
}

export class EvolutionSandbox {
  name = 'EvolutionSandbox';

  private changes: Map<string, EvolutionChangeRecord> = new Map();
  /** L8：具体变更的可执行动作侧表（不进记录，保持记录可序列化） */
  private actions: Map<string, {
    apply?: EvolutionChangeInput['apply'];
    revert?: EvolutionChangeInput['revert'];
    verify?: EvolutionChangeInput['verify'];
  }> = new Map();
  /** L8 并发守卫：apply/revert 执行中的 change id（防 TOCTOU 双执行） */
  private inflight: Set<string> = new Set();
  private versionCounter = 0;
  private eventStore?: IEventStore;
  private goldenTasks: Array<{ id: string; run: () => Promise<boolean> | boolean }>;

  constructor(opts?: EvolutionSandboxOptions) {
    this.eventStore = opts?.eventStore;
    this.goldenTasks = opts?.goldenTasks ?? [];
  }

  setGoldenTasks(tasks: Array<{ id: string; run: () => Promise<boolean> | boolean }>): void {
    this.goldenTasks = tasks;
  }

  /**
   * sandboxDryRun — 沙箱试跑 golden tasks（隔离/只读执行）
   * @returns 是否全部通过 + 失败清单
   */
  async sandboxDryRun(): Promise<{ passed: boolean; failures: string[] }> {
    const failures: string[] = [];
    for (const t of this.goldenTasks) {
      try {
        const ok = await t.run();
        if (!ok) failures.push(t.id);
      } catch (err) {
        failures.push(`${t.id}: ${(err as Error).message}`);
      }
    }
    return { passed: failures.length === 0, failures };
  }

  /**
   * proposeChange — 提交演化变更（先沙箱试跑，通过后登记为 pending_approval）
   *
   * L8：可携带 apply/revert/verify 具体变更动作，审批/回滚时真正执行。
   */
  async proposeChange(input: EvolutionChangeInput): Promise<EvolutionChangeRecord> {
    const sandbox = input.run
      ? { passed: await input.run(), failures: [] as string[] }
      : await this.sandboxDryRun();

    const version = ++this.versionCounter;
    const record: EvolutionChangeRecord = {
      id: `evo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      version,
      proposalId: input.proposalId,
      summary: input.summary,
      sandboxPassed: sandbox.passed,
      sandboxFailures: sandbox.failures,
      status: sandbox.passed ? 'pending_approval' : 'rejected',
      createdAt: Date.now(),
    };
    this.changes.set(record.id, record);
    // 动作侧表（不进记录，保持记录可序列化进 EventStore）
    this.actions.set(record.id, { apply: input.apply, revert: input.revert, verify: input.verify });

    // EventStore 持久化（可回放/审计）
    if (this.eventStore) {
      try {
        await this.eventStore.append({
          id: record.id,
          type: 'evolution.change.proposed',
          timestamp: Date.now(),
          executionId: record.id,
          source: 'evolution-sandbox',
          payload: { ...record, eventType: 'proposed' },
        } as unknown as Parameters<IEventStore['append']>[0]);
      } catch {
        // 持久化失败不阻断
      }
    }
    return record;
  }

  /**
   * approveAndApply — 人工审批通过 → 落地（版本化）
   *
   * Wave 3b：晋升写前再过 Gate —— 必须持有有效 KnowledgeContextPackage，缺失直接抛错（硬拦截）。
   * L8 自动回滚：若变更携带 apply()，则真正执行；
   * 执行失败 → status='failed'（可随后用 rollback 补偿撤销，不产生半落地悬挂态）。
   */
  async approveAndApply(id: string, gateContext?: KnowledgeContextPackage): Promise<EvolutionChangeRecord | undefined> {
    // 晋升硬拦截：缺包即抛错，禁止继续
    requireKnowledgeContext(gateContext, `EvolutionSandbox.approveAndApply(${id}) 晋升`);

    const rec = this.changes.get(id);
    if (!rec) return undefined;
    if (rec.status !== 'pending_approval') return rec;
    if (this.inflight.has(id)) return rec; // 并发守卫：已有 apply 在执行
    this.inflight.add(id);
    try {
      const action = this.actions.get(id);
      if (action?.apply) {
        try {
          await action.apply();
          rec.status = 'applied';
          rec.appliedAt = Date.now();
          rec.applyOutcome = 'ok';
          rec.applyError = undefined; // 重试成功清残留错误
          await this.recordEvent(rec, 'applied');
        } catch (err) {
          rec.status = 'failed';
          rec.applyOutcome = 'failed';
          rec.applyError = (err as Error).message;
          await this.recordEvent(rec, 'apply_failed');
        }
      } else {
        rec.status = 'applied';
        rec.appliedAt = Date.now();
        await this.recordEvent(rec, 'applied');
      }
    } finally {
      this.inflight.delete(id);
    }
    return rec;
  }

  /**
   * reject — 拒绝变更
   * 守卫：仅 pending_approval（或已 rejected）可被拒绝，防止已落地/已回滚变更被翻成 rejected。
   */
  async reject(id: string, reason?: string): Promise<EvolutionChangeRecord | undefined> {
    const rec = this.changes.get(id);
    if (!rec) return undefined;
    if (rec.status !== 'pending_approval' && rec.status !== 'rejected') return rec;
    rec.status = 'rejected';
    rec.sandboxFailures = [...rec.sandboxFailures, reason ? `rejected: ${reason}` : 'rejected by human'];
    await this.recordEvent(rec, 'rejected');
    return rec;
  }

  /**
   * rollback — 自动回滚入口（L8 自动回滚具体变更）
   *
   * 仅允许回滚已落地（applied）或 apply 失败（failed，补偿）的变更。
   * 携带 revert() 时真正执行撤销：
   * - revert 成功 → rolled_back（如提供 verify()，再校验恢复原状）
   * - revert 失败 → 保持原状态并记录 revertError（可重试，不产生悬挂态）
   * 无 revert() 时维持旧行为（仅标记 rolled_back）。
   */
  async rollback(id: string): Promise<EvolutionChangeRecord | undefined> {
    const rec = this.changes.get(id);
    if (!rec) return undefined;
    if (rec.status !== 'applied' && rec.status !== 'failed') return rec;
    if (this.inflight.has(id)) return rec; // 并发守卫：已有 revert 在执行
    this.inflight.add(id);
    try {
      const action = this.actions.get(id);
      if (action?.revert) {
        try {
          await action.revert();
          rec.status = 'rolled_back';
          rec.rolledBackAt = Date.now();
          rec.revertOutcome = 'ok';
          rec.revertError = undefined; // 重试成功清残留错误
        } catch (err) {
          rec.revertOutcome = 'failed';
          rec.revertError = (err as Error).message;
          await this.recordEvent(rec, 'revert_failed');
          return rec;
        }
        // 回滚后验证是否恢复原状
        if (action.verify) {
          try {
            rec.verifyOutcome = (await action.verify()) ? 'ok' : 'failed';
          } catch {
            rec.verifyOutcome = 'failed';
          }
        }
        await this.recordEvent(rec, 'rolled_back');
      } else {
        rec.status = 'rolled_back';
        rec.rolledBackAt = Date.now();
        rec.revertOutcome = 'ok';
        await this.recordEvent(rec, 'rolled_back');
      }
    } finally {
      this.inflight.delete(id);
    }
    return rec;
  }

  listChanges(): EvolutionChangeRecord[] {
    return [...this.changes.values()].sort((a, b) => b.version - a.version);
  }

  getChange(id: string): EvolutionChangeRecord | undefined {
    return this.changes.get(id);
  }

  private async recordEvent(rec: EvolutionChangeRecord, eventType: string): Promise<void> {
    if (!this.eventStore) return;
    try {
      await this.eventStore.append({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: `evolution.change.${eventType}`,
        timestamp: Date.now(),
        executionId: rec.id,
        source: 'evolution-sandbox',
        payload: {
          changeId: rec.id,
          version: rec.version,
          status: rec.status,
          applyOutcome: rec.applyOutcome,
          applyError: rec.applyError,
          revertOutcome: rec.revertOutcome,
          revertError: rec.revertError,
          verifyOutcome: rec.verifyOutcome,
        },
      } as unknown as Parameters<IEventStore['append']>[0]);
    } catch {
      // 忽略持久化失败
    }
  }
}
