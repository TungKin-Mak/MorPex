/**
 * EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环）
 *
 * vNext+ L8：禁止「分析完直接改生产行为」。演化产物必须先：
 *   1. 沙箱试跑（dry-run golden tasks，隔离 Runtime）
 *   2. 版本化落地（version ledger，EventStore 持久化）
 *   3. 人工审批（未批准 = proposal 状态 pending）
 *   4. 可回滚（rollback 入口：记录回滚事件，供重建/回退）
 */

import type { IEventStore } from '../protocol/events/store/IEventStore.js';

export interface EvolutionChangeRecord {
  id: string;
  version: number;
  proposalId?: string;
  summary: string;
  sandboxPassed: boolean;
  sandboxFailures: string[];
  status: 'pending_approval' | 'applied' | 'rolled_back' | 'rejected';
  createdAt: number;
  appliedAt?: number;
  rolledBackAt?: number;
}

export interface EvolutionSandboxOptions {
  /** 沙箱试跑用的 golden tasks（dry-run） */
  goldenTasks?: Array<{ id: string; run: () => Promise<boolean> | boolean }>;
  /** EventStore（版本化持久化 + 回放） */
  eventStore?: IEventStore;
}

export class EvolutionSandbox {
  name = 'EvolutionSandbox';

  private changes: Map<string, EvolutionChangeRecord> = new Map();
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
   */
  async proposeChange(input: { proposalId?: string; summary: string; run?: () => Promise<boolean> }): Promise<EvolutionChangeRecord> {
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
        } as never);
      } catch {
        // 持久化失败不阻断
      }
    }
    return record;
  }

  /**
   * approveAndApply — 人工审批通过 → 标记 applied（版本化落地）
   */
  async approveAndApply(id: string): Promise<EvolutionChangeRecord | undefined> {
    const rec = this.changes.get(id);
    if (!rec) return undefined;
    if (rec.status !== 'pending_approval') return rec;
    rec.status = 'applied';
    rec.appliedAt = Date.now();
    await this.recordEvent(rec, 'applied');
    return rec;
  }

  /**
   * reject — 拒绝变更
   */
  async reject(id: string, reason?: string): Promise<EvolutionChangeRecord | undefined> {
    const rec = this.changes.get(id);
    if (!rec) return undefined;
    rec.status = 'rejected';
    rec.sandboxFailures = [...rec.sandboxFailures, reason ? `rejected: ${reason}` : 'rejected by human'];
    await this.recordEvent(rec, 'rejected');
    return rec;
  }

  /**
   * rollback — 回滚入口（版本化回滚：标记 + 记录回滚事件，供重建/回退）
   */
  async rollback(id: string): Promise<EvolutionChangeRecord | undefined> {
    const rec = this.changes.get(id);
    if (!rec) return undefined;
    rec.status = 'rolled_back';
    rec.rolledBackAt = Date.now();
    await this.recordEvent(rec, 'rolled_back');
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
        payload: { changeId: rec.id, version: rec.version, status: rec.status },
      } as never);
    } catch {
      // 忽略持久化失败
    }
  }
}
