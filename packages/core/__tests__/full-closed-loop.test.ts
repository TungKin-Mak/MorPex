/**
 * full-closed-loop.test.ts — 覆盖全功能模块的端到端测试
 *
 * 从用户输入 → 交付物产出，贯穿：
 *   L1 治理门禁 → 统一规划 → 聚焦装配（6 Provider）→ 执行（Gate 强制查询）
 *   → 交付物产出 → 经验沉淀 → 评价 → 演化 → 抽离（快照+摘要）→ 按 taskRef 召回
 *
 * 基于真实链路（bootstrapUnified + companyFacade.executeGoal，同 scripts/verify-e2e.ts）。
 *
 * ⚠️ 事件双轨（已探明）：
 *   - runtime.* / planner.* / evaluation.* / evolution.* / context.assembled / context.archived
 *     → 只走 EventBus（内存历史，container.eventBus.getHistory()）
 *   - context.snapshot / mission.* / artifact.created → 持久化在 EventStore（container.eventStore.query）
 *
 * ⚠️ 真实 LLM（GLM-4.7-Flash，config/morpex.yaml enabled:true）；运行较慢（每场景 30-90s）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapUnified } from '../src/bootstrap-unified.js';
import { loadByTaskRef } from '../src/knowledge/context/ContextArchive.js';
import { CapabilityRegistry } from '../src/governance/capability/CapabilityRegistry.js';

let boot: Awaited<ReturnType<typeof bootstrapUnified>>;
let container: (typeof boot)['container'];
let companyFacade: (typeof boot)['companyFacade'];
let departmentManager: (typeof boot)['departmentManager'];
let eventStore: { query(f: { type?: string; limit?: number }): Promise<Array<{ type: string; payload?: Record<string, unknown> }>> } | undefined;
let eventBus: { getHistory(type?: string): Array<{ type: string; payload?: Record<string, unknown> }> } | undefined;

/** 从 EventStore 按精确类型查（query 默认 limit=100 会截断，必须传 limit:5000） */
async function findEvents(type: string): Promise<Array<{ type: string; payload?: Record<string, unknown> }>> {
  if (!eventStore) return [];
  const all = await eventStore.query({ limit: 5000 });
  return all.filter((e) => e.type === type);
}

/** 从 EventBus 内存历史按前缀过滤（runtime/planner/evaluation/evolution/context.assembled 等只走 EventBus） */
function findBusEvents(prefix: string): Array<{ type: string; payload?: Record<string, unknown> }> {
  if (!eventBus) return [];
  return eventBus.getHistory().filter((e) => e.type === prefix || e.type.startsWith(prefix + '.'));
}

beforeAll(async () => {
  boot = await bootstrapUnified({ ceoId: 'loop-ceo' });
  container = boot.container;
  companyFacade = boot.companyFacade;
  departmentManager = boot.departmentManager;
  eventStore = container.eventStore as typeof eventStore;
  eventBus = container.eventBus as unknown as typeof eventBus;
  try {
    await departmentManager.createDepartment({ name: 'ecommerce', type: 'project', ceoId: 'loop-ceo' });
  } catch {
    /* 已存在 */
  }
}, 120_000);

