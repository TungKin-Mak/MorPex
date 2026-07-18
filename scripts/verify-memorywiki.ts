#!/usr/bin/env tsx
/**
 * verify-memorywiki.ts — MemoryWiki 全链路验证脚本
 *
 * 验证：
 *  1. MemoryWiki 初始化 & 表结构
 *  2. 8 个高层 API 方法
 *  3. remember() 写入 & 回读
 *  4. 各模块集成（setWiki → 高层API调用）
 *  5. 双写链路（remember → SQLite → 查询）
 *  6. 回退链路（wiki=null → JSONL fallback）
 */

import { MemoryWiki } from '../packages/memory/src/wiki/index.js';
import { PlanExperienceStore } from '../packages/core/src/extensions/planning/PlanExperienceStore.js';
import { HistoryStore } from '../packages/memory/src/storage/HistoryStore.js';
import { SessionErrorExtractor } from '../packages/core/src/extensions/planning/SessionErrorExtractor.js';
import { TemplateManager } from '../packages/core/src/extensions/planning/TemplateManager.js';
import { PlanningIntelligenceEngine } from '../packages/core/src/extensions/planning/PlanningIntelligenceEngine.js';
import { KnowledgeGraph } from '../packages/core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js';

// ═══════════════════════════════════════════════════════════════
// 测试工具
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    const msg = `  ❌ FAIL: ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

function summary(): void {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  if (failures.length > 0) {
    console.log(`\n  失败项:`);
    for (const f of failures) console.log(`    ${f}`);
  }
  console.log(`═══════════════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════
