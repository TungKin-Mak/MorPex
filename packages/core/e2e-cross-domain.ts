// @ts-nocheck
/**
 * Cross-Domain — 端到端测试
 *
 * Phase 10 + Phase 11 + Phase 11.5 验证：
 *   1. CrossDomainRouter 的 LLM 任务拆解
 *   2. DAG 构建与验证
 *   3. DomainDispatcher 的 DAG 执行调度
 *   4. Cross-Domain EventBus 通信
 *   5. NegotiationEngine 质询工单生命周期
 *
 * 运行：
 *   npx tsx packages/core/e2e-cross-domain.ts
 */

import { DomainManifestLoader } from './src/domains/DomainManifestLoader.js';
import { DomainClusterManager } from './src/domains/DomainClusterManager.js';
import { CrossDomainRouter } from './src/router/CrossDomainRouter.js';
import { DomainDispatcher } from './src/router/DomainDispatcher.js';
import { NegotiationEngine } from './negotiation/NegotiationEngine.js';
import { ArbitrationHandler } from './src/router/ArbitrationHandler.js';
import { CrossDomainEventTypes } from './src/events/CrossDomainEvents.js';
import { EventBus } from './src/common/EventBus.js';
import type { MorPexEvent } from './src/common/types.js';
import type { DomainManifest, DAGNode } from './src/domains/types.js';

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Cross-Domain — 端到端测试');
  console.log('═══════════════════════════════════════════════\n');

  // ── Phase 10: Cross-Domain Router ──
  console.log('📋 Phase 10: Cross-Domain Router');
  console.log('─'.repeat(50));

  // 1. 加载领域清单
  const loader = new DomainManifestLoader();
  const manifests = await loader.loadAll();

  if (manifests.length === 0) {
    console.log('  ⚠️ 没有加载到领域清单，使用模拟数据');
    manifests.push({
      domain_id: 'software_engineering',
      domain_name: '软件工程',
      version: '1.0.0',
      master_agent_config: { system_prompt: '', model: 'deepseek' },
      subscribed_events: [],
      skills: [],
      output_artifacts: [],
      wake_conditions: { intent_patterns: ['软件', '代码', '开发', '编程'], events: [], artifact_triggers: [] },
    });
    manifests.push({
      domain_id: 'business_finance',
      domain_name: '商业金融',
      version: '1.0.0',
      master_agent_config: { system_prompt: '', model: 'deepseek' },
      subscribed_events: [],
      skills: [],
      output_artifacts: [],
      wake_conditions: { intent_patterns: ['商业', '金融', '市场', '财务'], events: [], artifact_triggers: [] },
    });
  }

  // 2. 创建 ClusterManager
  const manager = new DomainClusterManager();
  manager.registerMultiple(manifests);
  console.log(`  ✅ ${manager.registeredCount} 个领域集群已注册`);

  // 3. 创建 CrossDomainRouter（LLMProvider 已由 LLMProvider.set 注册）
  const { LLMProvider } = await import('./services/LLMProvider.js');
  LLMProvider.set(async (prompt) => {
    // 模拟 LLM 返回固定的 JSON
    return JSON.stringify({
      tasks: [
        { id: 'task_0', domain: 'software_engineering', goal: '设计系统架构', deps: [] },
        { id: 'task_1', domain: 'business_finance', goal: '分析市场可行性', deps: ['task_0'] },
      ],
      reasoning: '该需求先需要技术设计，再进行市场分析',
    });
  });
  const router = new CrossDomainRouter(manager);

  // 4. 测试 DAG 拆解（v2.4 dispatch 统一入口）
  const testInput = '设计一个系统架构并分析市场可行性';
  console.log(`\n  输入: "${testInput}"`);

  const dag = await router.dispatch(testInput);
  console.log(`  拆解: ${dag.nodes.length} 个子任务`);

  for (const node of dag.nodes) {
    const deps = node.deps.length > 0 ? ` (依赖: ${node.deps.join(', ')})` : '';
    console.log(`    📌 ${node.taskId}: [${node.domain}] ${node.goal}${deps}`);
  }
  console.log(`  推理: ${dag.reasoning}`);
  console.log(`  DAG: ${dag.nodes.length} 个节点, 多领域: ${dag.isMultiDomain}`);

  // ── Phase 11: Cross-Domain EventBus ──
  console.log('\n📋 Phase 11: Cross-Domain EventBus');
  console.log('─'.repeat(50));

  const bus = new EventBus();

  // 注册领域监听器
  let domainEventReceived = false;
  const unsub1 = bus.onDomain('software_engineering', 'domain.task_completed', (event) => {
    console.log(`  📨 [software_engineering] 收到领域事件: ${event.type}`);
    domainEventReceived = true;
  });

  // 跨领域广播
  let crossDomainEventReceived = false;
  bus.on('cross_domain.artifact_shared', (event) => {
    console.log(`  📨 [全局] 收到跨领域事件: ${event.type}`);
    crossDomainEventReceived = true;
  });

  // 发送领域事件
  bus.emitToDomain('software_engineering', {
    id: 'evt_1',
    type: 'domain.task_completed',
    timestamp: Date.now(),
    executionId: 'test',
    source: 'test',
    payload: { domainId: 'software_engineering', taskId: 'task_0', artifacts: [] },
  });

  bus.emit({
    id: 'evt_2',
    type: 'cross_domain.artifact_shared',
    timestamp: Date.now(),
    executionId: 'test',
    source: 'test',
    payload: { sourceDomain: 'software_engineering', targetDomain: 'business_finance', artifact: { uri: 'artifact://test/doc/1', type: 'doc', name: '架构设计' } },
  });

  console.log(`  领域事件接收: ${domainEventReceived ? '✅' : '❌'}`);
  console.log(`  跨领域事件接收: ${crossDomainEventReceived ? '✅' : '❌'}`);

  unsub1();

  // ── Phase 11.5: Negotiation Protocol ──
  console.log('\n📋 Phase 11.5: Negotiation Protocol');
  console.log('─'.repeat(50));

  const negotiation = new NegotiationEngine(
    { maxDepth: 3, maxActivePerPair: 1 },
    {
      onTicketCreated: (ticket) => console.log(`  🎫 工单创建: ${ticket.ticket_id} (${ticket.conflict_type})`),
      onEscalated: (ticket) => console.log(`  🚨 工单升级: ${ticket.ticket_id} (depth=${ticket.depth_count})`),
      onResolved: (ticket) => console.log(`  ✅ 工单解决: ${ticket.ticket_id} → ${ticket.status}`),
    },
  );

  // 创建质询工单
  const ticket = negotiation.createTicket({
    source_domain: 'business_finance',
    target_domain: 'software_engineering',
    trigger_artifact_id: 'arch_design_001',
    conflict_type: 'COST_OVERRUN',
    reason: '架构设计中的云服务成本超出预算限制',
    suggestion: '建议使用更经济的替代方案，如边缘计算替代云服务器',
    context_snapshot: { max_allowed_cost: 50000, current_calculated_cost: 120000 },
  });
  console.log(`  ✅ 工单创建成功: ${ticket.ticket_id}`);

  // 测试全局限流（第一个工单仍 PENDING，应拒绝第二个同对工单）
  try {
    negotiation.createTicket({
      source_domain: 'business_finance',
      target_domain: 'software_engineering',
      trigger_artifact_id: 'arch_design_002',
      conflict_type: 'TECH_INFEASIBLE',
      reason: '重复测试',
      suggestion: '测试限流',
    });
    console.log('  ❌ 限流测试失败（应拒绝但未拒绝）');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✅ 限流测试通过: ${msg}`);
  }

  // 接受质询
  const updated = negotiation.respond(ticket.ticket_id, 'accept', '同意修改，将使用边缘计算方案降低成本');
  console.log(`  ✅ 被质询者接受: ${updated.status}`);

  // 测试死循环检测
  const ticket2 = negotiation.createTicket({
    source_domain: 'legal_compliance',
    target_domain: 'software_engineering',
    trigger_artifact_id: 'security_audit_001',
    conflict_type: 'SECURITY_VULN',
    reason: '用户数据加密方案不符合GDPR要求',
    suggestion: '建议增加端到端加密',
  });

  // 来回反驳直到触发升级
  let currentTicket = ticket2;
  for (let i = 0; i < 5; i++) {
    try {
      const action = i % 2 === 0 ? 'argue' : 'argue';
      currentTicket = negotiation.respond(currentTicket.ticket_id, action, `第${i + 1}轮反驳详细说明...`);
      console.log(`  🔄 反驳第${i + 1}轮: depth=${currentTicket.depth_count}, status=${currentTicket.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️ 工单已关闭: ${msg}`);
      break;
    }
  }

  const stats = negotiation.getStats();
  console.log(`\n  协商统计:`);
  console.log(`    总工单: ${stats.totalTickets}`);
  console.log(`    活跃工单: ${stats.activeTickets}`);
  console.log(`    已升级: ${stats.escalatedTickets}`);
  console.log(`    已解决: ${stats.resolvedTickets}`);

  // ── Phase 12: Knowledge Graph Cross-Domain ──
  console.log('\n📋 Phase 12: Cross-Domain Knowledge Graph');
  console.log('─'.repeat(50));

  const { KnowledgeGraph } = await import('./planes/knowledge-plane/knowledge/KnowledgeGraph.js');
  const kg = new KnowledgeGraph({ dataDir: './data/test-cross-domain-kg' });

  // 创建跨领域实体
  const entity1 = kg.addEntity(
    { type: 'artifact', name: '智能农业监控系统设计', tags: ['hardware', 'iot'] },
    'hardware_engineering',
  );
  const entity2 = kg.addEntity(
    { type: 'artifact', name: '智能农业市场推广方案', tags: ['business', 'marketing'] },
    'business_finance',
  );
  console.log(`  实体1 (hardware): ${entity1.name} [${entity1.domainId}]`);
  console.log(`  实体2 (business): ${entity2.name} [${entity2.domainId}]`);

  // 跨领域搜索
  const crossResults = kg.searchCrossDomain('智能农业', ['hardware_engineering', 'business_finance']);
  console.log(`  跨领域搜索 "智能农业": ${crossResults.length} 个结果`);

  // 自动关联
  const links = kg.autoLinkCrossDomain(0.5);
  console.log(`  自动关联: ${links.length} 个跨领域关系`);

  // 领域子图
  const subgraph = kg.getDomainSubgraph('hardware_engineering');
  console.log(`  领域子图 (hardware): ${subgraph.entities.length} 实体, ${subgraph.relations.length} 关系`);

  // ── 汇总 ──
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Cross-Domain 测试完成');
  console.log('═══════════════════════════════════════════════\n');

  // 清理测试数据
  const fs = await import('fs');
  try { fs.rmSync('./data/test-cross-domain-kg', { recursive: true, force: true }); } catch {}
}

main().catch(err => {
  console.error(`\n❌ 测试失败:`, err.message);
  process.exit(1);
});
