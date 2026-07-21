/**
 * Architecture Audit Runner v3
 */
import { ArchitectureAuditor } from '../packages/core/src/auditor/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  console.log('🔍 正在扫描 MorPex 架构 (v3 Auditor)...\n');

  const auditor = new ArchitectureAuditor();
  const report = await auditor.runFullAudit();

  // Console output
  const formatted = auditor.formatReport(report);
  console.log(formatted);

  // Save report
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const reportPath = path.join(dataDir, 'architecture-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 报告已保存至: ${reportPath}\n`);

  if (report.architectureScore < 50) {
    console.log(`⚠️  架构得分 ${report.architectureScore}/100`);
    process.exit(1);
  } else {
    console.log(`✅ 架构得分 ${report.architectureScore}/100`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('❌ 审计失败:', err);
  process.exit(2);
});
