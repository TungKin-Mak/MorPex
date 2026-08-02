/**
 * facade-context-wiring.test.ts — 功能③ 装配统一：MorPexRuntime orchestrate 后装配接线
 *
 * mode 收敛后装配统一在 MorPexRuntime.run（orchestrate 创建 Mission 之后、执行之前）：
 *   - 注入 contextAssemblyEngine → run() 时调用 assemble（真实 missionId + currentTask）
 *   - focusedSummary 注入 execRequest.context.assembledContext（StubEngine 可观测）
 *   - 装配失败不阻断执行（非阻断）
 *   - 未注入 engine 时行为不变（零风险）
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { MorPexRuntime } from '../src/execution/runtime/MorPexRuntime.js';
import { MissionController } from '../src/execution/runtime/mission/MissionController.js';
import { ArtifactFacade } from '../src/knowledge/artifact/ArtifactFacade.js';
import { VerificationEngine } from '../src/evaluation/verification/VerificationEngine.js';
import { ComplianceChecker } from '../src/governance/ComplianceChecker.js';
import { ApprovalGate } from '../src/governance/ApprovalGate.js';
import { ExperienceMiner } from '../src/evolution/ExperienceMiner.js';
import { ExecutionSimulator } from '../src/execution/runtime/simulation/ExecutionSimulator.js';
import { DynamicTeamOrchestrator } from '../src/execution/DynamicTeamOrchestrator.js';
import type { ExecutionRequest } from '../src/execution/UnifiedExecutionEngine.js';

class StubEngine {
  calls: ExecutionRequest[] = [];
  constructor(private result: any) {}
  async execute(request: ExecutionRequest): Promise<any> {
    this.calls.push(request);
    return this.result;
  }
}

function buildRuntime(engineResult: any, engine?: StubEngine) {
  const bus = new EventBus();
  const missionController = new MissionController(bus);
  const artifactFacade = new ArtifactFacade(bus);
  const stubEngine = engine ?? new StubEngine(engineResult);
  const runtime = new MorPexRuntime(
    bus,
    missionController,
    stubEngine as any,
    artifactFacade,
    new VerificationEngine(),
    new ComplianceChecker(),
    new ApprovalGate(),
    new ExperienceMiner(),
    new ExecutionSimulator(),
    new DynamicTeamOrchestrator(),
  );
  return { runtime, missionController, stubEngine, bus };
}

/** mock 装配引擎：记录调用，可配置失败 */
function mockEngine(opts?: { fail?: boolean; summary?: string }) {
  const calls: Array<Record<string, unknown>> = [];
  const engine = {
    calls,
    async assemble(input: any) {
      calls.push(input);
      if (opts?.fail) throw new Error('assemble 暂不可用');
      return { focusedSummary: opts?.summary ?? `聚焦摘要: ${input.goal ?? ''}`, contextId: 'ctx_1' };
    },
  };
  return engine as any;
}

describe('MorPexRuntime — 功能③ 装配统一接线（orchestrate 后）', () => {
  it('注入 engine 后：run() 调用 assemble（真实 missionId + currentTask）并把 focusedSummary 传入 execRequest', async () => {
    const engine = new StubEngine({ ok: true, output: { text: 'ok' } });
    const { runtime, stubEngine } = buildRuntime(null, engine);
    const mock = mockEngine({ summary: '聚焦摘要: 开发设备' });
    runtime.setContextAssemblyEngine(mock);

    const result = await runtime.run('开发设备');
    expect(result.ok).toBe(true);
    // assemble 被调用（orchestrate 后），携带真实 missionId（非 pre-xxx 临时值）
    expect(mock.calls.length).toBeGreaterThanOrEqual(1);
    const input = mock.calls[0] as { missionId?: string; currentTask?: { taskId?: string } };
    expect(input.missionId).toBeTruthy();
    expect(input.missionId.startsWith('pre-')).toBe(false); // 真实 missionId
    expect(input.currentTask?.taskId).toBe(input.missionId); // taskRef = 真实 missionId
    // focusedSummary 注入 execRequest.context
    const execReq = stubEngine.calls[0];
    expect((execReq.context as Record<string, unknown>).assembledContext).toContain('聚焦摘要');
  });

  it('装配失败不阻断执行（非阻断）', async () => {
    const { runtime } = buildRuntime({ ok: true, output: { text: 'ok' } });
    runtime.setContextAssemblyEngine(mockEngine({ fail: true }));
    const result = await runtime.run('写 hello');
    expect(result.ok).toBe(true); // 装配抛错不影响执行
  });

  it('未注入 engine 时行为不变（零风险）', async () => {
    const { runtime, stubEngine } = buildRuntime({ ok: true, output: { text: 'ok' } });
    const result = await runtime.run('写 hello');
    expect(result.ok).toBe(true);
    expect(stubEngine.calls[0].context).toBeTruthy();
  });
});
