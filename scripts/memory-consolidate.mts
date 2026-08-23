#!/usr/bin/env node
/**
 * scripts/memory-consolidate.mts — T7 记忆沉淀批处理
 *
 * 晋升：30 天窗口内 mentionCount ≥ 3 或 weight ≥ 0.95 → permanent（免疫衰减）
 * 衰减：非永久层超 30 天未提及 → weight 减半；低于 0.2 归档（从权重簿删除）
 *
 * 用法：npx tsx scripts/memory-consolidate.mts [--db <路径>]
 *   默认库：data/sessions/memory-weights.db（StudioServer 启动时创建）
 * 建议挂周计划任务或手动执行；幂等可重跑。
 */
import { MemoryWeightStore, PROMOTE_MENTION_COUNT, PROMOTE_WEIGHT } from '../packages/memory/src/storage/MemoryWeightStore.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dbArg = process.argv.indexOf('--db');
const dbPath = dbArg > -1 && process.argv[dbArg + 1]
  ? process.argv[dbArg + 1]
  : path.join(process.cwd(), 'data', 'sessions', 'memory-weights.db');

if (!existsSync(dbPath)) {
  console.log(`[memory-consolidate] 权重簿不存在（${dbPath}）——尚无记忆写入，无事可做。`);
  process.exit(0);
}

const store = new MemoryWeightStore(dbPath);
try {
  const promoted = store.applyPromotions();
  const { decayed, archived } = store.applyDecays();
  console.log(`[memory-consolidate] 晋升 permanent ${promoted.length} 条${promoted.length ? '：' + promoted.join('、') : ''}`);
  console.log(`[memory-consolidate] 衰减 ${decayed.length} 条${decayed.length ? '：' + decayed.join('、') : ''}`);
  console.log(`[memory-consolidate] 归档 ${archived.length} 条${archived.length ? '：' + archived.join('、') : ''}`);
  console.log(`[memory-consolidate] 阈值：提及≥${PROMOTE_MENTION_COUNT}/30天 或 weight≥${PROMOTE_WEIGHT} 晋升；非永久层闲置 30 天衰减。`);
} finally {
  store.close();
}
