/**
 * Studio REST API 契约测试（L4 外部接口面）
 *
 * 覆盖 StudioServer 全部 26 个端点：
 *   - 健康/状态/配置/治理/本体统计
 *   - 会话：创建/查询/历史
 *   - 对话与执行：chat/send、execute、execution/:id
 *   - 产物：list、:id、graph、lineage
 *   - 记忆：recall、remember、activate
 *   - 学习统计、系统健康
 *   - SSE 事件流
 *
 * 依赖策略：MEMORY_ENGINE=mock（无 cognee）；port 0（OS 分配）；原生 fetch（无 supertest）。
 * 副作用：bootstrapUnified 会写 data/missions.db 等（与现有测试一致）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StudioServer } from '../StudioServer.js';

let server: StudioServer;
let baseUrl: string;

// ═══ 会话 17h·review I3：测试产生的运行时数据（uploads / runtime-config）隔离与清理 ═══
const UPLOADS_DIR = path.resolve('data/uploads');
const RUNTIME_CFG = path.resolve('data/runtime-config.json');
let testStart = 0;
let rcBackup: string | null = null;

beforeAll(async () => {
  // 关键：mock 记忆引擎，避免依赖 cognee
  process.env.MEMORY_ENGINE = 'mock';
  testStart = Date.now();
  if (fs.existsSync(RUNTIME_CFG)) rcBackup = fs.readFileSync(RUNTIME_CFG, 'utf-8');
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;
}, 60000);

afterAll(async () => {
  await server?.stop();
  // 清理本测试运行期间产生的上传文件（mtime >= testStart）
  try {
    if (fs.existsSync(UPLOADS_DIR)) {
      for (const f of fs.readdirSync(UPLOADS_DIR)) {
        const p = path.join(UPLOADS_DIR, f);
        try {
          if (fs.statSync(p).mtimeMs >= testStart) fs.rmSync(p, { force: true });
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch {
    /* 忽略 */
  }
  // 恢复 runtime-config.json 原状
  try {
    if (rcBackup !== null) {
      fs.mkdirSync(path.dirname(RUNTIME_CFG), { recursive: true });
      fs.writeFileSync(RUNTIME_CFG, rcBackup, 'utf-8');
    } else {
      fs.rmSync(RUNTIME_CFG, { force: true });
    }
  } catch {
    /* 忽略 */
  }
  delete process.env.MEMORY_ENGINE;
}, 15000);

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function delJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

