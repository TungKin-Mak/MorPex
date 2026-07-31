/**
 * company-knowledge — 公司知识记忆接线测试（Gate 第5工具 + 强制门禁）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryApi,
  MockEngine,
} from '../src/adapters/memory/index.js';
import {
  queryCompanyKnowledge,
  initializeCompanyMemory,
} from '../src/memory/CompanyKnowledge.js';
import { createOntologyToolExecutor } from '../src/tools/ontologyTools.js';
import { ForcedQueryGuard } from '../src/ontology/ForcedQueryGuard.js';
import { OntologyService } from '../src/ontology/OntologyService.js';
import { systemMetadataGraph } from '../src/metadata/SystemMetadataGraph.js';
import { ObjectTypeRegistry } from '../src/ontology/ObjectTypeRegistry.js';

describe('公司知识记忆（Gate 接线）', () => {
  it('未接入 → notConnected + need_human（不伪造）', async () => {
    const r = await queryCompanyKnowledge({ text: '产品定价' });
    expect(r.notConnected).toBe(true);
    expect(r.need_human).toBe(true);
  });

  describe('已接入 MockEngine', () => {
    beforeEach(() => {
      const api = createMemoryApi({ engine: new MockEngine() });
      initializeCompanyMemory(api);
    });

    it('空检索 → need_human=true QueryMiss', async () => {
      const r = await queryCompanyKnowledge({ text: '绝不存在的独角兽产品' });
      expect(r.need_human).toBe(true);
      expect(r.reason).toBe('QueryMiss');
      expect(r.source).toBe('none');
    });

    it('写入并命中 → need_human=false + 证据上下文', async () => {
      // 写入公司事实
      const api = createMemoryApi({ engine: new MockEngine() });
      await api.upsert({
        name: 'MorPex 报表产品', entityType: 'Product',
        facts: ['定价 899 元/月'], confidence: 0.95,
      });
      initializeCompanyMemory(api);

      const r = await queryCompanyKnowledge({ text: '报表产品定价', domain: 'product' });
      expect(r.need_human).toBe(false);
      expect(r.hits.length).toBeGreaterThan(0);
      expect(r.promptContext).toContain('899');
      expect(r.notConnected).toBe(false);
    });
  });

  it('ontologyTools 第5工具：经 executor 调用返回公司知识', async () => {
    const api = createMemoryApi({ engine: new MockEngine() });
    await api.upsert({
      name: '规则 R1', entityType: 'Rule', facts: ['报价前必须合规'], confidence: 0.95,
    });
    initializeCompanyMemory(api);
    const guard = new ForcedQueryGuard();
    const ontology = new OntologyService(systemMetadataGraph, new ObjectTypeRegistry());
    const exec = createOntologyToolExecutor(ontology, guard, 'exec-1');
    const res = (await exec('ontology_queryCompanyKnowledge', {
      text: '报价前必须合规', domain: 'company',
    })) as { need_human: boolean; hits: Array<{ content: string }> };
    expect(res.need_human).toBe(false);
    expect(res.hits[0].content).toContain('合规');
  });
});
