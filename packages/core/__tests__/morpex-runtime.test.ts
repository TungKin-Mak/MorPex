/**
 * MorPexRuntime.run() 9 阶段闭环测试（L5 Execution）— 此前无直接测试
 *
 * 覆盖 run() 全管线编排（stub UnifiedExecutionEngine，其余真实装配）：
 *   - 成功路径：Pipeline(mission/team) → Simulation → Engine → Artifact(输出+代码) →
 *     Verification → Compliance → Approval → Experience → Mission COMPLETED
 *   - Engine 失败 → ok:false + errors + 无 artifact + mission 记录 block
 *   - Simulation 不可行（hard fail 默认 true）→ 提前终止
 *   - mission 阶段推进断言（getMission → COMPLETED）
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

// ── Stub 执行引擎（可注入成功/失败/超时结果，并记录调用）──
class StubEngine {
  calls: ExecutionRequest[] = [];
  constructor(private result: any) {}
  async execute(request: ExecutionRequest): Promise<any> {
    this.calls.push(request);
    return this.result;
  }
}

function buildRuntime(engineResult: any, simulator?: ExecutionSimulator) {
  const bus = new EventBus();
  const missionController = new MissionController(bus);
  const artifactFacade = new ArtifactFacade(bus);
  const verificationEngine = new VerificationEngine();
  const complianceChecker = new ComplianceChecker();
  const approvalGate = new ApprovalGate();
  const experienceMiner = new ExperienceMiner();
  const teamOrchestrator = new DynamicTeamOrchestrator();
  const runtime = new MorPexRuntime(
    bus,
    missionController,
    new StubEngine(engineResult) as any,
    artifactFacade,
    verificationEngine,
    complianceChecker,
    approvalGate,
    experienceMiner,
    simulator ?? new ExecutionSimulator(),
    teamOrchestrator,
  );
  return { runtime, missionController, artifactFacade, bus };
}

describe('MorPexRuntime — 成功路径闭环', () => {
  it('run() 成功：ok:true + 产出文档与代码 artifact + mission COMPLETED', async () => {
    const { runtime, missionController, artifactFacade } = buildRuntime({
      ok: true, executionId: 'exe_stub_1', mode: 'auto', status: 'completed',
      output: 'function hello() { return 42; }', duration: 50,
    });

    const result = await runtime.run('写一个 hello 函数并输出代码', { departmentId: 'engineering' });

    // 闭环主断言
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Phase 3：Engine 不再建 artifact，由 Runtime 建 —— 输出含 function → doc + code 两个
    expect(result.artifacts.length).toBeGreaterThanOrEqual(2);
    const types = result.artifacts.map((a: any) => a.type);
    expect(types).toContain('document');
    expect(types).toContain('code');
    // artifactFacade 中真实存在
    const all = artifactFacade.getAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Phase 4-6：verification/compliance/approval/experience 均产出
    expect(result.verification).toBeTruthy();
    expect(result.compliance).toBeTruthy();
    expect(result.approval).toBeTruthy();
    // 功能③ D：experience 含 mined + archived（历史抽离——Mission 摘要 {missionId, goal, result, keyRefs}）
    expect((result.experience as any)?.mined).toBe(true);
    expect((result.experience as any)?.archived).toBeTruthy();
    expect((result.experience as any)?.archived?.missionId).toBeTruthy();
    expect((result.experience as any)?.archived?.result).toBe('success');
    // Phase 6：mission 推进到 COMPLETED
    const mission = missionController.getMission(result.context.mission.missionId);
    expect(mission?.phase).toBe('RELEASING');
    expect(mission?.status).toBe('COMPLETED');
  }, 30000);

  it('输出无代码 → 仅产出 document artifact', async () => {
    const { runtime } = buildRuntime({
      ok: true, executionId: 'exe_stub_2', mode: 'auto', status: 'completed',
      output: '这是一份纯文字报告，没有代码块。', duration: 30,
    });
    const result = await runtime.run('写一份市场分析报告');
    expect(result.ok).toBe(true);
    const types = result.artifacts.map((a: any) => a.type);
    expect(types).toEqual(['document']);
  }, 30000);
});

describe('MorPexRuntime — 失败与降级路径', () => {
  it('Engine 失败 → ok:false + errors + 无 artifact', async () => {
    const { runtime } = buildRuntime({
      ok: false, executionId: 'exe_stub_f1', mode: 'auto', status: 'failed',
      error: 'stub engine exploded', duration: 10,
    });
    const result = await runtime.run('写一个 hello 函数');
    expect(result.ok).toBe(false);
    expect(result.artifacts).toHaveLength(0);
    expect(result.errors.some(e => e.includes('stub engine exploded'))).toBe(true);
  }, 30000);

  it('Simulation 不可行（hard fail 默认）→ 提前终止 ok:false + 资源 block', async () => {
    const fakeSimulator = {
      simulate: () => ({
        feasible: false,
        blockingIssues: ['测试注入：资源不足', 'budget over'],
        warnings: [], suggestions: [], estimatedCost: 999, estimatedDuration: 999, riskLevel: 'HIGH',
      }),
    } as unknown as ExecutionSimulator;

    const { runtime, missionController } = buildRuntime({
      ok: true, output: 'x', duration: 1,
    }, fakeSimulator);

    const result = await runtime.run('一个必然资源不足的目标');
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('资源不足'))).toBe(true);
    expect(result.artifacts).toHaveLength(0);
  }, 30000);
});

describe('MorPexRuntime — 事件与调用侧', () => {
  it('engine.execute 收到正确的 ExecutionRequest（goal/context 注入）', async () => {
    const bus = new EventBus();
    const mc = new MissionController(bus);
    const af = new ArtifactFacade(bus);
    const stub = new StubEngine({ ok: true, output: 'ok', duration: 5 });
    const runtime = new MorPexRuntime(
      bus, mc, stub as any, af,
      new VerificationEngine(), new ComplianceChecker(), new ApprovalGate(),
      new ExperienceMiner(), new ExecutionSimulator(), new DynamicTeamOrchestrator(),
    );
    await runtime.run('构建一个 REST API 服务', { departmentId: 'engineering' });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].goal).toContain('REST API');
    // ═══ 会话 15（去兜底化）：ExecutionRequest 已移除 mode——引擎现行单路径（内部路由）═══
    expect(stub.calls[0].mode).toBeUndefined();
    // 契约：departmentId 由 context.team.departments[0] 派生（非 options 直传）——generic 工作流可为 undefined
    expect(stub.calls[0].context?.executionId).toBeTruthy();
    expect(stub.calls[0].context?.missionId).toBeTruthy();
  }, 30000);
});
