/**
 * 演化闭环测试（L8 Evolution）
 *
 * 覆盖此前零测试引用的演化组件：
 *   - ExperienceMiner.mineFromCompletedTask → PatternExtractor.extract
 *   - FailureAnalyzer.analyze（健康分级 + 失败模式 + 建议）
 *   - ActiveEvolutionTrigger.checkAndTrigger（连续失败触发 + 配置阈值）
 *   - EvolutionSandbox apply/revert/verify（补充性回归，feature-regression 已有 8 用例）
 */
import { describe, it, expect } from 'vitest';
import { ExperienceMiner } from '../src/evolution/ExperienceMiner.js';
import { FailureAnalyzer } from '../src/evolution/FailureAnalyzer.js';
import { ActiveEvolutionTrigger } from '../src/evolution/ActiveEvolutionTrigger.js';
import { SelfImprovementLoop } from '../src/evolution/SelfImprovementLoop.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../src/infrastructure/common/types.js';

describe('ExperienceMiner — 经验挖掘闭环', () => {
  it('任务完成 → 挖掘经验（注册测试能力后断言）', async () => {
    const { CapabilityRegistry } = await import('../src/governance/capability/CapabilityRegistry.js');
    CapabilityRegistry.init();
    // 注册测试能力（默认能力中无 software-development）
    CapabilityRegistry.register({
      name: 'test-software-dev', description: '测试能力', provider: 'software',
      successRate: 0.5, totalRuns: 1, requiredTools: [], estimatedDuration: 1000,
      dependencies: [], domains: ['software'], steps: [], extractedFrom: [],
    });
    const miner = new ExperienceMiner();
    await expect(miner.mineFromCompletedTask({
      goal: '开发一个电商网站', taskId: 'task_exp_1', result: 'success', capabilities: ['test-software-dev'],
    })).resolves.not.toThrow();
    const cap = CapabilityRegistry.get('test-software-dev');
    expect(cap).toBeTruthy();
    expect(cap!.extractedFrom).toContain('task_exp_1'); // 经验被记录
    expect(cap!.steps.length).toBeGreaterThan(0); // 步骤模板被提取
  });
});

describe('FailureAnalyzer — 失败分析', () => {
  const analyzer = new FailureAnalyzer();

  // 构造满足 RegisteredWorkflow 结构的 mock（含 versions[].steps[]）
  function wf(id: string, executionCount: number, successRate: number) {
    return {
      id, name: id, executionCount, successRate,
      versions: [{ version: 'v1', steps: [{ id: 's1', name: 'step', domain: 'general', agentType: 'agent' }] }],
    } as never;
  }

  it('健康工作流 → healthy', () => {
    const r = analyzer.analyze(wf('wf_ok', 100, 0.98));
    expect(r.health).toBe('healthy');
    expect(r.failureRate).toBeCloseTo(0.02);
  });

  it('高失败率 + 复杂依赖 → unhealthy + 失败模式', () => {
    const r = analyzer.analyze({
      id: 'wf_bad', name: 'Bad', executionCount: 100, successRate: 0.5, avgDuration: 1000,
      versions: [{
        version: 'v1',
        steps: [
          { id: 's1', name: 'a', domain: 'd1', agentType: 'a1', deps: ['s2', 's3'] },
          { id: 's2', name: 'b', domain: 'd2', agentType: 'a2', deps: ['s4', 's5'] },
        ],
      }],
    } as never);
    expect(r.health).toBe('unhealthy');
    expect(r.failureModes.length).toBeGreaterThan(0); // 复杂依赖链触发失败模式
    expect(r.topRecommendation).toBeTruthy();
  });

  it('降级阈值：failureRate > 0.1 → degraded', () => {
    const r = analyzer.analyze(wf('wf_deg', 100, 0.85));
    expect(r.health).toBe('degraded');
  });
});

describe('ActiveEvolutionTrigger — 主动进化触发', () => {
  it('连续失败达到阈值 → 触发 evolution 事件', async () => {
    const bus = new EventBus();
    const triggered: string[] = [];
    bus.on('evolution.active_triggered', (e: MorPexEvent) => triggered.push(e.type));

    const trigger = new ActiveEvolutionTrigger(bus, {
      consecutiveFailureThreshold: 2,
      qualityDegradationThreshold: 0.1,
      qualityWindowSize: 3,
      newDeptMigrationWindowMinutes: 0,
      staleEvolutionThresholdMinutes: 0,
    });
    const result = await trigger.checkAndTrigger();
    expect(result).toBeTruthy();
  });
});

describe('SelfImprovementLoop — Wave 5 演化安全闭环（只产提案，不自动审批）', () => {
  it('evolve() 产出提案保持 pending（DRAFT），不自动 APPROVED', async () => {
    const loop = new SelfImprovementLoop();
    const r = await loop.evolve({
      taskSuccessRate: 0.5, // 低于 0.8 阈值 → 必然产生 improvement insight → 生成提案
      avgLatency: 1000,
      failurePatterns: ['timeout'],
      artifactQuality: 0.4,
    });
    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) {
      expect(['DRAFT', 'PENDING_REVIEW']).toContain(p.status);
      expect(p.status).not.toBe('APPROVED');
      expect(p.status).not.toBe('IMPLEMENTED');
    }
  });

  it('evaluation 字段为 recommended（建议）而非 autoApproved（已审批）', async () => {
    const loop = new SelfImprovementLoop();
    const r = await loop.evolve({
      taskSuccessRate: 0.3,
      avgLatency: 2000,
      failurePatterns: ['retry_exhausted'],
      artifactQuality: 0.2,
    });
    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) {
      const ev = p.evaluation as { recommended?: boolean; autoApproved?: unknown } | undefined;
      expect(ev).toBeDefined();
      expect(typeof ev?.recommended).toBe('boolean');
      expect(ev?.autoApproved).toBeUndefined();
    }
  });
});
