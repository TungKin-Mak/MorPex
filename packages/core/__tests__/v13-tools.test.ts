/**
 * v13 Tools 模块测试 — ToolRegistry + ToolFactory
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ToolFactory } from '../src/tools/ToolFactory.js';

describe('ToolRegistry', () => {
  beforeEach(() => {
    // 每次测试前重置
    ToolRegistry.clear();
  });

  it('register 注册工具并返回 toolId', async () => {
    const toolId = await ToolRegistry.register(
      {
        name: 'test_tool',
        description: '测试工具',
        parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
        category: 'test',
      },
      'export async function test_tool() {}',
    );
    expect(toolId).toBeTruthy();
    expect(toolId).toContain('tool_');
  });

  it('get 获取已注册工具', async () => {
    const toolId = await ToolRegistry.register(
      { name: 'my_tool', description: '我的工具', parameters: { type: 'object', properties: {}, required: [] } },
      '// code',
    );
    const tool = ToolRegistry.get(toolId);
    expect(tool).toBeDefined();
    expect(tool!.schema.name).toBe('my_tool');
    expect(tool!.version).toBe(1);
  });

  it('list 按 category 过滤', async () => {
    await ToolRegistry.register(
      { name: 'search', description: '搜索', parameters: { type: 'object', properties: {}, required: [] }, category: 'research' },
      '',
    );
    await ToolRegistry.register(
      { name: 'execute', description: '执行', parameters: { type: 'object', properties: {}, required: [] }, category: 'development' },
      '',
    );
    const researchTools = ToolRegistry.list('research');
    expect(researchTools.length).toBe(1);
    expect(researchTools[0].schema.name).toBe('search');
  });

  it('updateStats 更新统计并发射事件', async () => {
    const eb = new EventBus();
    ToolRegistry.init(eb);

    const toolId = await ToolRegistry.register(
      { name: 'stat_tool', description: '统计工具', parameters: { type: 'object', properties: {}, required: [] } },
      '',
    );

    ToolRegistry.updateStats(toolId, true, 100);
    ToolRegistry.updateStats(toolId, true, 50);
    ToolRegistry.updateStats(toolId, false, 200);

    const tool = ToolRegistry.get(toolId);
    expect(tool!.stats.successCount).toBe(2);
    expect(tool!.stats.failureCount).toBe(1);
    expect(tool!.stats.avgDuration).toBeCloseTo(116.67, 0); // (100+50+200)/3
  });

  it('getTopTools 按成功率排序', async () => {
    const id1 = await ToolRegistry.register(
      { name: 'good_tool', description: '好工具', parameters: { type: 'object', properties: {}, required: [] } },
      '',
    );
    const id2 = await ToolRegistry.register(
      { name: 'bad_tool', description: '差工具', parameters: { type: 'object', properties: {}, required: [] } },
      '',
    );

    ToolRegistry.updateStats(id1, true, 10);
    ToolRegistry.updateStats(id1, true, 20);
    ToolRegistry.updateStats(id2, false, 100);

    const top = ToolRegistry.getTopTools(2);
    expect(top[0].schema.name).toBe('good_tool');
  });

  it('getQualityReport 返回质量报告', async () => {
    const id = await ToolRegistry.register(
      { name: 'report_tool', description: '报告工具', parameters: { type: 'object', properties: {}, required: [] } },
      '',
    );
    ToolRegistry.updateStats(id, true, 50);

    const report = ToolRegistry.getQualityReport();
    expect(report).toHaveProperty('topTools');
    expect(report).toHaveProperty('worstTools');
    expect(report).toHaveProperty('recommendations');
    expect(report.overallStats.totalTools).toBe(1);
  });
});

describe('ToolFactory', () => {
  let eventBus: EventBus;
  let factory: ToolFactory;

  beforeEach(() => {
    eventBus = new EventBus();
    factory = new ToolFactory(eventBus);
    ToolRegistry.clear();
    ToolRegistry.init(eventBus);
  });

  it('generateToolForTask 匹配预置模板（搜索类）', async () => {
    const result = await factory.generateToolForTask('搜索最新的AI技术资讯');
    expect(result.name).toBe('web_search');
    expect(result.category).toBe('research');
  });

  it('generateToolForTask 匹配预置模板（API类）', async () => {
    const result = await factory.generateToolForTask('调用外部API获取数据');
    expect(result.name).toBe('api_call');
    expect(result.category).toBe('integration');
  });

  it('generateToolForTask 兜底 fallback（无法匹配时返回通用工具）', async () => {
    const result = await factory.generateToolForTask('做一份红烧肉的菜谱');
    expect(result.toolId).toBeTruthy();
    // 无匹配预设，使用通用工具
    expect(result.name).toBe('generic_tool');
  });
});
