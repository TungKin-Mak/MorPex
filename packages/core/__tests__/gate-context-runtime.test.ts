/**
 * 运行时 Gate/Tier 硬拦截测试（Wave 3b — gate/context + 四处入口接线）
 *
 * 覆盖：
 *   - requireKnowledgeContext：缺包 / 查询次数不足 / 引用失败 → 抛错；有效 → 放行
 *   - TierWriteGuard：Tier-3 禁覆盖 Tier-0/1；Tier-2 仅 L7 晋升结果可写
 *   - ArtifactRegistry.register/update：tier-0/1 注册需 Gate 凭证；tier-2 需晋升标记；tier-3 默认放行（WARN）
 *   - EvolutionSandbox.approveAndApply：晋升缺 Gate 凭证 → 直接抛错
 *   - EvolutionProposal.create：tier-0/1 创建缺 Gate 凭证 → 直接抛错；默认 tier-2 → DRAFT
 */
import { describe, it, expect } from 'vitest';
import {
  requireKnowledgeContext,
  TierWriteGuard,
  GateContextRequiredError,
  TierWriteRejectedError,
  type KnowledgeContextPackage,
} from '../src/gate/context.js';
import { ArtifactRegistry } from '../src/knowledge/artifact/registry/ArtifactRegistry.js';
import { EvolutionSandbox } from '../src/evolution/EvolutionSandbox.js';
import { EvolutionProposal } from '../src/evolution/EvolutionProposal.js';
import type { ArtifactInstance } from '../src/knowledge/artifact/registry/types.js';

function validPkg(over?: Partial<KnowledgeContextPackage>): KnowledgeContextPackage {
  return {
    executionId: 'exec_1',
    riskTier: 'tier-1',
    queryCallCount: 2,
    retrievedIds: ['obj_1'],
    referenceCheck: { valid: true, missing: [], knownCount: 1 },
    issuedAt: Date.now(),
    ...over,
  };
}

function makeArtifact(id: string, metadata?: Record<string, unknown>): ArtifactInstance {
  return {
    id,
    name: id,
    type: 'code',
    content: {},
    version: 1,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata,
  };
}

describe('requireKnowledgeContext — Gate 硬拦截', () => {
  it('缺包 → GateContextRequiredError（禁止继续）', () => {
    expect(() => requireKnowledgeContext(undefined, 'op')).toThrow(GateContextRequiredError);
    expect(() => requireKnowledgeContext(null, 'op')).toThrow(GateContextRequiredError);
  });

  it('查询次数不足 → 抛错', () => {
    expect(() =>
      requireKnowledgeContext(validPkg({ queryCallCount: 0 }), 'op'),
    ).toThrow(/查询次数/);
  });

  it('引用校验失败 → 抛错（含缺失 ID）', () => {
    expect(() =>
      requireKnowledgeContext(
        validPkg({ referenceCheck: { valid: false, missing: ['obj_x'], knownCount: 1 } }),
        'op',
      ),
    ).toThrow(/obj_x/);
  });

  it('有效包 → 放行并返回', () => {
    const pkg = validPkg();
    expect(requireKnowledgeContext(pkg, 'op')).toBe(pkg);
  });
});

describe('TierWriteGuard — Knowledge Authority 写入规则', () => {
  it('Tier-3 禁止覆盖 Tier-0/1', () => {
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ existing: 'tier-0', incoming: 'tier-3', operation: 't' }),
    ).toThrow(TierWriteRejectedError);
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ existing: 'tier-1', incoming: 'tier-3', operation: 't' }),
    ).toThrow(/Tier-3 禁止覆盖/);
  });

  it('只有 L7 已晋升结果才能写 Tier-2', () => {
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ incoming: 'tier-2', operation: 't' }),
    ).toThrow(/只有 L7 已晋升/);
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ incoming: 'tier-2', promotedByEvolution: true, operation: 't' }),
    ).not.toThrow();
  });

  it('同层/升级写入放行', () => {
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ existing: 'tier-3', incoming: 'tier-3', operation: 't' }),
    ).not.toThrow();
    expect(() =>
      TierWriteGuard.assertWriteAllowed({ existing: 'tier-1', incoming: 'tier-1', operation: 't' }),
    ).not.toThrow();
  });
});