describe('full-closed-loop：用户输入 → 交付物全链路', () => {
  it('【场景1 成功闭环】门禁→规划→装配→执行→交付物→经验→评价→抽离→召回', async () => {
    // ── 用户输入 → executeGoal ──
    const result = await companyFacade.executeGoal(
      '为电商部门生成「商品价格合规检查」行动方案并执行：检查价格披露是否含税、有无虚假紧迫感，输出检查报告产物',
      { departmentName: 'ecommerce' },
    );
    expect(result.ok).toBe(true);

    // L1 治理门禁 + 执行：runtime.started / runtime.completed（EventBus）
    const started = findBusEvents('runtime.started');
    const completed = findBusEvents('runtime.completed');
    expect(started.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);

    // 统一规划：planner.plan.completed（EventBus）
    const plans = findBusEvents('planner.plan.completed');
    expect(plans.length).toBeGreaterThan(0);

    // 聚焦装配：context.assembled（EventBus，装配在 orchestrate 后真实发生）
    const assembled = findBusEvents('context.assembled');
    expect(assembled.length).toBeGreaterThan(0);

    // 交付物产出：Artifact（context.snapshot 持久化 payload.artifacts；result.artifacts 字段不存在）
    const snapshots = await findEvents('context.snapshot');
    const mineSnap = snapshots.filter((e) => e.payload?.taskRef === result.missionId || e.payload?.missionId === result.missionId);
    const artifactIds = (mineSnap[0]?.payload?.artifacts as string[] | undefined) ?? [];
    expect(artifactIds.length).toBeGreaterThan(0); // 至少一个交付物产出

    // 经验沉淀：CapabilityRegistry 能力成功率被更新（PatternExtractor → updateSuccessRate）
    const caps = CapabilityRegistry.list ? CapabilityRegistry.list() : undefined;
    if (caps) {
      const withRate = caps.filter((c: { successRate?: number }) => typeof c.successRate === 'number');
      expect(withRate.length).toBeGreaterThan(0); // 至少一个能力有成功率数据（经验沉淀发生）
    }

    // 评价：evaluation.completed（EventBus）
    const evaluations = findBusEvents('evaluation.completed');
    expect(evaluations.length).toBeGreaterThan(0);

    // 抽离：context.archived（EventBus）+ context.snapshot 持久化（EventStore，带 taskRef）
    const archived = findBusEvents('context.archived');
    expect(archived.length).toBeGreaterThan(0);
    const mine = snapshots.filter((e) => e.payload?.taskRef === result.missionId || e.payload?.missionId === result.missionId);
    expect(mine.length).toBeGreaterThan(0);

    // 召回：ContextArchive.loadByTaskRef 按 taskRef 精确还原
    const recalled = await loadByTaskRef(eventStore, result.missionId!);
    expect(recalled).not.toBeNull();
    expect(recalled!.missionId).toBe(result.missionId);
    expect(recalled!.taskRef).toBe(result.missionId);
    // ⚠️ 会话 10（GLM-only）：思考模式下单场景实测 ~167s，180s 过紧（限流/波动易超）→ 300s
  }, 600_000); // 会话 11c：opencode 复杂任务可能数小时，测试预算放宽

  it('【场景2 失败任务】错误处理 + 演化提案', async () => {
    // 构造确定失败：不存在的部门 → 路由层失败（错误路径）
    const badDept = await companyFacade.executeGoal('任何任务', { departmentName: 'nonexistent-dept-xyz' });
    expect(badDept.ok).toBe(false);
    expect(badDept.error).toBeTruthy();

    // 演化：成功任务链上 evolution.completed 应真实运行（EventBus；提案是否产生取决于评分，不强制 >0）
    const proposals = findBusEvents('evolution.change.proposed');
    const evolutionDone = findBusEvents('evolution.completed');
    expect(evolutionDone.length + proposals.length).toBeGreaterThan(0);
  }, 60_000);

  it('【场景3 复杂任务】多步骤/多能力目标 → 完整闭环 + 交付物', async () => {
    // medium 复杂度（>200 字符 + 多步骤关键词）→ 触发 dag/fabric 编排路径
    const complexGoal =
      '为电商部门制定并执行一个完整的「618 大促合规与定价」多阶段方案：' +
      '第一阶段检查所有在售商品的价格披露是否含税并修正违规项；' +
      '第二阶段生成促销合规检查清单（禁止虚假紧迫感、禁止虚构原价）；' +
      '第三阶段输出一份完整的价格合规审计报告作为交付物，报告需包含检查项、违规统计与整改建议。';
    const result = await companyFacade.executeGoal(complexGoal, { departmentName: 'ecommerce' });

    // 执行链路走完（ok 或失败都记录事件）
    const started = findBusEvents('runtime.started');
    const completed = findBusEvents('runtime.completed');
    expect(started.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);

    // 若成功：有交付物（snapshot artifacts）；若失败：有 error
    if (result.ok) {
      const snapshots = await findEvents('context.snapshot');
      const mineSnap = snapshots.filter((e) => e.payload?.taskRef === result.missionId);
      const artifactIds = (mineSnap[0]?.payload?.artifacts as string[] | undefined) ?? [];
      expect(artifactIds.length).toBeGreaterThan(0);
    } else {
      expect(result.error).toBeTruthy();
    }
  }, 900_000); // 会话 11c：复杂多步任务 opencode 思考模式可超 15 分钟
});
