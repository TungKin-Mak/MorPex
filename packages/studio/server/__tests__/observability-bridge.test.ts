/**
 * 架构可观测性桥接验证（S34）— 此前观测面为空壳：/audit 503、observations/heartbeats 全空
 *
 * 验证 runtime-bridge 让真实执行可观测：
 *   - /audit 可用（绕过审计基础设施活）——返回合规报告而非 503
 *   - 真实 goal 执行 → observations/span-tree 记录 L5-execution 模块与调用链
 *   - /modules-v2 + /exercise-status → 实际执行的模块 online/ACTIVE/exercised
 *   - /topology 反映真实调用边
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudioServer } from '../StudioServer.js';

let server: StudioServer;
let baseUrl: string;
let execId = '';

async function getJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  process.env.MEMORY_ENGINE = 'mock';
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;
  // 清空旧观测，保证确定性
  await fetch(`${baseUrl}/api/observability/reset`, { method: 'POST' });
}, 60000);

afterAll(async () => {
  await server?.stop();
  delete process.env.MEMORY_ENGINE;
}, 15000);

describe('架构可观测 — 服务接线', () => {
  it('/audit 可用（此前 503：ArchitectureAuditor 从未初始化）', async () => {
    const { status, body } = await getJson('/api/observability/audit');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.report).toBeTruthy();
    expect(body.report.totalModules).toBeGreaterThan(0);
    // 报告含 findings（绕过检测的真实输出——直连 execute 会暴露未调用的必需模块）
    expect(Array.isArray(body.report.findings)).toBe(true);
  });

  it('/replay/sessions 可用（ReplayEngine 已接线）', async () => {
    const { status, body } = await getJson('/api/observability/replay/sessions');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe('架构可观测 — 真实执行产生观测', () => {
  it('POST /api/execute 真实执行 → observations 记录调用链 + 执行 ID 可查', async () => {
    const execRes = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '写一个 todo 应用的代码实现', mode: 'auto' }),
    });
    const execBody = await execRes.json();
    expect(execRes.status).toBe(200);
    expect(execBody.executionId).toBeTruthy();
    execId = execBody.executionId;

    // observations 应有该执行的事件（至少 started/completed）
    const { body } = await getJson(`/api/observability/observations?limit=200`);
    expect(body.count).toBeGreaterThan(0);
    const mine = body.observations.filter((o: any) => o.executionId === execId);
    expect(mine.length).toBeGreaterThanOrEqual(2); // started + completed
    // 层标注正确（L5-execution 执行引擎）
    expect(mine.some((o: any) => o.source.layer === 'L5-execution')).toBe(true);
  }, 60000);

  it('span-tree 返回该执行的 span 链（含 parentId 父子关系）', async () => {
    const { status, body } = await getJson(`/api/observability/span-tree/${execId}`);
    expect(status).toBe(200);
    expect(body.spans.length).toBeGreaterThanOrEqual(2);
    // 首 span 为根（无 parentId），后续有 parentId
    expect(body.spans[0].parentId).toBeUndefined();
  });

  it('modules-v2 显示实际执行模块 online/ACTIVE/exercised', async () => {
    const { body } = await getJson('/api/observability/modules-v2');
    expect(body.totalModules).toBeGreaterThanOrEqual(1);
    const execMod = body.modules.find((m: any) => m.name === 'unified-execution-engine');
    expect(execMod).toBeTruthy();
    expect(execMod.exercised).toBe(true);
    expect(['online', 'degraded']).toContain(execMod.displayStatus);
    expect(execMod.callCount).toBeGreaterThan(0);
  });

  it('exercise-status 覆盖率 > 0 + topology 反映调用边', async () => {
    const { body } = await getJson('/api/observability/exercise-status');
    expect(body.exercisedCount).toBeGreaterThanOrEqual(1);
    const topo = await getJson('/api/observability/topology');
    expect(Array.isArray(topo.body.topology)).toBe(true);
    expect(topo.body.topology.length).toBeGreaterThanOrEqual(1);
  });

  it('/audit 检测到绕过（直连 execute 未走治理层 → REQUIRED_MODULE_NEVER_CALLED）', async () => {
    // 这是绕过检测的价值证明：/api/execute 直连执行引擎，治理层必需模块未被调用
    const { body } = await getJson('/api/observability/audit');
    const neverCalled = body.report.findings.filter((f: any) => f.issue === 'REQUIRED_MODULE_NEVER_CALLED');
    // 架构契约里治理/认知层必需模块若未执行应被标记（证明审计在看调用链，而非空转）
    expect(neverCalled.length).toBeGreaterThan(0);
  });
});

describe('架构可观测 — 完整 8 层链路（chat/send 走 CompanyFacade 全管线）', () => {
  it('chat/send 全管线 → 观测面出现 L1-L8 各层事件（架构怎么运行可见）', async () => {
    await fetch(`${baseUrl}/api/observability/reset`, { method: 'POST' });
    const res = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '写一个 hello 程序' }),
    });
    expect(res.status).toBe(200);

    const { body } = await getJson('/api/observability/observations?limit=300');
    const layers = new Set(body.observations.map((o: any) => o.source.layer));
    // 完整管线应覆盖至少 7 层：L1 治理 / L2 gate / L3 规划 / L5 执行 / L6 评价 / L7 知识 / L8 演化
    expect(layers.has('L1-governance')).toBe(true);
    expect(layers.has('L2-gate')).toBe(true);      // ontology.grounded（Ontology Gate 强制查询）
    expect(layers.has('L3-planning')).toBe(true);  // planner.plan.started/completed
    expect(layers.has('L5-execution')).toBe(true);
    expect(layers.has('L6-evaluation')).toBe(true);
    expect(layers.has('L7-knowledge')).toBe(true);
    expect(layers.has('L8-evolution')).toBe(true);
  }, 180000);

  it('全链执行后 /audit 无必需模块未调用错误（有调用链依据）', async () => {
    const { body } = await getJson('/api/observability/audit?strict=false');
    const errors = body.report.findings.filter((f: any) => f.severity === 'error');
    expect(errors).toHaveLength(0); // 完整管线覆盖全部必需模块 → 无绕过
  }, 15000);
});
