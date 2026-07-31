/**
 * e2e-cognee — 统一记忆层 ↔ cognee server 真实联调
 *
 * 前置：cognee server 已起（uvicorn cognee.api.client:app --port 8000）
 * 运行：npx tsx scripts/e2e-cognee.ts
 *
 * 验证：写入公司事实 → 图检索命中 → 空检索 need_human
 */
import { createMemoryApi, createEngine } from '../packages/memory/src/index.js';

async function main(): Promise<void> {
  const api = createMemoryApi({
    engine: createEngine({ baseUrl: process.env.COGNEE_URL ?? 'http://localhost:8001' }),
  });

  // 直接探测 cognee 可用性
  const res = await fetch(`${process.env.COGNEE_URL ?? 'http://localhost:8001'}/api/v1/datasets`);
  console.log('cognee server 在线:', res.ok);

  // 1) 写入公司事实（高置信 → 直接进图）
  const u = await api.upsert({
    name: 'MorPex 报表产品',
    entityType: 'Product',
    facts: ['定价 899 元/月', '支持数据导出，兼容 Chrome 120'],
    confidence: 0.95,
    dataset: 'company',
  });
  console.log('upsert:', JSON.stringify(u));

  // 2) 图检索命中
  const q = await api.query({ text: '报表产品定价多少', domain: 'product', dataset: 'company' });
  console.log('查询 → need_human=', q.need_human, 'source=', q.source, 'reason=', q.reason);
  for (const h of q.hits.slice(0, 5)) {
    console.log('  [', h.source, ']', h.content.slice(0, 80));
  }

  // 3) 空检索 → need_human
  const empty = await api.query({ text: '绝不存在的独角兽产品 X 的定价', domain: 'product' });
  console.log('空检索 → need_human=', empty.need_human, 'reason=', empty.reason);

  api.close();
}

main().catch((e) => {
  console.error('E2E 失败:', (e as Error).message);
  process.exit(1);
});
