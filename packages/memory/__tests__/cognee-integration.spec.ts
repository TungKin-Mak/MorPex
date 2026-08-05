/**
 * cognee 真实引擎集成测试（L7 Memory / 外部依赖，P2 尾项）
 *
 * 前提：cognee 服务在线（`COGNEE_URL`，默认 http://127.0.0.1:8001）
 * 启动：`ENABLE_BACKEND_ACCESS_CONTROL=false GLM_API_KEY=... ./scripts/start-cognee.sh --bg`
 *
 * 设计（对齐项目降级策略）：
 *   - 探活：cognee 不在线 → 全部跳过（不使默认套件失败）
 *   - 真实链路：仅 COGNEE_E2E=1（或 RUN_LLM_E2E=1）时执行完整 write→建图→recall→search
 *     （真实 LLM 建图较慢，默认套件不做，避免拖慢）
 *   - 清理：afterAll forget 测试数据集
 *
 * 覆盖：
 *   - remember 真实写入 → recall 语义召回命中唯一事实
 *   - search（GRAPH_COMPLETION）返回答案
 *   - 空检索 → 数组返回 + 不虚构不存在的主题（防幻觉契约）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CogneeClient } from '../src/engines/cognee/client.js';

const BASE = process.env.COGNEE_URL || 'http://127.0.0.1:8001';
const RUN_REAL = process.env.COGNEE_E2E === '1' || process.env.RUN_LLM_E2E === '1';

let client: CogneeClient;
let healthy = false;
const DATASET = `morpex_test_${Date.now()}`;
const FACT = `MorPex 集成测试唯一事实标记 q7z9：旗舰产品定价 899 元每月`;

beforeAll(async () => {
  client = new CogneeClient({ baseUrl: BASE, timeoutMs: 180_000 });
  healthy = await client.available().catch(() => false);
}, 20000);

afterAll(async () => {
  if (healthy && RUN_REAL) {
    await client.forget(DATASET).catch(() => {});
  }
}, 30000);

describe('cognee 引擎可用性', () => {
  it('探测 cognee 服务（在线则健康，离线跳过真实链路）', () => {
    // 记录探活结果供日志；不断言（离线是合法环境）
    expect(typeof healthy).toBe('boolean');
    console.log(`  [cognee-integration] ${BASE} → ${healthy ? '✅ 在线' : '⏭ 离线，真实链路跳过'}${RUN_REAL ? '（COGNEE_E2E=1 执行真实链路）' : ''}`);
  });
});

describe('cognee 真实链路（COGNEE_E2E=1 时执行）', () => {
  it('remember 写入 → recall 语义召回命中唯一事实', async (ctx) => {
    if (!healthy || !RUN_REAL) { ctx.skip(); return; }
    const r = await client.remember(FACT, { dataset: DATASET });
    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();

    const hits = await client.recall('旗舰产品定价是多少', { dataset: DATASET });
    const texts = hits.map(h => JSON.stringify(h)).join(' ');
    expect(texts).toContain('899'); // 真实建图后语义召回命中价格事实
  }, 180000);

  it('search（GRAPH_COMPLETION）返回答案', async (ctx) => {
    if (!healthy || !RUN_REAL) { ctx.skip(); return; }
    const answers = await client.search('旗舰产品价格', 'GRAPH_COMPLETION', { dataset: DATASET });
    expect(Array.isArray(answers)).toBe(true);
    expect(answers.length).toBeGreaterThan(0);
  }, 180000);

  it('空检索 → 返回数组且不虚构不存在的主题（防幻觉契约）', async (ctx) => {
    if (!healthy || !RUN_REAL) { ctx.skip(); return; }
    const FAKE = '量子鲸鱼星系核子引擎';
    const hits = await client.recall(FAKE, { dataset: DATASET });
    expect(Array.isArray(hits)).toBe(true);
    // 即使有宽松召回，也不应断言出该不存在主题的"事实"
    const texts = hits.map(h => JSON.stringify(h)).join(' ');
    expect(texts.includes(FAKE)).toBe(false);
  }, 180000);
});
