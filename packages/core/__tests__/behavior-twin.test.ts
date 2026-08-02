/**
 * BehaviorTwin 行为孪生测试（L4 Cognition/twin）— 此前零覆盖（241 stmt / 2.5%）
 *
 * 覆盖：recordMission/recordApproval/recordActivity/recordSourceEvent → buildProfile
 *       画像推断（planningStyle/riskTolerance/taskDecomposition）+ 版本管理
 *       （getVersionHistory/rollback/fork/compare/diffVersions）+ 查询 getter
 */
import { describe, it, expect } from 'vitest';
import { BehaviorTwin } from '../src/cognition/twin/BehaviorTwin.js';
import type { BehaviorProfile } from '../src/cognition/twin/BehaviorTwin.js';

function mission(id: string, goal: string) { return { id, goal } as any; }
function result(duration: number, stepsTotal: number, state: 'COMPLETED' | 'FAILED' = 'COMPLETED') {
  return { duration, stepsTotal, stepsCompleted: stepsTotal, state } as any;
}
function plan(stepCount: number, deps: string[] = [], riskLevel = 'medium') {
  return {
    steps: Array.from({ length: stepCount }, (_, i) => ({ name: `s${i}`, deps: deps.slice(0, i) })),
    riskLevel,
  } as any;
}

describe('BehaviorTwin — 画像推断', () => {
  it('构造默认 userId + 空画像结构', () => {
    const t = new BehaviorTwin();
    const p = t.buildProfile();
    expect(p.userId).toBe('default');
    expect(p.planningStyle).toBe('top-down'); // 无证据默认
    expect(p.taskDecomposition).toBe('moderate');
    expect(p.evidenceCount).toBe(0);
  });

  it('小步骤数 mission（≤3）→ top-down + coarse 拆解', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m1', '快速任务'), result(100, 2), plan(2));
    const p = t.buildProfile();
    expect(p.planningStyle).toBe('top-down');
    expect(p.taskDecomposition).toBe('coarse'); // avg≤3 步
  });

  it('多步骤 + 依赖 → architecture-first + fine-grained', () => {
    const t = new BehaviorTwin();
    // 8 步且含并行依赖
    t.recordMission(mission('m2', '复杂架构任务'), result(1000, 8), plan(8, ['s1', 's2', 's3']));
    const p = t.buildProfile();
    expect(p.taskDecomposition).toBe('fine-grained'); // >6 步
    expect(p.planningStyle).toBe('architecture-first'); // 并行依赖多
  });

  it('无依赖的多步骤 → prototype-first（deps < stepCount*0.5）', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m3', '无依赖流水'), result(500, 5), plan(5, [])); // 0 deps < 2.5
    const p = t.buildProfile();
    expect(p.planningStyle).toBe('prototype-first');
  });

  it('recordApproval 影响风险偏好（即时批准 → 风险偏好提高）', () => {
    const t = new BehaviorTwin();
    t.recordApproval(true, 5_000); // 立即批准（<60s）
    t.recordApproval(true, 10_000);
    t.recordApproval(true, 8_000);
    const p = t.buildProfile();
    expect(['medium-high', 'high']).toContain(p.riskTolerance);
  });

  it('recordActivity 影响工作时段 + 证据计数递增', () => {
    const t = new BehaviorTwin();
    const morning = new Date('2026-01-01T09:00:00').getTime();
    const morning2 = new Date('2026-01-02T10:00:00').getTime();
    const evening = new Date('2026-01-03T21:00:00').getTime();
    t.recordActivity(morning);
    t.recordActivity(morning2);
    t.recordActivity(evening);
    const p = t.buildProfile();
    expect(p.evidenceCount).toBe(3);
    expect(p.workHours).toBeTruthy();
  });
});

describe('BehaviorTwin — 版本管理', () => {
  it('buildProfile 每次递增版本号 + 版本历史可查', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m', '任务'), result(100, 2));
    const v1 = t.buildProfile();
    const v2 = t.buildProfile();
    expect(v2.version).toBe(v1.version + 1);
    expect(t.getVersionHistory().length).toBe(2);
    expect(t.getCurrentVersion()).toBe(v2.version);
    expect(t.getVersion(v1.version)?.planningStyle).toBe(v1.planningStyle);
  });

  it('rollback 创建新版本（恢复目标画像，版本号继续递增）', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m', 'A'), result(100, 2)); // top-down
    const v1 = t.buildProfile();
    t.recordMission(mission('m2', 'B'), result(100, 8), plan(8, ['a', 'b', 'c', 'd'])); // architecture-first
    const v2 = t.buildProfile();
    const rolled = t.rollback(v1.version);
    expect(rolled).not.toBeNull();
    expect(rolled!.planningStyle).toBe(v1.planningStyle); // 恢复旧画像
    expect(t.getCurrentVersion()).toBe(v2.version + 1); // 新版本号（非回落）
  });

  it('fork 创建实验分支（独立实例，同源画像）', () => {
    const t = new BehaviorTwin('u1');
    t.recordMission(mission('m', '任务'), result(100, 2));
    const base = t.buildProfile();
    const fork = t.fork('实验A');
    expect(fork).toBeInstanceOf(BehaviorTwin);
    const forkProfile = fork.buildProfile();
    expect(forkProfile.planningStyle).toBe(base.planningStyle);
  });

  it('compare/diffVersions 返回版本差异（planningStyle 变化）', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m', 'A'), result(100, 2)); // top-down
    const v1 = t.buildProfile();
    t.recordMission(mission('m2', 'B'), result(100, 8), plan(8, ['a', 'b', 'c', 'd'])); // architecture-first
    const v2 = t.buildProfile();
    const diffs = t.diffVersions(v1.version, v2.version);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some(d => d.includes('planningStyle'))).toBe(true);
    expect(t.compare(v1.version, v2.version).length).toBe(diffs.length);
  });
});

describe('BehaviorTwin — getter 与事件溯源', () => {
  it('getSourceEvents 记录 recordSourceEvent', () => {
    const t = new BehaviorTwin();
    t.recordSourceEvent('evt_1');
    t.recordSourceEvent('evt_2');
    expect(t.getSourceEvents()).toEqual(['evt_1', 'evt_2']);
  });

  it('getPlanningStyle/getRiskTolerance 从最新画像读取', () => {
    const t = new BehaviorTwin();
    t.recordMission(mission('m', '任务'), result(100, 2));
    t.buildProfile();
    expect(['top-down', 'moderate', 'mixed']).toContain(t.getPlanningStyle());
    expect(t.getRiskTolerance()).toMatch(/low|medium|high/);
  });
});
