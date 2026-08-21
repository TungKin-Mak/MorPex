/**
 * 原语注册中心测试（L6 Tools / DomainPrimitiveRegistry + 5 基础原语）— 此前零测试引用
 *
 * 覆盖：
 *   - DomainPrimitiveRegistry：注册/注销/匹配/统计/执行统计（全 static，测试前后 clear）
 *   - 5 个基础原语 canHandle 匹配逻辑
 *   - 执行注入：FileOperation/Shell/APICall 未注入时降级失败 + 注入后参数转发
 *   - Shell 白名单安全拦截
 *   - KnowledgeQueryPrimitive / ArtifactGenerationPrimitive 门禁与参数校验
 *   - ArtifactGenerationPrimitive 成功路径 + 副作用前校验阻断 + 文件写入
 *
 * ⚠️ 顺序敏感（singleFork 共享模块级状态）：
 *   - "未初始化门禁抛错" 用例必须在本文件任何 initialize* 调用之前执行
 *   - DomainPrimitiveRegistry 每次用例前后 clear()
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { DomainPrimitiveRegistry } from '../src/infrastructure/tools/DomainPrimitiveRegistry.js';
import { KnowledgeQueryPrimitive } from '../src/infrastructure/tools/primitives/KnowledgeQueryPrimitive.js';
import { FileOperationPrimitive } from '../src/infrastructure/tools/primitives/FileOperationPrimitive.js';
import { ShellExecutionPrimitive } from '../src/infrastructure/tools/primitives/ShellExecutionPrimitive.js';
import { APICallPrimitive } from '../src/infrastructure/tools/primitives/APICallPrimitive.js';
import {
  ArtifactGenerationPrimitive,
  initializeOntologyGateForArtifact,
} from '../src/infrastructure/tools/primitives/ArtifactGenerationPrimitive.js';
import { ForcedQueryGuard } from '../src/gate/ForcedQueryGuard.js';
import { GateContextRequiredError, type KnowledgeContextPackage } from '../src/gate/context.js';
import { PrimitiveGate } from '../src/infrastructure/tools/primitives/gateBinding.js';
import type { ActionPrimitive } from '../src/infrastructure/tools/primitives/types.js';

/** Wave 4：有效的 KnowledgeContextPackage 夹具（供副作用原语 Gate 用例使用） */
function validGate(): KnowledgeContextPackage {
  return {
    executionId: 'exec_gate',
    riskTier: 'tier-1',
    queryCallCount: 2,
    retrievedIds: ['obj_1'],
    referenceCheck: { valid: true, missing: [], knownCount: 1 },
    issuedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════
// DomainPrimitiveRegistry — 注册/匹配/统计
// ═══════════════════════════════════════════════
describe('DomainPrimitiveRegistry — 注册与查询', () => {
  const fake: ActionPrimitive = {
    name: 'fake_primitive',
    description: '测试原语',
    inputSchema: {},
    canHandle: (t: string) => (t.includes('测试') ? 0.9 : 0),
    execute: async () => ({ success: true, data: { ok: 1 } }),
  };

  beforeEach(() => DomainPrimitiveRegistry.clear());
  afterEach(() => DomainPrimitiveRegistry.clear());

  it('register 后 isRegistered/list/listNames/get 可查到', () => {
    DomainPrimitiveRegistry.register(fake);
    expect(DomainPrimitiveRegistry.isRegistered('fake_primitive')).toBe(true);
    expect(DomainPrimitiveRegistry.listNames()).toContain('fake_primitive');
    expect(DomainPrimitiveRegistry.list()).toHaveLength(1);
    expect(DomainPrimitiveRegistry.get('fake_primitive')).toBe(fake);
  });

  it('重复注册覆盖（不重复计数）', () => {
    DomainPrimitiveRegistry.register(fake);
    DomainPrimitiveRegistry.register(fake);
    expect(DomainPrimitiveRegistry.list()).toHaveLength(1);
  });

  it('registerMultiple 批量注册', () => {
    const a: ActionPrimitive = { ...fake, name: 'a' };
    const b: ActionPrimitive = { ...fake, name: 'b' };
    DomainPrimitiveRegistry.registerMultiple([a, b]);
    expect(DomainPrimitiveRegistry.listNames()).toEqual(['a', 'b']);
  });

  it('unregister 后 isRegistered=false', () => {
    DomainPrimitiveRegistry.register(fake);
    expect(DomainPrimitiveRegistry.unregister('fake_primitive')).toBe(true);
    expect(DomainPrimitiveRegistry.isRegistered('fake_primitive')).toBe(false);
    expect(DomainPrimitiveRegistry.unregister('fake_primitive')).toBe(false);
  });

  it('clear 清空所有注册', () => {
    DomainPrimitiveRegistry.register(fake);
    DomainPrimitiveRegistry.clear();
    expect(DomainPrimitiveRegistry.list()).toHaveLength(0);
    expect(DomainPrimitiveRegistry.getStats().totalPrimitives).toBe(0);
  });
});

describe('DomainPrimitiveRegistry — 匹配与执行', () => {
  const fake: ActionPrimitive = {
    name: 'fake_primitive',
    description: '测试原语',
    inputSchema: {},
    canHandle: (t: string) => (t.includes('测试') ? 0.9 : 0),
    execute: async () => ({ success: true, data: { ok: 1 } }),
  };
  const low: ActionPrimitive = {
    name: 'low_match', description: '', inputSchema: {},
    canHandle: () => 0.3,
    execute: async () => ({ success: true, data: 'low' }),
  };
  const high: ActionPrimitive = {
    name: 'high_match', description: '', inputSchema: {},
    canHandle: () => 0.9,
    execute: async () => ({ success: true, data: 'high' }),
  };
  const none: ActionPrimitive = {
    name: 'no_match', description: '', inputSchema: {},
    canHandle: () => 0,
    execute: async () => ({ success: true, data: 'none' }),
  };

  beforeEach(() => DomainPrimitiveRegistry.clear());
  afterEach(() => DomainPrimitiveRegistry.clear());

  it('match 按置信度降序返回', () => {
    DomainPrimitiveRegistry.registerMultiple([low, high, none]);
    const r = DomainPrimitiveRegistry.match('任意任务');
    expect(r.map(x => x.primitive.name)).toEqual(['high_match', 'low_match']);
    expect(r[0].confidence).toBe(0.9);
  });

  it('matchBest 返回最高置信度', () => {
    DomainPrimitiveRegistry.registerMultiple([low, high]);
    const best = DomainPrimitiveRegistry.matchBest('任意任务');
    expect(best!.primitive.name).toBe('high_match');
  });

  it('无匹配 → match 空 / matchBest undefined', () => {
    DomainPrimitiveRegistry.register(none);
    expect(DomainPrimitiveRegistry.match('任意任务')).toHaveLength(0);
    expect(DomainPrimitiveRegistry.matchBest('任意任务')).toBeUndefined();
  });

  it('execute 未注册原语 → {success:false, error}', async () => {
    const r = await DomainPrimitiveRegistry.execute('ghost', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('未注册');
  });

  it('execute 成功 → 更新 callCount/successCount/stats', async () => {
    DomainPrimitiveRegistry.register(fake as ActionPrimitive);
    await DomainPrimitiveRegistry.execute('fake_primitive', {}, { departmentId: 'eng' });
    await DomainPrimitiveRegistry.execute('fake_primitive', {}, { departmentId: 'eng' });

    const stats = DomainPrimitiveRegistry.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.successRate).toBe(1);
    expect(stats.topPrimitives[0].name).toBe('fake_primitive');
    expect(stats.topPrimitives[0].callCount).toBe(2);
  });

  it('execute 原语抛错 → {success:false} 且 successRate < 1', async () => {
    const boom: ActionPrimitive = {
      name: 'boom', description: '', inputSchema: {},
      canHandle: () => 0.8,
      execute: async () => { throw new Error('boom'); },
    };
    DomainPrimitiveRegistry.register(boom);
    const r = await DomainPrimitiveRegistry.execute('boom', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('boom');
    expect(DomainPrimitiveRegistry.getStats().successRate).toBe(0);
  });

  it('execute 携带 departmentId 传给原语 context', async () => {
    let gotDept: string | undefined;
    const deptAware: ActionPrimitive = {
      name: 'dept_aware', description: '', inputSchema: {},
      canHandle: () => 0.8,
      execute: async (_p, ctx) => { gotDept = ctx?.departmentId; return { success: true }; },
    };
    DomainPrimitiveRegistry.register(deptAware);
    await DomainPrimitiveRegistry.execute('dept_aware', {}, { departmentId: 'finance' });
    expect(gotDept).toBe('finance');
  });
});

// ═══════════════════════════════════════════════
// 5 个基础原语 — canHandle 匹配逻辑（直接实例，无状态）
// ═══════════════════════════════════════════════
describe('基础原语 — canHandle 匹配', () => {
  it('KnowledgeQueryPrimitive：查询类任务 1.0 / 生成类 0.4 / 兜底 0.2', () => {
    const p = new KnowledgeQueryPrimitive();
    expect(p.canHandle('帮我查询产品知识')).toBe(1.0);
    expect(p.canHandle('查找公司记忆')).toBe(1.0);
    expect(p.canHandle('生成一个文档')).toBe(0.4);
    expect(p.canHandle('优化流程')).toBe(0.35);
    expect(p.canHandle('hello world')).toBe(0.2);
  });

  it('FileOperationPrimitive：文件类 0.95 / 产物 0.7 / 无关 0', () => {
    const p = new FileOperationPrimitive();
    expect(p.canHandle('读取文件内容')).toBe(0.95);
    expect(p.canHandle('write a file')).toBe(0.95);
    expect(p.canHandle('生成一个产物')).toBe(0.7);
    expect(p.canHandle('分析市场趋势')).toBe(0);
  });

  it('ShellExecutionPrimitive：执行类 0.9 / 部署类 0.7 / 无关 0', () => {
    const p = new ShellExecutionPrimitive();
    expect(p.canHandle('编译固件')).toBe(0.9);
    expect(p.canHandle('run build')).toBe(0.9);
    expect(p.canHandle('部署到服务器')).toBe(0.7);
    expect(p.canHandle('写文档')).toBe(0);
  });

  it('APICallPrimitive：api/http 0.95 / 同步类 0.7 / 无关 0', () => {
    const p = new APICallPrimitive();
    expect(p.canHandle('调用接口同步数据')).toBe(0.95);
    expect(p.canHandle('fetch from api')).toBe(0.95);
    expect(p.canHandle('上传文件到云端')).toBe(0.7);
    expect(p.canHandle('写代码')).toBe(0);
  });

  it('ArtifactGenerationPrimitive：生成类 0.9 / 产物 0.95 / 无关 0', () => {
    const p = new ArtifactGenerationPrimitive();
    expect(p.canHandle('生成产品文档')).toBe(0.9);
    expect(p.canHandle('create code')).toBe(0.9);
    expect(p.canHandle('查找现有产物')).toBe(0.95);
    expect(p.canHandle('查询知识')).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// KnowledgeQueryPrimitive — 参数校验 + 门禁
// ═══════════════════════════════════════════════
describe('KnowledgeQueryPrimitive — 参数校验与门禁', () => {
  const p = new KnowledgeQueryPrimitive();

  it('query 为空 → {success:false}（不触达 Gate）', async () => {
    const r = await p.execute({}, { departmentId: 'eng' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('query 参数不能为空');
  });

  it('Ontology Gate 未初始化 → reject（隔离模块验证，避免共享进程顺序依赖）', async () => {
    // resetModules + 动态 import：拿一份全新模块副本（Gate 必然未初始化），
    // 不依赖「本文件首个触达 Gate」这一顺序假设（防止未来其他文件先初始化模块级状态）。
    vi.resetModules();
    const { KnowledgeQueryPrimitive: FreshKQP } = await import(
      '../src/infrastructure/tools/primitives/KnowledgeQueryPrimitive.js',
    );
    const fp = new FreshKQP();
    await expect(
      fp.execute({ query: '产品知识' }, { departmentId: 'eng' }),
    ).rejects.toThrow(/Ontology Gate 未初始化/);
  });
});

// ═══════════════════════════════════════════════
// FileOperationPrimitive — 执行注入与参数转发
// ═══════════════════════════════════════════════
describe('FileOperationPrimitive — 执行注入', () => {
  const p = new FileOperationPrimitive();

  it('path 为空 → {success:false}', async () => {
    const r = await p.execute({ operation: 'read' }, { departmentId: 'eng' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('path 参数不能为空');
  });

  it('未注入 ConnectorRegistry → {success:false}', async () => {
    const r = await p.execute({ operation: 'read', path: '/tmp/a.txt' }, { departmentId: 'eng' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('ConnectorRegistry 未注入');
  });

  it('注入后按 fs.{operation} 转发且携带 departmentId', async () => {
    const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
    FileOperationPrimitive.setConnectorExecutor(async (action, params) => {
      calls.push({ action, params });
      return { success: true, data: { path: params.path } };
    });

    const r = await p.execute({ operation: 'write', path: 'data/x.md', content: 'hi' }, { departmentId: 'marketing', gateContext: validGate() });
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('fs.write');
    expect(calls[0].params.path).toBe('data/x.md');
    expect(calls[0].params.departmentId).toBe('marketing');
  });

  it('执行器抛错 → 捕获为 {success:false}', async () => {
    FileOperationPrimitive.setConnectorExecutor(async () => { throw new Error('disk full'); });
    const r = await p.execute({ operation: 'write', path: 'data/x.md', content: 'hi' }, { gateContext: validGate() });
    expect(r.success).toBe(false);
    expect(r.error).toContain('disk full');
  });
});

// ═══════════════════════════════════════════════
// ShellExecutionPrimitive — 白名单安全拦截
// ═══════════════════════════════════════════════
describe('ShellExecutionPrimitive — 白名单与执行', () => {
  const p = new ShellExecutionPrimitive();

  it('command 为空 → {success:false}', async () => {
    const r = await p.execute({ command: '  ' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('command 不能为空');
  });

  it('命令不在白名单 → 拦截（安全）', async () => {
    const r = await p.execute({ command: 'rm -rf /' }, { departmentId: 'eng' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('不在允许列表中');
  });

  it('白名单内命令 + 未注入执行器 → 提示未注入', async () => {
    const r = await p.execute({ command: 'ls -la' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('Shell 执行器未注入');
  });

  it('注入后转发 {command,args,timeout,deptId}', async () => {
    const got: Record<string, unknown> = {};
    ShellExecutionPrimitive.setShellExecutor(async (params) => {
      Object.assign(got, params);
      return { success: true, data: { out: 'ok' } };
    });
    const r = await p.execute({ command: 'echo hello', args: ['-n'], timeout: 5000 }, { departmentId: 'eng' });
    expect(r.success).toBe(true);
    expect(got.command).toBe('echo hello');
    expect(got.timeout).toBe(5000);
    expect(got.deptId).toBe('eng');
  });

  it('setAllowedCommands 自定义白名单后拦截生效', async () => {
    ShellExecutionPrimitive.setAllowedCommands(['echo']);
    const blocked = await p.execute({ command: 'ls' }, {});
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('不在允许列表中');

    ShellExecutionPrimitive.setShellExecutor(async () => ({ success: true }));
    const ok = await p.execute({ command: 'echo hi' }, {});
    expect(ok.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// APICallPrimitive — 执行注入
// ═══════════════════════════════════════════════
describe('APICallPrimitive — 执行注入', () => {
  const p = new APICallPrimitive();

  it('url 为空 → {success:false}', async () => {
    const r = await p.execute({ method: 'GET' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('url 不能为空');
  });

  it('非法 HTTP 方法 → {success:false}', async () => {
    const r = await p.execute({ url: 'http://x', method: 'TRACE' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('不支持的 HTTP 方法');
  });

  it('未注入执行器 → {success:false}', async () => {
    const r = await p.execute({ url: 'http://x', method: 'GET' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('HTTP 执行器未注入');
  });

  it('注入后转发 url/method/headers/body/deptId', async () => {
    const got: Record<string, unknown> = {};
    APICallPrimitive.setHttpExecutor(async (params) => {
      Object.assign(got, params);
      return { success: true, data: { status: 200 } };
    });
    const r = await p.execute(
      { url: 'https://api.example.com/v1', method: 'post', headers: { 'X-Key': 'k' }, body: { a: 1 } },
      { departmentId: 'finance', gateContext: validGate() },
    );
    expect(r.success).toBe(true);
    expect(got.method).toBe('POST'); // 大写归一
    expect(got.url).toBe('https://api.example.com/v1');
    expect(got.deptId).toBe('finance');
  });
});

// ═══════════════════════════════════════════════
// Wave 4 — 副作用原语运行时 Gate 硬拦截
// ═══════════════════════════════════════════════
describe('副作用原语 — 运行时 Gate 硬拦截（Wave 4）', () => {
  const pFile = new FileOperationPrimitive();
  const pShell = new ShellExecutionPrimitive();
  const pApi = new APICallPrimitive();

  it('FileOperation write 无 Gate 凭证 → 直接抛 GateContextRequiredError（禁止继续）', async () => {
    FileOperationPrimitive.setConnectorExecutor(async () => ({ success: true }));
    await expect(
      pFile.execute({ operation: 'write', path: 'data/x.md', content: 'hi' }, { departmentId: 'eng' }),
    ).rejects.toThrow(GateContextRequiredError);
  });

  it('FileOperation read 无凭证 → 放行（只读 WARN 计数，可观测不静默）', async () => {
    const before = PrimitiveGate.ungatedReadonlyCalls;
    const r = await pFile.execute({ operation: 'read', path: 'data/x.md' }, { departmentId: 'eng' });
    expect(r.success).toBe(true);
    expect(PrimitiveGate.ungatedReadonlyCalls).toBe(before + 1);
  });

  it('APICall POST 无凭证 → 抛错；GET 无凭证 → 放行', async () => {
    APICallPrimitive.setHttpExecutor(async () => ({ success: true }));
    await expect(
      pApi.execute({ url: 'https://x', method: 'POST' }, {}),
    ).rejects.toThrow(GateContextRequiredError);
    const r = await pApi.execute({ url: 'https://x', method: 'GET' }, {});
    expect(r.success).toBe(true);
  });

  it('Shell 非只读命令（git）无凭证 → 抛错；只读命令（echo）→ 放行', async () => {
    // 恢复完整白名单（此前用例 setAllowedCommands(['echo']) 污染了模块级状态）
    ShellExecutionPrimitive.setAllowedCommands(['ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'which', 'git', 'node', 'npm']);
    ShellExecutionPrimitive.setShellExecutor(async () => ({ success: true }));
    await expect(
      pShell.execute({ command: 'git status' }, {}),
    ).rejects.toThrow(GateContextRequiredError);
    const r = await pShell.execute({ command: 'echo hi' }, {});
    expect(r.success).toBe(true);
  });

  it('持有有效 Gate 凭证 → 破坏性操作放行', async () => {
    const r = await pFile.execute(
      { operation: 'write', path: 'data/x.md', content: 'hi' },
      { departmentId: 'eng', gateContext: validGate() },
    );
    expect(r.success).toBe(true);
  });

  it('持有无效 Gate 凭证（查询次数 0）→ 抛错', async () => {
    const badGate: KnowledgeContextPackage = { ...validGate(), queryCallCount: 0 };
    await expect(
      pFile.execute({ operation: 'read', path: 'data/x.md' }, { gateContext: badGate }),
    ).rejects.toThrow(GateContextRequiredError);
  });
});

// ═══════════════════════════════════════════════
// ArtifactGenerationPrimitive — 参数校验 + 门禁（初始化前）
// ═══════════════════════════════════════════════
describe('ArtifactGenerationPrimitive — 参数校验与门禁', () => {
  const p = new ArtifactGenerationPrimitive();

  it('非法产物类型 → {success:false}', async () => {
    const r = await p.execute({ type: 'binary', specification: 'x' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('不支持的产物类型');
  });

  it('specification 为空 → {success:false}', async () => {
    const r = await p.execute({ type: 'doc', specification: '  ' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('specification 参数不能为空');
  });

  it('Ontology Gate 未初始化 → reject（隔离模块验证，避免共享进程顺序依赖）', async () => {
    vi.resetModules();
    const { ArtifactGenerationPrimitive: FreshAGP } = await import(
      '../src/infrastructure/tools/primitives/ArtifactGenerationPrimitive.js',
    );
    const fp = new FreshAGP();
    await expect(
      fp.execute({ type: 'doc', specification: '产品说明', knowledgeContext: ['事实1'] }, { departmentId: 'eng' }),
    ).rejects.toThrow(/Ontology Gate 未初始化/);
  });
});

// ═══════════════════════════════════════════════
// ArtifactGenerationPrimitive — 成功路径（初始化后）
// ═══════════════════════════════════════════════
describe('ArtifactGenerationPrimitive — 成功路径（Gate 已初始化）', () => {
  const p = new ArtifactGenerationPrimitive();

  beforeAll(() => {
    // service 传 null：提供了 knowledgeContext 时不触达 runOntologyGroundedReasoning
    initializeOntologyGateForArtifact(new ForcedQueryGuard(), null as never);
  });

  it('无生成器且无 LLM → {success:false} + knowledgeGaps', async () => {
    // type='report' 从不注册生成器
    const r = await p.execute(
      { type: 'report', specification: '季度报告', knowledgeContext: ['事实1'] },
      { departmentId: 'eng' },
    );
    expect(r.success).toBe(false);
    expect(r.data).toBeTruthy();
    const gaps = (r.data as { knowledgeGaps?: string[] }).knowledgeGaps ?? [];
    expect(gaps.some(g => g.includes('无可用生成器'))).toBe(true);
  });

  it('注册生成器后成功产出 files[]', async () => {
    ArtifactGenerationPrimitive.registerGenerator({
      type: 'doc',
      generate: async (spec, _knowledge, deptId) => [
        { path: `docs/${spec}.md`, content: `内容(${deptId})`, type: 'doc' },
      ],
    });

    const r = await p.execute(
      { type: 'doc', specification: '产品说明', knowledgeContext: ['事实1', '事实2'] },
      { departmentId: 'marketing' },
    );
    expect(r.success).toBe(true);
    const data = r.data as { files: Array<{ path: string; content: string }> };
    expect(data.files).toHaveLength(1);
    expect(data.files[0].path).toBe('docs/产品说明.md');
    expect(data.files[0].content).toContain('marketing');
  });

  it('副作用前校验阻断：verificationHook ok=false → 不产出', async () => {
    ArtifactGenerationPrimitive.setVerificationHook(async () => ({ ok: false, errors: ['引用无效'] }));
    const r = await p.execute(
      { type: 'doc', specification: '产品说明', knowledgeContext: ['事实1'] },
      { departmentId: 'eng' },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('已阻断写入');
    const gaps = (r.data as { knowledgeGaps?: string[] }).knowledgeGaps ?? [];
    expect(gaps).toContain('引用无效');
  });

  it('副作用前校验通过 + fileWriter 注入 → 写入文件并返回 warnings 为空', async () => {
    ArtifactGenerationPrimitive.setVerificationHook(async () => ({ ok: true }));
    const writes: Array<{ path: string; content: string; deptId: string }> = [];
    ArtifactGenerationPrimitive.setFileWriter(async (path, content, deptId) => {
      writes.push({ path, content, deptId });
      return { success: true };
    });

    const r = await p.execute(
      { type: 'doc', specification: '产品说明', knowledgeContext: ['事实1'] },
      { departmentId: 'eng' },
    );
    expect(r.success).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('docs/产品说明.md');
    expect(writes[0].deptId).toBe('eng');
  });

  it('fileWriter 失败 → 返回 success 但 warnings 记录写入失败', async () => {
    ArtifactGenerationPrimitive.setFileWriter(async () => ({ success: false, error: '磁盘只读' }));
    const r = await p.execute(
      { type: 'doc', specification: '产品说明', knowledgeContext: ['事实1'] },
      { departmentId: 'eng' },
    );
    expect(r.success).toBe(true);
    const data = r.data as { warnings?: string[] };
    expect(data.warnings?.some(w => w.includes('磁盘只读'))).toBe(true);
  });
});

describe('DomainPrimitiveRegistry 可逆效果（vNext · 参考 deepseek-harness reversible-effects）', () => {
  /** 一个可识别的最小原语（name 唯一，便于断言） */
  function makePrimitive(name: string) {
    return {
      name,
      description: `test primitive ${name}`,
      inputSchema: {},
      canHandle: () => 0,
      execute: async () => ({ success: true, data: { name } }),
    };
  }

  beforeEach(() => {
    DomainPrimitiveRegistry.clear();
  });
  afterEach(() => {
    DomainPrimitiveRegistry.clear();
  });

  it('register 返回 disposer：调用即撤销该注册（幂等）', () => {
    const p = makePrimitive('rev.test.idempotent');
    const dispose = DomainPrimitiveRegistry.register(p);
    expect(DomainPrimitiveRegistry.isRegistered('rev.test.idempotent')).toBe(true);

    expect(dispose()).toBe(true);
    expect(DomainPrimitiveRegistry.isRegistered('rev.test.idempotent')).toBe(false);
    // 幂等：重复调用安全返回（不抛错）
    expect(dispose()).toBe(true);
  });

  it('registerMultiple 返回批量 disposer：正序回卷全部注册', () => {
    const ps = [makePrimitive('rev.multi.a'), makePrimitive('rev.multi.b'), makePrimitive('rev.multi.c')];
    const dispose = DomainPrimitiveRegistry.registerMultiple(ps);
    expect(DomainPrimitiveRegistry.listNames()).toEqual(expect.arrayContaining(['rev.multi.a', 'rev.multi.b', 'rev.multi.c']));

    expect(dispose()).toBe(true);
    expect(DomainPrimitiveRegistry.isRegistered('rev.multi.a')).toBe(false);
    expect(DomainPrimitiveRegistry.isRegistered('rev.multi.b')).toBe(false);
    expect(DomainPrimitiveRegistry.isRegistered('rev.multi.c')).toBe(false);
  });

  it('effect：多个注册收集为整体效果，dispose 按 LIFO 回卷', () => {
    const a = makePrimitive('rev.effect.a');
    const b = makePrimitive('rev.effect.b');
    // 注册顺序 a → b
    const aDisposer = DomainPrimitiveRegistry.register(a);
    const bDisposer = DomainPrimitiveRegistry.register(b);
    const dispose = DomainPrimitiveRegistry.effect(aDisposer, bDisposer);
    expect(DomainPrimitiveRegistry.isRegistered('rev.effect.a')).toBe(true);
    expect(DomainPrimitiveRegistry.isRegistered('rev.effect.b')).toBe(true);

    // LIFO：先回卷 b，再回卷 a（此处无法直接观察回卷顺序，验证最终全部回卷即可）
    const all = dispose();
    expect(all).toBe(true);
    expect(DomainPrimitiveRegistry.isRegistered('rev.effect.a')).toBe(false);
    expect(DomainPrimitiveRegistry.isRegistered('rev.effect.b')).toBe(false);
  });

  it('effect 为空参数：安全返回 true（无副作用）', () => {
    const dispose = DomainPrimitiveRegistry.effect();
    expect(dispose()).toBe(true);
  });
});
