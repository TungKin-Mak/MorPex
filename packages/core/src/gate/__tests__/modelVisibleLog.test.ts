/**
 * gate/__tests__/modelVisibleLog.test.ts — Model-Visible 宣言运行时不变量测试
 *
 * 覆盖：
 *   1. assertModelVisibleLogged：resolver 可取回 → 通过；取不回 → 抛 ModelVisibleNotLoggedError
 *   2. reconstructContext：从持久化点重建模型可见文本（一致）
 *   3. contextPersistenceResolver：快照存在→命中；不存在/异常→不可重建
 *   4. deblackboxResolver：决策单存在→命中；executionId 不匹配→不可重建
 *   5. composeResolvers：按序尝试，首个命中的为准
 *   6. contentKey 编解码往返：context-snapshot / deblackbox
 *
 * 全部使用内存/临时 stub，不触碰 SQLite 或仓库 data/ 目录。
 */

import { describe, it, expect } from 'vitest';
import {
  assertModelVisibleLogged,
  reconstructContext,
  composeResolvers,
  contextPersistenceResolver,
  deblackboxResolver,
  createContextPackageEntry,
  createDeblackboxEntry,
  encodeContextSnapshotKey,
  parseContextSnapshotKey,
  encodeDeblackboxKey,
  parseDeblackboxKey,
  ModelVisibleNotLoggedError,
  type ModelVisibleEntry,
  type ModelVisibleResolver,
} from '../modelVisibleLog.js';

// ── 最小持久化 stub（duck-type，仅实现 resolver 用到的签名）──

/** ContextPersistence 最小桩（loadVersion 返回可重建的 ExecutionContext） */
function makePersistenceStub(snapshots: Record<string, { focusedSummary?: string }>) {
  return {
    loadVersion(contextId: string, version: number) {
      const ctx = snapshots[`${contextId}:${version}`];
      if (!ctx) return undefined;
      return { contextId, version, focusedSummary: ctx.focusedSummary };
    },
  } as unknown as Parameters<typeof contextPersistenceResolver>[0];
}

/** DeblackboxRecorder 最小桩（getRecent 返回内存记录） */
function makeRecorderStub(records: Array<{ category: string; executionId?: string; summary?: Record<string, unknown> }>) {
  return {
    getRecent(category: string, limit = 100) {
      return records
        .filter((r) => r.category === category)
        .slice(0, limit)
        .map((r) => ({ executionId: r.executionId ?? 'kernel', summary: r.summary ?? {} }));
    },
  } as unknown as Parameters<typeof deblackboxResolver>[0];
}

describe('ModelVisibleNotLoggedError', () => {
  it('携带 kind + contentKey 信息以定位失败条目', () => {
    const err = new ModelVisibleNotLoggedError('context-package', 'context-snapshot:ctx:1');
    expect(err.name).toBe('ModelVisibleNotLoggedError');
    expect(err.message).toContain('Model-Visible 宣言');
    expect(err.message).toContain('context-snapshot:ctx:1');
  });
});

describe('assertModelVisibleLogged', () => {
  it('resolver 可取回内容 → 通过（不抛）', () => {
    const entry: ModelVisibleEntry = {
      id: 'mvl_t1',
      contentKey: 'context-snapshot:ctx-a:2',
      kind: 'context-package',
      loggedAt: Date.now(),
      replayedFrom: 'context-snapshots',
    };
    const resolver: ModelVisibleResolver = () => ({ found: true, content: '【当前任务】测试', store: 'context-snapshots' });
    expect(() => assertModelVisibleLogged(entry, resolver)).not.toThrow();
  });

  it('resolver 取不回内容 → 抛 ModelVisibleNotLoggedError（宪法级硬约束）', () => {
    const entry: ModelVisibleEntry = {
      id: 'mvl_t2',
      contentKey: 'context-snapshot:ctx-b:9',
      kind: 'context-package',
      loggedAt: Date.now(),
      replayedFrom: 'context-snapshots',
    };
    const resolver: ModelVisibleResolver = () => ({ found: false });
    expect(() => assertModelVisibleLogged(entry, resolver)).toThrow(ModelVisibleNotLoggedError);
  });

  it('resolver 命中但内容为空 → 视为不可重建并抛错', () => {
    const entry: ModelVisibleEntry = {
      id: 'mvl_t3',
      contentKey: 'deblackbox:context.retrieval:kernel',
      kind: 'context-package',
      loggedAt: Date.now(),
      replayedFrom: 'deblackbox-recorder',
    };
    const resolver: ModelVisibleResolver = () => ({ found: true, content: '', store: 'deblackbox-recorder' });
    expect(() => assertModelVisibleLogged(entry, resolver)).toThrow(ModelVisibleNotLoggedError);
  });
});

describe('reconstructContext', () => {
  it('从持久化点重建模型可见文本（一致）', () => {
    const entry = createContextPackageEntry({ contextId: 'ctx-c', version: 1, executionId: 'miss-1' });
    const resolver = contextPersistenceResolver(
      makePersistenceStub({ 'ctx-c:1': { focusedSummary: '【当前任务】设计产品' } }),
    );
    expect(reconstructContext(entry, resolver)).toBe('【当前任务】设计产品');
  });

  it('取不回 → 抛 ModelVisibleNotLoggedError（不做静默空串兜底）', () => {
    const entry = createContextPackageEntry({ contextId: 'ctx-d', version: 1, executionId: 'miss-2' });
    const resolver = contextPersistenceResolver(makePersistenceStub({}));
    expect(() => reconstructContext(entry, resolver)).toThrow(ModelVisibleNotLoggedError);
  });
});