describe('ArtifactRegistry — 注册/更新运行时 Tier 强制', () => {
  it('tier-1 注册缺 Gate 凭证 → 抛错', async () => {
    const reg = new ArtifactRegistry();
    await expect(
      reg.register(makeArtifact('a1', { authorityTier: 'tier-1' })),
    ).rejects.toThrow(GateContextRequiredError);
  });

  it('tier-1 注册持有有效凭证 → 成功', async () => {
    const reg = new ArtifactRegistry();
    await expect(
      reg.register(makeArtifact('a2', { authorityTier: 'tier-1', knowledgeContextPackage: validPkg() })),
    ).resolves.toBeUndefined();
  });

  it('tier-2 注册无晋升标记 → 抛错；有晋升标记 → 成功', async () => {
    const reg = new ArtifactRegistry();
    await expect(
      reg.register(makeArtifact('a3', { authorityTier: 'tier-2' })),
    ).rejects.toThrow(TierWriteRejectedError);
    await expect(
      reg.register(makeArtifact('a4', { authorityTier: 'tier-2', promotedByEvolution: true })),
    ).resolves.toBeUndefined();
  });

  it('tier-3 默认放行（历史调用方不阻断）', async () => {
    const reg = new ArtifactRegistry();
    await expect(reg.register(makeArtifact('a5'))).resolves.toBeUndefined();
  });

  it('update：tier-1 现有产物被 tier-3 覆盖 → 抛错', async () => {
    const reg = new ArtifactRegistry();
    await reg.register(makeArtifact('a6', { authorityTier: 'tier-1', knowledgeContextPackage: validPkg() }));
    await expect(
      reg.update(makeArtifact('a6', { authorityTier: 'tier-3' }), '覆盖'),
    ).rejects.toThrow(TierWriteRejectedError);
  });

  it('update：tier-3 现有产物升级 tier-2 无晋升 → 抛错', async () => {
    const reg = new ArtifactRegistry();
    await reg.register(makeArtifact('a7'));
    await expect(
      reg.update(makeArtifact('a7', { authorityTier: 'tier-2' }), '升级'),
    ).rejects.toThrow(/只有 L7 已晋升/);
  });
});

describe('EvolutionSandbox.approveAndApply — 晋升 Gate 硬拦截', () => {
  it('晋升缺 Gate 凭证 → 直接抛错（不产生半落地态）', async () => {
    const sandbox = new EvolutionSandbox();
    const rec = await sandbox.proposeChange({ proposalId: 'p1', summary: '演化变更' });
    expect(rec.status).toBe('pending_approval');

    await expect(sandbox.approveAndApply(rec.id)).rejects.toThrow(GateContextRequiredError);
    // 状态仍为 pending，未被晋升
    expect(rec.status).toBe('pending_approval');
  });

  it('晋升持有有效 Gate 凭证 → applied', async () => {
    const sandbox = new EvolutionSandbox();
    const rec = await sandbox.proposeChange({ proposalId: 'p2', summary: '带凭证晋升' });
    const applied = await sandbox.approveAndApply(rec.id, validPkg());
    expect(applied?.status).toBe('applied');
  });
});

describe('EvolutionProposal.create — 创建入口 Gate 强制', () => {
  it('tier-0 提案创建缺 Gate 凭证 → 抛错', () => {
    const ep = new EvolutionProposal();
    expect(() =>
      ep.create('t', 'd', 'impact', 'small', { riskTier: 'tier-0' }),
    ).toThrow(GateContextRequiredError);
  });

  it('tier-0 提案创建持有凭证 → DRAFT（pending 优先）', () => {
    const ep = new EvolutionProposal();
    const p = ep.create('t', 'd', 'impact', 'small', { riskTier: 'tier-0', gateContext: validPkg() });
    expect(p.status).toBe('DRAFT');
  });

  it('默认 tier-2 草稿创建 → DRAFT，无需凭证', () => {
    const ep = new EvolutionProposal();
    const p = ep.create('t', 'd', 'impact', 'medium');
    expect(p.status).toBe('DRAFT');
  });
});