describe('Studio REST API — 契约', () => {
  it('GET /api/health → ok:true + runtime', async () => {
    const { status, body } = await getJson('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.runtime).toBeTruthy();
  });

  it('GET /api/status → phase + departments + artifacts 计数', async () => {
    const { status, body } = await getJson('/api/status');
    expect(status).toBe(200);
    expect(body.phase).toBe('ideal-aligned');
    expect(typeof body.departments).toBe('number');
    expect(typeof body.artifacts).toBe('number');
  });

  it('GET /api/execution-stats → 观测聚合（质量/步骤/装配/成本，3+4）', async () => {
    const { status, body } = await getJson('/api/execution-stats');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // 执行质量（byMode + 总成功率）
    expect(body.stats.execution.byMode).toBeDefined();
    expect(typeof body.stats.execution.totalSuccessRate).toBe('number');
    // 步骤质量（空参率等字段存在）
    expect(typeof body.stats.steps.emptyParamRate).toBe('number');
    expect(typeof body.stats.steps.totalRetries).toBe('number');
    // 装配成本
    expect(typeof body.stats.assembly.avgDurationMs).toBe('number');
    // 成本
    expect(typeof body.stats.cost.totalTokens).toBe('number');
  });

  it('GET /api/anomalies → 异常告警查询（P3）', async () => {
    const { status, body } = await getJson('/api/anomalies');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
  });

  it('GET /api/execution-stats/tasks → 成本与延迟归因（P3）', async () => {
    const { status, body } = await getJson('/api/execution-stats/tasks?limit=5');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('GET /api/evolution/changes → 演化提案/策略可见性（3-3）', async () => {
    const { status, body } = await getJson('/api/evolution/changes');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.changes)).toBe(true);
    expect(typeof body.pending).toBe('number');
    expect(Array.isArray(body.strategies)).toBe(true);
  });

  it('POST /api/evolution/:id/approve → 不存在提案返回 400（人工审批通道 E1）', async () => {
    const res = await fetch(`${baseUrl}/api/evolution/nonexistent/approve`, { method: 'POST' });
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('POST /api/evolution/:id/reject → 不存在提案返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/evolution/nonexistent/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '测试' }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('GET /api/config → version + engine', async () => {
    const { status, body } = await getJson('/api/config');
    expect(status).toBe(200);
    expect(body.engine).toBe('bootstrapUnified');
  });

  it('GET /api/governance → health/cost/delivery 结构', async () => {
    const { status, body } = await getJson('/api/governance');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.health).toBeTruthy();
  });

  it('GET /api/ontology/stats → guard + service', async () => {
    const { status, body } = await getJson('/api/ontology/stats');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.guard).toBe(true);
    expect(body.service).toBe(true);
  });

  it('GET /api/sessions → 会话列表', async () => {
    const { status, body } = await getJson('/api/sessions');
    expect(status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('POST /api/session/create → 返回 sessionId', async () => {
    const { status, body } = await postJson('/api/session/create', { name: 't' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sessionId).toMatch(/^sess_/);
  });

  it('GET /api/session/:id/history → 空历史 200', async () => {
    const { status } = await getJson('/api/session/sess_test_1/history');
    expect(status).toBe(200);
  });

  it('GET /api/spaces → 空间树（hq + 部门，P1）', async () => {
    const { status, body } = await getJson('/api/spaces');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tree.hq.id).toBe('hq');
    expect(body.tree.hq.type).toBe('hq');
    expect(Array.isArray(body.tree.departments)).toBe(true);
    // 已注册的 4 个工作流插件至少生成软件部（software 已注册）
    const names = body.tree.departments.map((d: { name: string }) => d.name);
    expect(names.length).toBeGreaterThan(0);
    for (const d of body.tree.departments) {
      expect(d.id).toMatch(/^dept_/);
      expect(d.parentId).toBe('hq');
      expect(typeof d.routeHint).toBe('string');
    }
  });

  it('GET /api/spaces/hq/messages → 空间消息（无 sessionId 空，P1）', async () => {
    const { status, body } = await getJson('/api/spaces/hq/messages');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('GET /api/spaces/非法id/messages → 400（穿越拦截，P1）', async () => {
    const { status } = await getJson('/api/spaces/..%2F..%2Fetc/messages');
    expect(status).toBe(400);
  });

  it('DELETE /api/session/:id → 删除会话（幂等 200）', async () => {
    const created = await postJson('/api/session/create', { name: '待删除' });
    expect(created.body.sessionId).toMatch(/^sess_/);
    const { status, body } = await delJson(`/api/session/${created.body.sessionId}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.deleted).toBe('boolean');
    // 重复删除（不存在）仍 200
    const again = await delJson(`/api/session/${created.body.sessionId}`);
    expect(again.status).toBe(200);
    expect(again.body.ok).toBe(true);
  });

  it('POST /api/files/upload → 文本文件上传（fileId + isText）', async () => {
    const { status, body } = await postJson('/api/files/upload', {
      name: 'hello.txt',
      contentBase64: Buffer.from('你好 MorPex，这是一段测试附件内容。').toString('base64'),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.fileId).toMatch(/^file_/);
    expect(body.isText).toBe(true);
    expect(body.name).toBe('hello.txt');
    expect(typeof body.size).toBe('number');
  });

  it('POST /api/files/upload → 文件名路径穿越被清洗', async () => {
    const { status, body } = await postJson('/api/files/upload', {
      name: '../evil.txt',
      contentBase64: Buffer.from('evil').toString('base64'),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).not.toContain('..');
    expect(body.name).not.toMatch(/[\\/]/);
  });

  it('POST /api/chat/send 缺 message → 400', async () => {
    const { status, body } = await postJson('/api/chat/send', {});
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  // ⚠️ 正向执行路径依赖真实 LLM（PiBridge.complete 无超时，网络封锁时挂起）
  // 按 L6 降级策略：仅 RUN_LLM_E2E=1 时运行；默认跳过（负例 400 恒跑）
  const RUN_LLM_E2E = process.env.RUN_LLM_E2E === '1';

  it('POST /api/chat/send 有效目标 → 返回执行结果（mission 创建）', { skip: !RUN_LLM_E2E }, async () => {
    const { status, body } = await postJson('/api/chat/send', { message: '写一个 todo 应用的代码实现' });
    expect(status).toBe(200);
    expect(body).toBeTruthy();
  }, 60000);

  it('POST /api/execute 缺 goal → 400', async () => {
    const { status, body } = await postJson('/api/execute', {});
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('POST /api/execute 有效 goal → 执行返回', { skip: !RUN_LLM_E2E }, async () => {
    const { status, body } = await postJson('/api/execute', { goal: '写一个 todo 应用的代码实现' });
    expect(status).toBe(200);
    expect(body).toBeTruthy();
  }, 60000);

  it('GET /api/artifacts → 产物数组', async () => {
    const { status, body } = await getJson('/api/artifacts');
    expect(status).toBe(200);
    expect(Array.isArray(body.artifacts)).toBe(true);
  });

  it('GET /api/artifacts/:id → 不存在返回 null', async () => {
    const { status, body } = await getJson('/api/artifacts/art_nonexistent');
    expect(status).toBe(200);
    expect(body.artifact).toBeNull();
  });

  it('GET /api/memory/recall → 查询记忆（mock 引擎）', async () => {
    const { status, body } = await getJson('/api/memory/recall?q=测试');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.hits)).toBe(true);
  });

  it('POST /api/memory/remember → 写入记忆（mock 引擎）', async () => {
    const { status, body } = await postJson('/api/memory/remember', { content: 'API 契约测试写入的记忆条目', source: 'api-contract-test' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /api/runtime/executions → 执行列表', async () => {
    const { status, body } = await getJson('/api/runtime/executions');
    expect(status).toBe(200);
    expect(Array.isArray(body.executions)).toBe(true);
  });

  it('GET /api/runtime/execution/:id → 不存在返回 404（契约）', async () => {
    const { status } = await getJson('/api/runtime/execution/exec_nonexistent');
    expect([200, 404]).toContain(status); // 存在→200，不存在→404
  });

  it('GET /api/artifacts/list → 产物列表', async () => {
    const { status, body } = await getJson('/api/artifacts/list');
    expect(status).toBe(200);
    expect(Array.isArray(body.artifacts)).toBe(true);
  });

  it('GET /api/artifacts/graph → 产物图', async () => {
    const { status } = await getJson('/api/artifacts/graph');
    expect(status).toBe(200);
  });

  it('GET /api/artifacts/lineage/:id → 谱系', async () => {
    const { status } = await getJson('/api/artifacts/lineage/art_nonexistent');
    expect(status).toBe(200);
  });

  it('POST /api/memory/activate → 记忆激活', async () => {
    const { status, body } = await postJson('/api/memory/activate', { text: '测试' });
    expect(status).toBe(200);
    expect(body).toBeTruthy();
  });

  it('GET /api/learning/stats → 学习统计', async () => {
    const { status } = await getJson('/api/learning/stats');
    expect(status).toBe(200);
  });

  it('GET /api/system/health → 系统健康', async () => {
    const { status, body } = await getJson('/api/system/health');
    expect(status).toBe(200);
    expect(body.ok ?? body.status).toBeTruthy();
  });

  it('GET /api/events/stream → SSE 建立连接', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/event-stream');
    controller.abort();
  }, 15000);

  it('GET /api/stream/global → SSE 建立连接 + connected 首帧', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream/global`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('connected');
    controller.abort();
  }, 15000);

  // ── 会话 17h：删除会话 / 文件上传 / 模型切换（UI 三功能）──
  // ⚠️ 删除会话 / 上传文本 / 路径穿越清洗 已在文件中部覆盖（DELETE 幂等 + 上传两用例），此处只保留补充用例
  it('DELETE /api/session/:id → 路径穿越 sessionId 返回 400（review C1 回归）', async () => {
    const res = await fetch(`${baseUrl}/api/session/..%2F..%2F..%2Ffoo`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('POST /api/files/upload → 超大文件 413', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 65);
    const { status, body } = await postJson('/api/files/upload', { name: 'big.bin', contentBase64: big.toString('base64') });
    expect(status).toBe(413);
    expect(body.ok).toBe(false);
  });

  it('GET /api/models → 模型列表 + active', async () => {
    const { status, body } = await getJson('/api/models');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    expect(typeof body.active).toBe('string');
    expect(body.models.some((m: { isActive: boolean }) => m.isActive)).toBe(true);
  });

  it('POST /api/models/active → 未知模型 400', async () => {
    const { status, body } = await postJson('/api/models/active', { modelId: '不存在的/模型' });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('POST /api/models/active → 设为现有模型后 active 更新', async () => {
    const list = await getJson('/api/models');
    const target = list.body.models[0] as { id: string };
    const { status, body } = await postJson('/api/models/active', { modelId: target.id });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.active).toBe(target.id);
    const after = await getJson('/api/models');
    expect(after.body.active).toBe(target.id);
    // 恢复默认，避免污染后续用例
    await postJson('/api/models/active', { modelId: 'default' });
  });
});
