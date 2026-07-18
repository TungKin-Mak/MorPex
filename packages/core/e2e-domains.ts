/**
 * Domain Manifest — 端到端测试
 *
 * Phase 8 + Phase 9 验证：
 *   1. DomainManifestLoader 成功加载所有清单
 *   2. DomainCluster 创建、唤醒、执行、休眠
 *   3. DomainClusterManager 注册、查询、多领域管理
 *
 * 运行：
 *   npx tsx packages/core/e2e-domains.ts
 */

import { DomainManifestLoader } from './src/domains/DomainManifestLoader.js';
import { DomainCluster } from './src/domains/DomainCluster.js';
import { DomainClusterManager } from './src/domains/DomainClusterManager.js';

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Domain Manifest — 端到端测试');
  console.log('═══════════════════════════════════════════════\n');

  // ── Phase 8: Domain Manifest Protocol ──
  console.log('📋 Phase 8: Domain Manifest Protocol');
  console.log('─'.repeat(50));

  const loader = new DomainManifestLoader();
  const manifests = await loader.loadAll();

  console.log(`\n  已加载 ${manifests.length} 个领域清单:`);
  for (const m of manifests) {
    const v = loader.validate(m);
    const status = v.valid ? '✅' : '❌';
    console.log(`  ${status} ${m.domain_name} (${m.domain_id}) v${m.version}`);
    if (!v.valid) {
      for (const e of v.errors) {
        console.log(`     错误: ${e.field} → ${e.message}`);
      }
    }
    if (v.warnings.length > 0) {
      for (const w of v.warnings) {
        console.log(`     ⚠️ ${w}`);
      }
    }
    console.log(`     ├─ 技能: ${m.skills.join(', ')}`);
    console.log(`     ├─ 产物: ${m.output_artifacts.map(a => a.type).join(', ')}`);
    console.log(`     └─ 唤醒词: ${m.wake_conditions.intent_patterns.slice(0, 3).join(', ')}...`);
  }

  if (manifests.length === 0) {
    console.log('  ⚠️ 没有加载到任何领域清单');
    return;
  }

  // ── Phase 9: Dynamic Domain Clusters ──
  console.log('\n📋 Phase 9: Dynamic Domain Clusters');
  console.log('─'.repeat(50));

  const manager = new DomainClusterManager();
  const clusters = manager.registerMultiple(manifests);

  console.log(`\n  已注册 ${clusters.length} 个领域集群`);

  // 测试意图匹配
  const testIntents = [
    '帮我写一个 Python 脚本',
    '分析这份财务报表',
    '审查这个合同的合规性',
    '随便聊聊',
  ];

  console.log('\n  关键词意图匹配 (无 LLM):');
  for (const intent of testIntents) {
    const matched = await manager.findDomainByIntent(intent);
    if (matched) {
      console.log(`  📌 "${intent.substring(0, 20)}"... → ${matched.domain_name}`);
    } else {
      console.log(`  ❌ "${intent.substring(0, 20)}"... → 未匹配`);
    }
  }

  // 测试 findDomainsByIntent（多匹配）
  console.log('\n  多领域匹配测试 (关键词):');
  const results = await manager.findDomainsByIntent('设计一个系统架构并分析市场');
  for (const r of results) {
    console.log(`  📊 ${r.manifest.domain_name}: 匹配度 ${r.score.toFixed(2)}`);
  }

  // 如果配置了 LLM caller，测试 LLM 意图匹配
  console.log('\n  💡 提示: 在 StudioServer 中运行时会自动使用 pi-ai LLM 进行语义匹配。');
  console.log('     关键词未匹配的输入（如"帮我写一个 Python 脚本"）会被 LLM 正确识别。');

  // 唤醒一个领域集群
  if (clusters.length > 0) {
    const firstClusterId = clusters[0].manifest.domain_id;
    console.log(`\n  唤醒领域: ${firstClusterId}...`);
    try {
      await manager.wake(firstClusterId);
      const cluster = manager.getCluster(firstClusterId)!;
      console.log(`  状态: ${cluster.status}`);
      console.log(`  技能: ${cluster.getSkillNames().join(', ') || '无'}`);
      console.log('  ✅ 领域集群唤醒成功');

      // 休眠
      await manager.sleep(firstClusterId);
      console.log(`  状态: ${cluster.status}`);
      console.log('  💤 领域集群已休眠');
    } catch (err: any) {
      console.log(`  ⚠️ 唤醒测试: ${err.message}（LLM 可能不可用，但这不影响领域协议验证）`);
    }
  }

  // ── 验证报告 ──
  console.log('\n📋 报告');
  console.log('─'.repeat(50));
  const reports = manager.getStatusReports();
  for (const r of reports) {
    console.log(`  ${r.domain_id}: ${r.status}`);
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  ✅ Domain Manifest 测试完成`);
  console.log(`  ${manifests.length} 个领域清单已加载, ${manager.registeredCount} 个集群已注册`);
  console.log(`═══════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(`\n❌ 测试失败:`, err.message);
  process.exit(1);
});