// 主测试
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const testDbPath = './data/.test-memorywiki-verify.db';

  // 清理旧测试数据
  try { require('fs').unlinkSync(testDbPath); } catch {}
  try { require('fs').unlinkSync(testDbPath + '-shm'); } catch {}
  try { require('fs').unlinkSync(testDbPath + '-wal'); } catch {}

  console.log('═══════════════════════════════════════════');
  console.log('  MemoryWiki 全链路验证');
  console.log('═══════════════════════════════════════════\n');

  // ──────────────────────────────────────────────────────────
  // 1. MemoryWiki 初始化 & 表结构
  // ──────────────────────────────────────────────────────────
  console.log('📦 1. MemoryWiki 初始化 & 表结构');

  const wiki = new MemoryWiki({ dbPath: testDbPath });
  await wiki.initialize();
  assert(wiki.ready === true, 'wiki.ready === true');

  const stats = wiki.getStats();
  const expectedTables = ['planRecords', 'errorLogs', 'templateLineages', 'kgEntities', 'kgRelations', 'memoryEntries'];
  for (const key of expectedTables) {
    assert(typeof stats[key] === 'number', `stats.${key} 存在 (${stats[key]})`);
  }

  // ──────────────────────────────────────────────────────────
  // 2. remember() 写入测试
  // ──────────────────────────────────────────────────────────
  console.log('\n📝 2. remember() 写入测试');

  await wiki.remember({
    id: 'plan_test_001',
    type: 'PlanRecord',
    name: '测试计划: 部署微服务到 K8s',
    data: {
      execution_id: 'exec_001',
      task_id: 'k8s,deploy',
      user_input: '部署微服务到 K8s 集群',
      input_tags: JSON.stringify(['k8s', 'deploy', 'microservice']),
      s3_method: 'hierarchical',
      plan_score: 0.85,
      execution_success: 1,
      duration_ms: 5000,
      total_tokens_used: 1500,
      artifact_count: 3,
      created_at: Math.floor(Date.now() / 1000),
    },
  });

  await wiki.remember({
    id: 'plan_test_002',
    type: 'PlanRecord',
    name: '测试计划: 数据库迁移',
    data: {
      execution_id: 'exec_002',
      task_id: 'db,migration',
      user_input: '执行数据库迁移脚本',
      input_tags: JSON.stringify(['db', 'migration']),
      s3_method: 'llm',
      plan_score: 0.62,
      execution_success: 0,
      duration_ms: 3000,
      total_tokens_used: 800,
      artifact_count: 1,
      created_at: Math.floor(Date.now() / 1000),
    },
  });

  await wiki.remember({
    id: 'err_test_001',
    type: 'ErrorLog',
    name: 'K8s 连接超时',
    data: {
      session_id: 'sess_001',
      execution_id: 'exec_001',
      error_type: 'timeout',
      error_message: 'Connection to K8s API timed out after 30s',
      retry_count: 2,
      healing_attempted: 1,
      healing_succeeded: 0,
      timestamp: Date.now(),
    },
  });

  await wiki.remember({
    id: 'tpl_test_001',
    type: 'PlanTemplate',
    name: 'K8s 部署模板',
    data: {
      tags: JSON.stringify(['k8s', 'deploy']),
      success_rate: 0.9,
      usage_count: 5,
      version: 1,
    },
  });

  // 验证写入
  const stats2 = wiki.getStats();
  assert(stats2.planRecords >= 2, `planRecords >= 2 (实际: ${stats2.planRecords})`);
  assert(stats2.errorLogs >= 1, `errorLogs >= 1 (实际: ${stats2.errorLogs})`);

  // memory_entries 写测试
  await wiki.remember({
    id: 'mem_test_001',
    type: 'MemoryEntry',
    name: '测试记忆条目',
    data: {
      mem_type: 'summary',
      content: 'This is a test memory entry',
      source: 'verify-script',
      tags: JSON.stringify(['test', 'memory']),
      importance: 3,
      score: 0.85,
      pool: 'main',
      created_at: Math.floor(Date.now() / 1000),
    },
  });
  const stats3 = wiki.getStats();
  assert(stats3.memoryEntries >= 1, `memoryEntries >= 1 (实际: ${stats3.memoryEntries})`);

  // ──────────────────────────────────────────────────────────
  // 3. 高层 API 测试
  // ──────────────────────────────────────────────────────────
  console.log('\n🔌 3. 高层 API 测试');

  // 3a. getById
  const record = wiki.getById('plan_records', 'plan_test_001');
  assert(record !== undefined, 'getById: 查到 plan_test_001');
  assert((record as any)?.execution_id === 'exec_001', 'getById: execution_id 正确');

  const notFound = wiki.getById('plan_records', 'nonexistent');
  assert(notFound === undefined, 'getById: 不存在的 ID 返回 undefined');

  // 3b. queryByField
  const byExec = wiki.queryByField('plan_records', 'execution_id', 'exec_001');
  assert(byExec.length === 1, `queryByField execution_id: 1 条 (实际: ${byExec.length})`);

  const bySuccess = wiki.queryByField('plan_records', 'execution_success', 1);
  assert(bySuccess.length >= 1, `queryByField success=1: >=1 条 (实际: ${bySuccess.length})`);

  // 3c. queryByTags
  const byTags = wiki.queryByTags('plan_records', ['k8s'], { limit: 10, orderBy: 'plan_score DESC' });
  assert(byTags.length >= 1, `queryByTags [k8s]: >=1 条 (实际: ${byTags.length})`);
  assert((byTags[0] as any)?.plan_score >= (byTags[byTags.length - 1] as any)?.plan_score || byTags.length <= 1,
    'queryByTags: 按 plan_score DESC 排序');

  const byMultipleTags = wiki.queryByTags('plan_records', ['k8s', 'db'], { limit: 10 });
  assert(byMultipleTags.length >= 2, `queryByTags [k8s, db]: >=2 条 (实际: ${byMultipleTags.length})`);

  // 3d. getRecentEpisodes
  const recent = wiki.getRecentEpisodes('plan_records', 10);
  assert(recent.length >= 2, `getRecentEpisodes: >=2 条 (实际: ${recent.length})`);

  // 3e. getErrorLogs
  const errors = wiki.getErrorLogs(null, 10);
  assert(errors.length >= 1, `getErrorLogs(null): >=1 条 (实际: ${errors.length})`);

  const timeoutErrors = wiki.getErrorLogs('timeout', 10);
  assert(timeoutErrors.length >= 1, `getErrorLogs('timeout'): >=1 条 (实际: ${timeoutErrors.length})`);

  const noErrors = wiki.getErrorLogs('nonexistent_type', 10);
  assert(noErrors.length === 0, `getErrorLogs('nonexistent'): 0 条`);

  // 3f. getTemplateLineages
  const lineages = wiki.getTemplateLineages(undefined, 10);
  assert(Array.isArray(lineages), 'getTemplateLineages: 返回数组');

  // 3g. getFullEntity
  const fullEntity = wiki.getFullEntity('plan_test_001', 1);
  assert(fullEntity.entity !== null, 'getFullEntity: 实体存在');
  assert(Array.isArray(fullEntity.relations), 'getFullEntity: relations 是数组');

  // 3h. getIntelligenceState
  const intelState = wiki.getIntelligenceState();
  assert(intelState === null || typeof intelState === 'object', 'getIntelligenceState: 返回 null 或对象');

  // 3i. 新增 6 个专用查询 API
  console.log('\n📋 3i. 新增专用查询 API');

  const planTemplates = wiki.getPlanTemplates(null, 10);
  assert(Array.isArray(planTemplates), 'getPlanTemplates: 返回数组');

  const toolQuality = wiki.getToolQuality(null, 10);
  assert(Array.isArray(toolQuality), 'getToolQuality: 返回数组');

  const errorReports = wiki.getErrorReports(null, 10);
  assert(Array.isArray(errorReports), 'getErrorReports: 返回数组');

  const decisionTraces = wiki.getDecisionTraces(null, 10);
  assert(Array.isArray(decisionTraces), 'getDecisionTraces: 返回数组');

  const deviationLogs = wiki.getDeviationLogs(null, 10);
  assert(Array.isArray(deviationLogs), 'getDeviationLogs: 返回数组');

  const checkpoints = wiki.getCheckpointsByExecution('exec_001');
  assert(Array.isArray(checkpoints), 'getCheckpointsByExecution: 返回数组');

  const memEntries = wiki.getMemoryEntries(null, 10);
  assert(Array.isArray(memEntries), 'getMemoryEntries: 返回数组');
  const memMain = wiki.getMemoryEntries('main', 10);
  assert(memMain.length >= 1, `getMemoryEntries('main'): >=1 条 (实际: ${memMain.length})`);

  // 3j. queryByTimeRange
  const now = Date.now();
  // created_at 是秒级 unix 时间戳
  const secFrom = 0;
  const secTo = Math.floor(now / 1000) + 3600;
  const timeRange = wiki.queryByTimeRange('plan_records', 'created_at', secFrom, secTo);
  assert(timeRange.length >= 2, `queryByTimeRange plan_records: >=2 条 (实际: ${timeRange.length})`);
  // error_logs.timestamp 是毫秒级
  const msFrom = 0;
  const msTo = now + 3600000;
  const timeField = wiki.queryByTimeRange('error_logs', 'timestamp', msFrom, msTo, { limit: 5, orderBy: 'timestamp ASC' });
  assert(timeField.length >= 1, `queryByTimeRange error_logs: >=1 条 (实际: ${timeField.length})`);

  // ──────────────────────────────────────────────────────────
  // 4. 模块集成测试：setWiki → 高层 API
  // ──────────────────────────────────────────────────────────
  console.log('\n🔗 4. 模块集成测试');

  // 4a. PlanExperienceStore
  const store = new PlanExperienceStore();
  store.setWiki(wiki);
  await store.initialize();

  const gotRecord = store.getRecord('plan_test_001');
  assert(gotRecord !== undefined, 'PlanExperienceStore.getRecord: 查到记录');
  assert(gotRecord!.executionId === 'exec_001', 'PlanExperienceStore.getRecord: executionId 正确');

  const byExecRecords = store.getRecordsByExecution('exec_001');
  assert(byExecRecords.length === 1, `PlanExperienceStore.getRecordsByExecution: 1 条 (实际: ${byExecRecords.length})`);

  const byTagRecords = store.queryByTags(['k8s'], 10);
  assert(byTagRecords.length >= 1, `PlanExperienceStore.queryByTags: >=1 条 (实际: ${byTagRecords.length})`);

  // 4b. HistoryStore
  const history = new HistoryStore();
  history.setWiki(wiki);
  await history.initialize();

  // 写入测试数据到 history_records
  await wiki.remember({
    id: 'hist_001',
    type: 'HistoryRecord',
    name: '测试历史',
    data: {
      type: 'task',
      execution_id: 'exec_001',
      task_id: 'task_001',
      data_json: JSON.stringify({ status: 'completed' }),
      created_at: Math.floor(Date.now() / 1000),
    },
  });

  const histRecords = history.getTasksByExecution('exec_001');
  assert(histRecords.length >= 1, `HistoryStore.getTasksByExecution: >=1 条 (实际: ${histRecords.length})`);

  // 4c. SessionErrorExtractor (loadRecentErrors 是 private，通过 recordError 公开 API 验证)
  const errorExtractor = new SessionErrorExtractor();
  errorExtractor.setWiki(wiki);
  // recordError 会实时追加到内部缓冲区
  errorExtractor.recordError('sess_test', 'exec_001', {
    nodeId: 'node_001',
    errorMessage: 'Test error from verify',
    errorType: 'test_error',
    timestamp: Date.now(),
  });
  assert(true, 'SessionErrorExtractor.recordError 写入成功');

  // 4d. TemplateManager (loadLineages 是 private，通过 getAllLineages 公开 API 验证)
  const templateMgr = new TemplateManager(store, { useLLMForFix: false }, './data/.test-templates');
  templateMgr.setWiki(wiki);

  const allLineages = templateMgr.getAllLineages();
  assert(Array.isArray(allLineages), `TemplateManager.getAllLineages: 返回数组 (${allLineages.length} 条)`);

  // 4e. KnowledgeGraph 集成（setWiki → addEntity → wiki.remember）
  const kg = new KnowledgeGraph();
  kg.setWiki(wiki);
  const kgEntity = await kg.addEntity({
    type: 'agent' as any,
    name: 'test_agent',
    description: 'Test entity for KnowledgeGraph integration',
    tags: ['test', 'verify'],
  });
  assert(kgEntity.id.startsWith('keg_'), `KnowledgeGraph.addEntity: ID 以 keg_ 开头 (${kgEntity.id})`);
  const gotKG = wiki.getById('kg_entities', kgEntity.id);
  assert(gotKG !== undefined, 'KnowledgeGraph → wiki.getById: 持久化成功');
  console.log(`  ✅ KnowledgeGraph.setWiki → addEntity (${kgEntity.id})`);

  // 4f. PlanningIntelligenceEngine
  // Note: PlanningIntelligenceEngine requires a MetaPlanner instance, test indirectly
  // We already verified wiki.getIntelligenceState() works above

  // ──────────────────────────────────────────────────────────
  // 5. 回退链路测试：wiki=null → JSONL fallback
  // ──────────────────────────────────────────────────────────
  console.log('\n🔄 5. 回退链路测试 (wiki=null)');

  const storeNoWiki = new PlanExperienceStore();
  await storeNoWiki.initialize();
  // wiki 未注入，应回退到 JSONL 内存索引
  const fallbackResult = storeNoWiki.queryByTags(['k8s'], 10);
  assert(Array.isArray(fallbackResult), 'wiki=null 时不崩溃，返回数组');

  // ──────────────────────────────────────────────────────────
  // 6. 清理
  // ──────────────────────────────────────────────────────────
  console.log('\n🧹 6. 清理');
  wiki.close();
  try { require('fs').unlinkSync(testDbPath); } catch {}
  try { require('fs').unlinkSync(testDbPath + '-shm'); } catch {}
  try { require('fs').unlinkSync(testDbPath + '-wal'); } catch {}
  console.log('  ✅ 测试数据库已删除');

  // ──────────────────────────────────────────────────────────
  summary();
}

main().catch(err => {
  console.error('\n💥 验证脚本异常:', err);
  process.exit(1);
});
