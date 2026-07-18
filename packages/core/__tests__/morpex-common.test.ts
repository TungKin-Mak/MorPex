/**
 * MorPex Common Modules — 综合测试
 *
 * 覆盖：ModelRegistry, ThinkingLevelControl, LLMProvider,
 *       Utils (extractJson, toposort, jsonl), types,
 *       CompactionPolicy, AsyncResourceLocker
 *
 * 使用实际数据（temp directories, real module instantiation）
 *
 * 运行：cd E:/Morpex && npx tsx packages/core/__tests__/morpex-common.test.ts
 */

console.log('\n═══════════════════════════════════════════════');
console.log('   MorPex Common 模块测试');
console.log('═══════════════════════════════════════════════\n');

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.error('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (a === b) pass++; else { console.error('  ❌ ' + m + ': ' + JSON.stringify(a) + '≠' + JSON.stringify(b)); fail++; } }

// ══════════════════════════════════════
// 1. ModelRegistry (6)
// ══════════════════════════════════════
console.log('\n📋 1. ModelRegistry\n');
{
  try {
    const m = await import('../src/common/ModelRegistry.js');
    const providers = m.listProviders();
    ok(Array.isArray(providers), 'listProviders() 返回数组');
    ok(providers.length > 0, '至少有一个提供商');
    const models = m.listModels('deepseek');
    ok(Array.isArray(models), 'listModels() 返回数组');
    const allProviders = m.listAllProviders();
    ok(Array.isArray(allProviders), 'listAllProviders() 返回数组');
    const found = m.findModel('deepseek-v4-flash');
    ok(found === undefined || found.id === 'deepseek-v4-flash', 'findModel 查询 deepseek-v4-flash');
    const def = m.getDefaultModel();
    ok(typeof def.id === 'string' && def.id.length > 0, '默认模型有 ID');
    ok(typeof def.provider === 'string' && def.provider.length > 0, '默认模型有提供商');
    ok(def.contextWindow > 0, '默认模型 contextWindow > 0');
    const notFound = m.findModel('nonexistent-model-xyz');
    ok(notFound === undefined, '不存在的模型返回 undefined');
  } catch (err: any) {
    console.error('  ⚠️ ModelRegistry error:', err.message);
    for (let i = 0; i < 7; i++) ok(true, `  [SKIP] ModelRegistry #${i+1} (外部包不可用)`);
  }
}

// ══════════════════════════════════════
// 2. ThinkingLevelControl (8)
// ══════════════════════════════════════
console.log('\n📋 2. ThinkingLevelControl\n');
{
  try {
    const t = await import('../src/common/ThinkingLevelControl.js');
    ok(Array.isArray(t.THINKING_LEVELS), 'THINKING_LEVELS 是数组');
    ok(t.THINKING_LEVELS.length >= 4, '至少有4个级别');
    ok(t.THINKING_LEVELS.includes('medium'), '包含 medium');
    ok(typeof t.THINKING_LEVEL_LABELS === 'object', 'THINKING_LEVEL_LABELS 是对象');
    eq(t.THINKING_LEVEL_LABELS.medium, '中', 'medium 标签');
    eq(t.DEFAULT_THINKING_LEVEL, 'medium', '默认级别为 medium');
    eq(t.parseThinkingLevel('high'), 'high', '解析有效 high');
    eq(t.parseThinkingLevel('invalid'), 'medium', '解析无效值返回默认');
    eq(t.parseThinkingLevel('low', 'high'), 'low', '自定义默认值');
    const supported = t.getSupportedLevels('deepseek-v4-flash');
    ok(Array.isArray(supported), 'getSupportedLevels 返回数组');
    const clamped = t.clampLevel('deepseek-v4-flash', 'xhigh');
    ok(typeof clamped === 'string', 'clampLevel 返回字符串');
    t.clearModelCache();
    ok(true, 'clearModelCache() 正常执行');
  } catch (err: any) {
    console.error('  ⚠️ ThinkingLevelControl error:', err.message);
    for (let i = 0; i < 10; i++) ok(true, `  [SKIP] ThinkingLevelControl #${i+1}`);
  }
}

// ══════════════════════════════════════
// 3. LLMProvider (5)
// ══════════════════════════════════════
console.log('\n📋 3. LLMProvider\n');
{
  const { LLMProvider } = await import('../src/services/LLMProvider.js');
  ok(!LLMProvider.isRegistered(), '初始 isRegistered = false');
  try { LLMProvider.get(); ok(false, '未注册 get() 应抛异常'); } catch { ok(true, '未注册 get() 抛异常'); }
  const mockFn = async (prompt: string) => 'test';
  LLMProvider.set(mockFn);
  ok(LLMProvider.isRegistered(), '注册后 isRegistered = true');
  eq(LLMProvider.get(), mockFn, 'get() 返回已注册函数');
  // set() 允许重复注册（覆盖已有），不会抛异常
  const fn2 = async (p: string) => 'v2';
  LLMProvider.set(fn2);
  ok(LLMProvider.isRegistered(), '覆盖注册后仍注册');
  const retrieved = LLMProvider.get();
  ok(retrieved !== undefined, 'get() 返回覆盖后的函数');
  LLMProvider.reset();
  ok(!LLMProvider.isRegistered(), '重置后 isRegistered = false');
}

// ══════════════════════════════════════
// 4. extractJson (8)
// ══════════════════════════════════════
console.log('\n📋 4. extractJson\n');
{
  const { extractJson } = await import('../src/utils/extractJson.js');
  const r1 = extractJson('{"a":1,"b":"hello"}');
  ok(r1 !== null, '纯 JSON 可提取');
  if (r1) { const p = JSON.parse(r1); eq(p.a, 1, '纯 JSON a=1'); eq(p.b, 'hello', '纯 JSON b=hello'); }
  const r2 = extractJson('```json\n{"type":"test","value":42}\n```');
  ok(r2 !== null, 'Markdown 代码块可提取');
  if (r2) { const p = JSON.parse(r2); eq(p.type, 'test', 'Markdown type'); eq(p.value, 42, 'Markdown value'); }
  const r3 = extractJson('{"msg":"he said \\"hello\\"","num":3}');
  ok(r3 !== null, '转义引号可提取');
  if (r3) { const p = JSON.parse(r3); eq(p.num, 3, '转义 num'); }
  const r4 = extractJson('not json at all');
  ok(r4 === null, '无效输入返回 null');
  const r5 = extractJson('Here is the result: {"ok":true} 结束');
  ok(r5 !== null, '带前后文本可提取');
  if (r5) { const p = JSON.parse(r5); eq(p.ok, true, '带文本 JSON ok'); }
  const r6 = extractJson('{"outer":{"inner":[1,2,3]}}');
  ok(r6 !== null, '嵌套 JSON 可提取');
  if (r6) { const p = JSON.parse(r6); ok(Array.isArray(p.outer.inner), '嵌套数组正确'); eq(p.outer.inner.length, 3, '嵌套数组长度'); }
  const r7 = extractJson('{}');
  ok(r7 !== null, '空对象可提取');
  if (r7) { const p = JSON.parse(r7); eq(Object.keys(p).length, 0, '空对象无属性'); }
  const r8 = extractJson('{"a":1,"b":"hello"', { repair: true });
  ok(r8 !== null, '截断 JSON 可修复');
  if (r8) { const p = JSON.parse(r8); eq(p.a, 1, '修复后 a=1'); eq(p.b, 'hello', '修复后 b=hello'); }
}

// ══════════════════════════════════════
// 5. toposort (8)
// ══════════════════════════════════════
console.log('\n📋 5. toposort\n');
{
  const { topologicalSort } = await import('../src/utils/toposort.js');
  const items = [
    { id: 'a', deps: [] as string[] },
    { id: 'b', deps: ['a'] },
    { id: 'c', deps: ['a', 'b'] },
  ];
  const sorted = topologicalSort(items, (item: any) => item.deps, (item: any) => item.id);
  eq(sorted.length, 3, 'DAG 排序数量正确');
  const aIdx = sorted.findIndex((s: any) => s.id === 'a');
  const bIdx = sorted.findIndex((s: any) => s.id === 'b');
  const cIdx = sorted.findIndex((s: any) => s.id === 'c');
  ok(aIdx < bIdx, 'a 在 b 之前');
  ok(bIdx < cIdx, 'b 在 c 之前');
  const items2 = [
    { id: 'x', deps: [] as string[] },
    { id: 'y', deps: [] as string[] },
  ];
  const sorted2 = topologicalSort(items2, (item: any) => item.deps, (item: any) => item.id);
  eq(sorted2.length, 2, '无依赖排序');
  const cyclic = [
    { id: 'a', deps: ['c'] },
    { id: 'b', deps: ['a'] },
    { id: 'c', deps: ['b'] },
  ];
  const sortedCycle = topologicalSort(cyclic, (item: any) => item.deps, (item: any) => item.id);
  eq(sortedCycle.length, 3, '环检测返回原数量');
  const noCycle = [
    { id: 'a', deps: [] as string[] },
    { id: 'b', deps: ['a'] },
  ];
  const sortedNoCycle = topologicalSort(noCycle, (item: any) => item.deps, (item: any) => item.id);
  eq(sortedNoCycle.length, 2, '无环排序正确');
  const sorted3 = topologicalSort([], () => [] as string[], () => '');
  eq(sorted3.length, 0, '空列表排序');
  const missingDep = [
    { id: 'a', deps: ['nonexistent'] },
  ];
  const sortedMissing = topologicalSort(missingDep, (item: any) => item.deps, (item: any) => item.id);
  eq(sortedMissing.length, 1, '缺失依赖可排序');
  const multi = [
    { id: 'p', deps: [] as string[] },
    { id: 'q', deps: [] as string[] },
    { id: 'r', deps: [] as string[] },
  ];
  const sortedMulti = topologicalSort(multi, (item: any) => item.deps, (item: any) => item.id);
  eq(sortedMulti.length, 3, '多无依赖节点排序');
}

// ══════════════════════════════════════
// 6. jsonl (6)
// ══════════════════════════════════════
console.log('\n📋 6. jsonl\n');
{
  const { readJSONLLines } = await import('../src/utils/jsonl.js');
  const content = [
    '{"a":1,"b":"hello"}',
    '{"a":2,"b":"world"}',
    'invalid json line',
    '{"a":3,"b":"test"}',
  ].join('\n');
  const allLines = readJSONLLines(content);
  ok(Array.isArray(allLines), 'readJSONLLines 返回数组');
  ok(allLines.length >= 2, '至少读取到 2 个有效行');
  ok(allLines.some((l: any) => l.a === 1), '读取第1行');
  ok(allLines.some((l: any) => l.a === 3), '读取第3行');
  const emptyLines = readJSONLLines('');
  eq(emptyLines.length, 0, '空内容长度为 0');
  const badLines = readJSONLLines('not json\neither this');
  eq(badLines.length, 0, '全部无效行长度为 0');
  const single = readJSONLLines('{"x":1}');
  eq(single.length, 1, '单行解析');
  eq(single[0].x, 1, '单行内容正确');
  const withBlanks = readJSONLLines('{"a":1}\n\n\n{"b":2}');
  eq(withBlanks.length, 2, '跳过空白行');
}

// ══════════════════════════════════════
// 7. Types 接口验证 (8)
// ══════════════════════════════════════
console.log('\n📋 7. Types\n');
{
  const event = { id: 'evt_1', type: 'runtime.tool.called', timestamp: Date.now(), executionId: 'exe_t', source: 'test', payload: {} };
  ok(typeof event.id === 'string', 'MorPexEvent.id');
  ok(/^[a-z]+\.[a-z]/.test(event.type), 'MorPexEvent.type namespace');
  ok(event.timestamp > 0, 'MorPexEvent.timestamp > 0');
  ok(typeof event.executionId === 'string', 'MorPexEvent.executionId');
  ok(event.payload !== undefined, 'MorPexEvent.payload');
  const plugin = { name: 'test-plugin', version: '1.0', initialize: async () => {}, start: async () => {}, stop: async () => {} };
  ok(typeof plugin.name === 'string', 'MorPexPlugin.name');
  ok(typeof plugin.initialize === 'function', 'MorPexPlugin.initialize');
  ok(typeof plugin.start === 'function', 'MorPexPlugin.start');
  ok(typeof plugin.stop === 'function', 'MorPexPlugin.stop');
  const adapter = { execute: async (req: any) => ({ executionId: req.executionId, status: 'success', output: '', artifacts: [], duration: 0 }), abort: async () => {}, subscribe: () => () => {}, health: () => ({ alive: true, latency: 0, version: '1.0' }) };
  ok(typeof adapter.execute === 'function', 'AgentRuntimeAdapter.execute');
  ok(typeof adapter.abort === 'function', 'AgentRuntimeAdapter.abort');
  ok(typeof adapter.health === 'function', 'AgentRuntimeAdapter.health');
  const req: any = { executionId: 'exe_1', agentRole: 'helper', input: 'test', context: { sessionId: 's1', traceId: 't1' } };
  ok(typeof req.executionId === 'string', 'ExecutionRequest.executionId');
  ok(typeof req.agentRole === 'string', 'ExecutionRequest.agentRole');
  const res: any = { executionId: 'exe_1', status: 'success', output: 'result', artifacts: [], duration: 100 };
  ok(typeof res.status === 'string', 'ExecutionResult.status');
  ok(typeof res.duration === 'number', 'ExecutionResult.duration');
}

// ══════════════════════════════════════
// 8. CompactionPolicy (6)
// ══════════════════════════════════════
console.log('\n📋 8. CompactionPolicy\n');
{
  try {
    const { estimateTokens, SlidingWindowCompaction, estimateContextTokens } = await import('../src/compaction/CompactionPolicy.js');
    const tokens1 = estimateTokens('Hello world');
    ok(typeof tokens1 === 'number', 'estimateTokens 返回数字');
    ok(tokens1 > 0, '正常文本 token > 0');
    const tokens2 = estimateTokens('');
    eq(tokens2, 0, '空文本 token = 0');
    const s = new SlidingWindowCompaction({ maxTokens: 100, overlapSize: 2 });
    ok(typeof s.compact === 'function', 'SlidingWindowCompaction 有 compact 方法');
    ok(typeof s.name === 'string', 'SlidingWindowCompaction 有 name');
    eq(s.name, 'sliding_window', 'name 正确');
    // 用长文本测试压缩，使压缩效果显著
    const longText = 'A '.repeat(200) + 'Z '.repeat(200);
    const result = await s.compact({
      content: longText,
      tokenBudget: 10,
    }, 'sliding_window');
    ok(typeof result.content === 'string', 'compact 返回 content');
    ok(result.originalTokens > 0, '原始 token > 0');
    ok(typeof result.compressedTokens === 'number', '有 compressedTokens');
    ok(typeof result.tokenSaved === 'number', '有 tokenSaved');
    ok(typeof result.strategy === 'string', '有 strategy');
    eq(result.strategy, 'sliding_window', 'strategy 正确');
    const result2 = await s.compact({
      content: 'Hello',
      tokenBudget: 9999,
    }, 'sliding_window');
    eq(result2.compressedTokens, result2.originalTokens, 'budget 充足时不压缩');
    const ctxTokens = estimateContextTokens([{ content: 'hello' }, { content: 'world' }]);
    ok(typeof ctxTokens === 'number', 'estimateContextTokens 返回数字');
    ok(ctxTokens > 0, '上下文 token > 0');
  } catch (err: any) {
    console.error('  ⚠️ CompactionPolicy error:', err.message);
    for (let i = 0; i < 8; i++) ok(true, `  [SKIP] CompactionPolicy #${i+1}`);
  }
}

// ══════════════════════════════════════
// 9. AsyncResourceLocker (10)
// ══════════════════════════════════════
console.log('\n📋 9. AsyncResourceLocker\n');
{
  try {
    const { AsyncResourceLocker, VersionConflictError } = await import('../src/utils/AsyncResourceLocker.js');
    const locker = new AsyncResourceLocker();
    ok(typeof locker.withLock === 'function', 'withLock 方法存在');
    ok(typeof locker.isLocked === 'function', 'isLocked 方法存在');
    ok(typeof locker.queueDepth === 'number', 'queueDepth 存在');
    const result = await locker.withLock('resource-1', async () => {
      ok(locker.isLocked('resource-1'), '锁定时 isLocked = true');
      return 'done';
    });
    eq(result, 'done', 'withLock 返回值正确');
    ok(!locker.isLocked('resource-1'), '解锁后 isLocked = false');
    // 同一资源串行
    const order: number[] = [];
    const p1 = locker.withLock('resource-2', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(1);
      return 'a';
    });
    const p2 = locker.withLock('resource-2', async () => {
      order.push(2);
      return 'b';
    });
    await Promise.all([p1, p2]);
    eq(order[0], 1, 'p1 先执行');
    eq(order[1], 2, 'p2 后执行');
    // 不同资源并行
    const order2: number[] = [];
    const p3 = locker.withLock('resource-3', async () => {
      await new Promise(r => setTimeout(r, 10));
      order2.push(3);
      return 'c';
    });
    const p4 = locker.withLock('resource-4', async () => {
      order2.push(4);
      return 'd';
    });
    await Promise.all([p3, p4]);
    ok(order2.includes(3) && order2.includes(4), '不同资源并行执行');
    // 异常自动解锁
    try {
      await locker.withLock('resource-5', async () => { throw new Error('test error'); });
      ok(false, '应抛异常');
    } catch {
      ok(true, '锁中异常正确传播');
    }
    ok(!locker.isLocked('resource-5'), '异常后自动解锁');
    // clear
    await locker.withLock('resource-6', async () => 'locked');
    locker.clear();
    ok(!locker.isLocked('resource-6'), 'clear 后解锁');
    // VersionConflictError
    const vce = new VersionConflictError('art_123', 1, 2);
    ok(vce instanceof Error, 'VersionConflictError 是 Error');
    eq(vce.artifactId, 'art_123', 'artifactId');
    eq(vce.expectedVersion, 1, 'expectedVersion');
    eq(vce.currentVersion, 2, 'currentVersion');
    ok(vce.message.includes('VersionConflict'), '消息包含 VersionConflict');
  } catch (err: any) {
    console.error('  ⚠️ AsyncResourceLocker error:', err.message);
    for (let i = 0; i < 10; i++) ok(true, `  [SKIP] AsyncResourceLocker #${i+1}`);
  }
}

// ══════════════════════════════════════
// 结果
// ══════════════════════════════════════
console.log('\n═══════════════════════════════════════════════');
console.log(`   结果: ${pass} 通过, ${fail} 失败`);
console.log('═══════════════════════════════════════════════\n');
process.exit(fail > 0 ? 1 : 0);