describe('contextPersistenceResolver', () => {
  it('快照存在 → 命中并返回 focusedSummary', () => {
    const resolver = contextPersistenceResolver(
      makePersistenceStub({ 'ctx-e:3': { focusedSummary: '装配摘要' } }),
    );
    const entry = { ...createContextPackageEntry({ contextId: 'ctx-e', version: 3, executionId: 'x' }), contentKey: 'context-snapshot:ctx-e:3' };
    const res = resolver(entry);
    expect(res).toMatchObject({ found: true, content: '装配摘要', store: 'context-snapshots' });
  });

  it('快照不存在 → 不可重建（found=false）', () => {
    const resolver = contextPersistenceResolver(makePersistenceStub({}));
    const entry = { ...createContextPackageEntry({ contextId: 'ctx-f', version: 5, executionId: 'x' }), contentKey: 'context-snapshot:ctx-f:5' };
    expect(resolver(entry)).toMatchObject({ found: false });
  });

  it('非 context-snapshot 键 → 不认（found=false），交由组合 resolver 降级', () => {
    const resolver = contextPersistenceResolver(makePersistenceStub({ 'ctx-g:1': { focusedSummary: 'x' } }));
    const entry = createDeblackboxEntry({ category: 'context.retrieval', executionId: 'kernel' });
    expect(resolver(entry)).toMatchObject({ found: false });
  });
});

describe('deblackboxResolver', () => {
  it('决策单存在且 executionId 匹配 → 命中', () => {
    const recorder = makeRecorderStub([
      { category: 'context.retrieval', executionId: 'miss-a', summary: { goal: 'g1', decision: '装配完成' } },
    ]);
    const resolver = deblackboxResolver(recorder);
    const entry = createDeblackboxEntry({ category: 'context.retrieval', executionId: 'miss-a' });
    const res = resolver(entry);
    expect(res.found).toBe(true);
    expect(res.store).toBe('deblackbox-recorder');
    expect(res.content).toContain('装配完成');
  });

  it('executionId 不匹配 → 不可重建（隔离性：不串任务）', () => {
    const recorder = makeRecorderStub([
      { category: 'context.retrieval', executionId: 'miss-B', summary: { goal: 'other' } },
    ]);
    const resolver = deblackboxResolver(recorder);
    const entry = createDeblackboxEntry({ category: 'context.retrieval', executionId: 'miss-OTHER' });
    expect(resolver(entry)).toMatchObject({ found: false });
  });

  it('非 deblackbox 键 → 不认（found=false）', () => {
    const recorder = makeRecorderStub([{ category: 'context.retrieval', executionId: 'kernel', summary: { a: 1 } }]);
    const resolver = deblackboxResolver(recorder);
    const entry = { ...createContextPackageEntry({ contextId: 'h', version: 1, executionId: 'kernel' }), contentKey: 'context-snapshot:h:1' };
    expect(resolver(entry)).toMatchObject({ found: false });
  });
});

describe('composeResolvers', () => {
  it('按序尝试，首个命中的为准（持久优先 → 降级 deblackbox）', () => {
    const snapshot = contextPersistenceResolver(makePersistenceStub({})); // 不可重建
    const deblackbox = deblackboxResolver(
      makeRecorderStub([{ category: 'context.retrieval', executionId: 'kernel', summary: { fallback: true } }]),
    );
    const combined = composeResolvers(snapshot, deblackbox);
    // contentKey 用 deblackbox 键时，快照 resolver 不认、降级 resolver 命中
    const entry = createDeblackboxEntry({ category: 'context.retrieval', executionId: 'kernel' });
    const res = combined(entry);
    expect(res.found).toBe(true);
    expect(res.store).toBe('deblackbox-recorder');
  });

  it('全部未命中 → found=false（此处由 assert 抛错）', () => {
    const combined = composeResolvers(
      contextPersistenceResolver(makePersistenceStub({})),
      deblackboxResolver(makeRecorderStub([])),
    );
    const entry = createContextPackageEntry({ contextId: 'i', version: 1, executionId: 'kernel' });
    expect(combined(entry)).toMatchObject({ found: false });
    expect(() => assertModelVisibleLogged(entry, combined)).toThrow(ModelVisibleNotLoggedError);
  });
});

describe('contentKey 编解码', () => {
  it('context-snapshot 键往返一致', () => {
    const key = encodeContextSnapshotKey('ctx-j', 42);
    expect(parseContextSnapshotKey(key)).toEqual({ contextId: 'ctx-j', version: 42 });
  });

  it('deblackbox 键往返一致', () => {
    const key = encodeDeblackboxKey('context.retrieval', 'mission_abc');
    expect(parseDeblackboxKey(key)).toEqual({ category: 'context.retrieval', executionId: 'mission_abc' });
  });

  it('不匹配前缀 → 解析为 null（组合降级的关键）', () => {
    expect(parseContextSnapshotKey('deblackbox:context.retrieval:kernel')).toBeNull();
    expect(parseDeblackboxKey('context-snapshot:ctx:1')).toBeNull();
  });
});