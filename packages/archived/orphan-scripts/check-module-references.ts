/**
 * check-module-references.ts — Phase 3 模块引用扫描
 *
 * 扫描整个代码库中待裁剪模块的所有引用点。
 * 输出引用分析报告，指导 Phase 3.2-3.4 的裁剪决策。
 *
 * 使用方法：
 *   npx tsx scripts/check-module-references.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 配置 ──

const ROOT = path.resolve(import.meta.dirname, '..');

// 待扫描的模块组
const CANDIDATES: Array<{ group: string; modules: string[]; reason: string }> = [
  {
    group: 'Federation',
    modules: [
      'AgentTransport', 'RemoteAgentProxy', 'DistributedRuntimeManager',
      'DistributedScheduler', 'DistributedSqliteRepository', 'ConsensusCoordinator',
      'FederationManager', 'NodeIdentity', 'RemoteExecutor', 'CapabilityDiscovery',
    ],
    reason: '一人公司不需要多节点联邦',
  },
  {
    group: 'Marketplace',
    modules: [
      'MarketplaceRegistry', 'BidEngine', 'TrustVerifier', 'CapabilityAdvertiser',
      'ThirdPartyAgentAdapter', 'MarketplaceContract', 'MarketplaceSqliteRepository',
    ],
    reason: '没有第三方 Agent 参与竞标',
  },
  {
    group: 'TeamFormation',
    modules: [
      'TeamFormationEngine', 'TeamCompositionOptimizer', 'RoleAssignmentStrategy',
      'TeamLifecycleManager', 'TeamSqliteRepository',
    ],
    reason: '部门固定，不需要动态组队',
  },
  {
    group: 'Governance',
    modules: [
      'OrganizationPolicyEngine', 'TeamGovernanceModel', 'OrgBudgetAllocator',
      'GovernanceAudit', 'GovernanceSqliteRepository', 'AgentGovernanceRepository',
    ],
    reason: '一人公司不需要复杂治理层级',
  },
  {
    group: 'SharedMemory',
    modules: [
      'SharedMemoryManager', 'ConsensusProtocol', 'MemoryLockService',
      'ConflictResolver', 'MemorySnapshotService', 'SharedMemorySqliteRepository',
    ],
    reason: '部门隔离后不需要共识协议',
  },
  {
    group: 'ChaosEngineering',
    modules: ['ChaosEngine', 'FaultInjector', 'BUILTIN_SCENARIOS'],
    reason: '一人公司不需要混沌工程',
  },
  {
    group: 'ReliabilityAdvanced',
    modules: ['GoldenDatasetManager', 'RegressionRunner', 'WorkflowPromotion', 'WorkflowLifecycleStatus'],
    reason: '回归测试和金数据集在企业级场景才需要',
  },
  {
    group: 'RedundantObservability',
    modules: ['CoverageRunner', 'ExerciseAllEngine'],
    reason: '生产不需要 79 模块覆盖率报告',
  },
  {
    group: 'RedundantExtensions',
    modules: ['PipelineLogger', 'SessionErrorExtractor'],
    reason: '日志和错误提取合并到 ObservabilityLite',
  },
];

// 排除目录
const EXCLUDE_DIRS = ['node_modules', '.git', 'archived', 'dist', 'build'];

// ── 扫描逻辑 ──

interface Reference {
  file: string;
  line: number;
  lineContent: string;
}

interface ModuleRefs {
  moduleName: string;
  group: string;
  reason: string;
  internalRefs: Reference[];   // packages/core/src 内
  externalRefs: Reference[];   // 外部引用（studio, scripts, tests）
  barrelExports: Reference[];  // barrel index.ts 中的 re-export
}

function scanReferences(root: string): ModuleRefs[] {
  const results: ModuleRefs[] = [];

  // 收集所有 .ts 文件
  const tsFiles: string[] = [];
  function collectFiles(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDE_DIRS.includes(entry.name)) {
            collectFiles(full);
          }
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          tsFiles.push(full);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }
  collectFiles(root);

  // 为每个候选模块查找引用
  for (const group of CANDIDATES) {
    for (const modName of group.modules) {
      const refs: ModuleRefs = {
        moduleName: modName,
        group: group.group,
        reason: group.reason,
        internalRefs: [],
        externalRefs: [],
        barrelExports: [],
      };

      for (const file of tsFiles) {
        const relativePath = path.relative(root, file).replace(/\\/g, '/');
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // 查找 import/export 引用模式
          // 1. import { X } from './path/ModuleName'
          // 2. export { X } from './path/ModuleName'
          // 3. export * from './path/ModuleName'
          // 4. import type { X } from './path/ModuleName'
          const refPattern = new RegExp(`['"].*\\/?${modName}(\\.js)?['"]`);
          if (refPattern.test(line)) {
            const ref: Reference = {
              file: relativePath,
              line: lineNum,
              lineContent: line.trim().substring(0, 120),
            };

            // 分类
            if (relativePath.startsWith('packages/core/src/') && relativePath.endsWith('/index.ts')) {
              refs.barrelExports.push(ref);
            } else if (relativePath.startsWith('packages/core/')) {
              refs.internalRefs.push(ref);
            } else {
              refs.externalRefs.push(ref);
            }
          }
        }
      }

      results.push(refs);
    }
  }

  return results;
}

// ── 报告 ──

function generateReport(results: ModuleRefs[]): string {
  const lines: string[] = [];
  lines.push('# MorPex Phase 3 模块引用扫描报告');
  lines.push(`生成时间: ${new Date().toISOString()}\n`);

  // 按组分
  const byGroup = new Map<string, ModuleRefs[]>();
  for (const r of results) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }

  let totalSafe = 0;
  let totalNeedUpdate = 0;
  let totalHeavilyUsed = 0;

  for (const [group, refs] of byGroup) {
    const reason = refs[0]?.reason ?? '(未知)';
    lines.push(`## ${group}`);
    lines.push(`裁剪原因: ${reason}\n`);

    lines.push('| 模块 | 内部引用 | 外部引用 | Barrel导出 | 结论 |');
    lines.push('|------|---------|---------|-----------|------|');

    for (const r of refs) {
      const total = r.internalRefs.length + r.externalRefs.length + r.barrelExports.length;
      let verdict: string;
      let isSafe = false;

      if (total === 0) {
        verdict = '✅ 零引用 — 安全归档';
        isSafe = true;
        totalSafe++;
      } else if (r.externalRefs.length === 0 && r.barrelExports.length <= 2) {
        verdict = '🟡 仅内部/barrel引用 — 需清理后归档';
        isSafe = false;
        totalNeedUpdate++;
      } else {
        verdict = `🔴 有外部引用 (${r.externalRefs.length}处) — 需评估`;
        isSafe = false;
        totalHeavilyUsed++;
      }

      lines.push(`| ${r.moduleName} | ${r.internalRefs.length} | ${r.externalRefs.length} | ${r.barrelExports.length} | ${verdict} |`);
    }
    lines.push('');

    // 详细引用列表
    for (const r of refs) {
      if (r.internalRefs.length + r.externalRefs.length + r.barrelExports.length > 0) {
        lines.push(`### ${r.moduleName} 引用详情`);
        if (r.barrelExports.length > 0) {
          lines.push('\n**Barrel 导出:**');
          for (const ref of r.barrelExports) {
            lines.push(`  - ${ref.file}:${ref.line} — \`${ref.lineContent}\``);
          }
        }
        if (r.internalRefs.length > 0) {
          lines.push('\n**内部引用:**');
          for (const ref of r.internalRefs.slice(0, 10)) {
            lines.push(`  - ${ref.file}:${ref.line} — \`${ref.lineContent}\``);
          }
          if (r.internalRefs.length > 10) {
            lines.push(`  - ... 还有 ${r.internalRefs.length - 10} 处`);
          }
        }
        if (r.externalRefs.length > 0) {
          lines.push('\n**外部引用:**');
          for (const ref of r.externalRefs) {
            lines.push(`  - ${ref.file}:${ref.line} — \`${ref.lineContent}\``);
          }
        }
        lines.push('');
      }
    }
  }

  // 汇总
  lines.push('---');
  lines.push('## 汇总');
  lines.push('');
  lines.push(`| 分类 | 数量 |`);
  lines.push(`|------|------|`);
  lines.push(`| ✅ 零引用 — 安全归档 | ${totalSafe} |`);
  lines.push(`| 🟡 仅内部/barrel引用 — 需清理后归档 | ${totalNeedUpdate} |`);
  lines.push(`| 🔴 有外部引用 — 需评估 | ${totalHeavilyUsed} |`);
  lines.push(`| **合计** | **${totalSafe + totalNeedUpdate + totalHeavilyUsed}** |`);

  return lines.join('\n');
}

// ── 主函数 ──

function main() {
  console.log('🔍 开始扫描模块引用...\n');

  const results = scanReferences(ROOT);

  // 生成 Markdown 报告
  const report = generateReport(results);

  // 输出到控制台
  console.log(report);

  // 输出到 JSON
  const jsonReport = results.map(r => ({
    moduleName: r.moduleName,
    group: r.group,
    reason: r.reason,
    internalRefs: r.internalRefs.map(x => `${x.file}:${x.line}`),
    externalRefs: r.externalRefs.map(x => `${x.file}:${x.line}`),
    barrelExports: r.barrelExports.map(x => `${x.file}:${x.line}`),
    totalRefs: r.internalRefs.length + r.externalRefs.length + r.barrelExports.length,
    safeToArchive: r.internalRefs.length + r.externalRefs.length + r.barrelExports.length === 0,
  }));

  const jsonPath = path.join(ROOT, 'data', 'module-cleanup-report.json');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), modules: jsonReport }, null, 2));

  console.log(`\n📄 详细报告已保存到: ${jsonPath}`);
  console.log('✅ 扫描完成');
}

main();
