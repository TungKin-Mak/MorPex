#!/usr/bin/env node
/**
 * MorPex v11 Workflow CLI
 *
 * 命令行入口：
 *   npx tsx scripts/workflow-cli.ts create <name> [dir]
 *   npx tsx scripts/workflow-cli.ts install <path>
 *   npx tsx scripts/workflow-cli.ts run <workflow-id> [--input='...']
 *   npx tsx scripts/workflow-cli.ts list
 *   npx tsx scripts/workflow-cli.ts optimize <workflow-id>
 *   npx tsx scripts/workflow-cli.ts versions <workflow-id>
 *   npx tsx scripts/workflow-cli.ts rollback <workflow-id> <version>
 *   npx tsx scripts/workflow-cli.ts status <workflow-id>
 *   npx tsx scripts/workflow-cli.ts metrics <workflow-id>
 *
 * @packageDocumentation
 */

import { createWorkflowRuntime } from '../packages/workflow-sdk/src/bootstrap.js';

// ═══════════════════════════════════════════════════════════════════
// 持久化存储（跨 CLI 调用保持状态）
// ═══════════════════════════════════════════════════════════════════

const STATE_FILE = 'data/workflow-state.json';

interface StateEntry {
  id: string;
  name: string;
  version: string;
  dirPath: string;
  installedAt: number;
}

interface WorkflowState {
  workflows: StateEntry[];
}

async function loadState(): Promise<WorkflowState> {
  const fs = await import('node:fs/promises');
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { workflows: [] };
  }
}

async function saveState(state: WorkflowState): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════
// 帮助
// ═══════════════════════════════════════════════════════════════════

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════╗
║   MorPex v11 Workflow CLI                   ║
╚══════════════════════════════════════════════╝

用法:
  npx tsx scripts/workflow-cli.ts <command> [options]

命令:
  create <name> [dir]        创建工作流模板到目录（默认 ./<name>）
  install <path>             安装工作流包（目录路径）
  run <workflow-id> [input]  执行工作流（input 可选 JSON 字符串）
  list                       列出所有已安装工作流
  optimize <workflow-id>     触发进化引擎优化
  versions <workflow-id>     列出所有版本
  rollback <workflow-id> <v> 回滚到指定版本
  status <workflow-id>       查看工作流状态
  metrics <workflow-id>      查看工作流指标
  help                       显示帮助

示例:
  npx tsx scripts/workflow-cli.ts create hello-world
  npx tsx scripts/workflow-cli.ts install ./hello-world
  npx tsx scripts/workflow-cli.ts run wf-v11_hello-world_1_0_0 --input='{"msg":"Hi"}'
  npx tsx scripts/workflow-cli.ts list
  `);
}

// ═══════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════

function parseArgs(): { command: string; args: string[]; flags: Record<string, string> } {
  const [, , ...rawArgs] = process.argv;
  if (rawArgs.length === 0) {
    return { command: 'help', args: [], flags: {} };
  }

  const command = rawArgs[0];
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, args: positional, flags };
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

// ═══════════════════════════════════════════════════════════════════
// 命令实现
// ═══════════════════════════════════════════════════════════════════

async function cmdCreate(name: string, dir?: string): Promise<void> {
  const targetDir = dir || `./${name}`;

  // 写入 manifest.json
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  await fs.mkdir(targetDir, { recursive: true });

  const manifest = {
    name,
    version: '1.0.0',
    description: `Workflow ${name}`,
    category: 'general',
    requiredCapabilities: [],
    metrics: ['success_rate', 'cost', 'duration'],
  };

  const yamlContent = `name: ${name}
version: 1.0.0
category: general

trigger:
  type: manual

steps:
  - id: step1
    name: First Step
    capability: general
    input:
      message: "Hello from ${name}"
`;

  await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.writeFile(path.join(targetDir, 'workflow.yaml'), yamlContent, 'utf-8');

  console.log(`✅ 工作流 "${name}" 已创建到 ${targetDir}`);
  console.log(`   ├── manifest.json`);
  console.log(`   └── workflow.yaml`);
  console.log(`\n下一步: npx tsx scripts/workflow-cli.ts install ${targetDir}`);
}

async function cmdInstall(pkgPath: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  const resolvedPath = (await import('node:path')).resolve(pkgPath);

  console.log(`📦 正在安装工作流: ${resolvedPath}`);
  const installed = await sdk.install(resolvedPath);
  console.log(`✅ 安装成功: ${installed.id}`);
  console.log(`   名称: ${installed.package.manifest.name}`);
  console.log(`   版本: ${installed.package.manifest.version}`);
  console.log(`   状态: ${installed.status}`);

  // 持久化状态
  const state = await loadState();
  const existing = state.workflows.findIndex(w => w.id === installed.id);
  const entry: StateEntry = {
    id: installed.id,
    name: installed.package.manifest.name,
    version: installed.package.manifest.version,
    dirPath: resolvedPath,
    installedAt: Date.now(),
  };
  if (existing >= 0) {
    state.workflows[existing] = entry;
  } else {
    state.workflows.push(entry);
  }
  await saveState(state);
  console.log(`   💾 已持久化到 ${STATE_FILE}`);
}

async function cmdRun(workflowIdOrPath: string, inputFlag?: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();

  // 如果参数是目录路径（包含 / 或 \），自动执行 install + run
  let resolvedId = workflowIdOrPath;
  const isPath = workflowIdOrPath.includes('/') || workflowIdOrPath.includes('\\');

  if (isPath) {
    const resolvedPath = (await import('node:path')).resolve(workflowIdOrPath);
    console.log(`📦 正在安装: ${resolvedPath}`);
    const installed = await sdk.install(resolvedPath);
    resolvedId = installed.id;
    console.log(`✅ 安装成功: ${resolvedId}\n`);

    // 持久化
    const state = await loadState();
    const existing = state.workflows.findIndex(w => w.id === installed.id);
    const entry: StateEntry = {
      id: installed.id,
      name: installed.package.manifest.name,
      version: installed.package.manifest.version,
      dirPath: resolvedPath,
      installedAt: Date.now(),
    };
    if (existing >= 0) state.workflows[existing] = entry;
    else state.workflows.push(entry);
    await saveState(state);
  } else {
    // 通过 ID 执行：从持久化状态恢复安装
    const state = await loadState();
    const saved = state.workflows.find(w => w.id === workflowIdOrPath);
    if (saved) {
      console.log(`📦 从持久化状态恢复: ${saved.name}`);
      await sdk.install(saved.dirPath);
    } else {
      console.error(`❌ 工作流未找到: ${workflowIdOrPath}`);
      console.log('\n已安装的工作流:');
      if (state.workflows.length === 0) {
        console.log('  (无)');
      }
      for (const w of state.workflows) {
        console.log(`  - ${w.id}`);
      }
      process.exit(1);
    }
  }

  const inputStr = inputFlag ?? (await readStdin());

  let input: unknown = {};
  if (inputStr) {
    try {
      input = JSON.parse(inputStr);
    } catch {
      input = { message: inputStr };
    }
  }

  console.log(`🚀 正在执行工作流: ${resolvedId}`);
  console.log(`   输入: ${JSON.stringify(input)}`);

  const result = await sdk.execute(resolvedId, input);

  console.log(`\n📊 执行结果:`);
  console.log(`   状态: ${result.status}`);
  console.log(`   质量评分: ${JSON.stringify(result.qualityScore)}`);

  if (result.error) {
    console.log(`   ❌ 错误: ${result.error}`);
  }

  if (result.output) {
    console.log(`   输出: ${JSON.stringify(result.output, null, 2)}`);
  }
  if (result.metrics) {
    console.log(`   指标: ${JSON.stringify(result.metrics)}`);
  }
}

async function cmdList(): Promise<void> {
  // 先从持久化状态加载
  const state = await loadState();
  
  if (state.workflows.length === 0) {
    console.log('📭 没有已安装的工作流');
    console.log('\n创建并安装一个:');
    console.log('  npm run wf:create -- hello-world');
    console.log('  npm run wf:install -- ./hello-world');
    return;
  }

  console.log(`📋 已安装的工作流 (${state.workflows.length}):`);
  console.log('');
  for (const wf of state.workflows) {
    const ago = Date.now() - wf.installedAt;
    const agoStr = ago < 60000 ? `${Math.round(ago / 1000)}s ago`
      : ago < 3600000 ? `${Math.round(ago / 60000)}min ago`
      : `${Math.round(ago / 3600000)}h ago`;
    console.log(`  📦 ${wf.id}`);
    console.log(`     名称: ${wf.name}`);
    console.log(`     版本: ${wf.version}`);
    console.log(`     路径: ${wf.dirPath}`);
    console.log(`     安装: ${agoStr}`);
    console.log('');
  }
}

async function cmdOptimize(workflowId: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  console.log(`🔧 正在优化工作流: ${workflowId}`);
  const proposal = await sdk.optimize(workflowId);
  console.log(`\n📋 优化建议:`);
  console.log(`   当前版本: ${proposal.currentVersion}`);
  console.log(`   建议版本: ${proposal.proposedVersion}`);
  console.log(`   风险等级: ${proposal.risk}`);
  console.log(`   置信度: ${(proposal.confidence * 100).toFixed(1)}%`);
  if (proposal.changes.length > 0) {
    const changeStr = proposal.changes.map(c => c.type + ': ' + c.description).join('\n          ');
    console.log('   变更: ' + changeStr);
  }
}

async function cmdVersions(workflowId: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  console.log(`📋 版本历史: ${workflowId}`);
  const versions = await sdk.listVersions(workflowId);
  if (versions.length === 0) {
    console.log('   无版本信息');
    return;
  }
  for (const v of versions) {
    console.log(`   ${v.version} — ${v.changeDescription} (${new Date(v.createdAt).toISOString()})`);
  }
}

async function cmdRollback(workflowId: string, version: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  console.log(`⏪ 正在回滚 ${workflowId} 到 ${version}`);
  const success = await sdk.rollback(workflowId, version);
  if (success) {
    console.log(`✅ 回滚成功`);
  } else {
    console.log(`❌ 回滚失败`);
  }
}

async function cmdStatus(workflowId: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  const status = await sdk.getStatus(workflowId);
  console.log(`📊 工作流状态: ${workflowId}`);
  for (const [key, value] of Object.entries(status)) {
    console.log(`   ${key}: ${JSON.stringify(value)}`);
  }
}

async function cmdMetrics(workflowId: string): Promise<void> {
  const { sdk } = await createWorkflowRuntime();
  const metrics = await sdk.getMetrics(workflowId);
  console.log(`📈 工作流指标: ${workflowId}`);
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') {
      console.log(`   ${key}: ${value.toFixed(4)}`);
    } else {
      console.log(`   ${key}: ${JSON.stringify(value)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs();

  switch (command) {
    case 'create':
      if (!args[0]) {
        console.error('❌ 请指定工作流名称');
        console.log('用法: npx tsx scripts/workflow-cli.ts create <name> [dir]');
        process.exit(1);
      }
      await cmdCreate(args[0], args[1]);
      break;

    case 'install':
      if (!args[0]) {
        console.error('❌ 请指定工作流路径');
        console.log('用法: npx tsx scripts/workflow-cli.ts install <path>');
        process.exit(1);
      }
      await cmdInstall(args[0]);
      break;

    case 'run':
      if (!args[0]) {
        console.error('❌ 请指定工作流 ID 或目录路径');
        console.log('用法: npx tsx scripts/workflow-cli.ts run <workflow-id|dir> [--input=...]');
        console.log('  例: npx tsx scripts/workflow-cli.ts run ./test-hello-world --input=\'{"msg":"hi"}\'');
        process.exit(1);
      }
      await cmdRun(args[0], flags.input);
      break;

    case 'list':
      await cmdList();
      break;

    case 'optimize':
      if (!args[0]) {
        console.error('❌ 请指定工作流 ID');
        process.exit(1);
      }
      await cmdOptimize(args[0]);
      break;

    case 'versions':
      if (!args[0]) {
        console.error('❌ 请指定工作流 ID');
        process.exit(1);
      }
      await cmdVersions(args[0]);
      break;

    case 'rollback':
      if (!args[0] || !args[1]) {
        console.error('❌ 请指定工作流 ID 和版本号');
        process.exit(1);
      }
      await cmdRollback(args[0], args[1]);
      break;

    case 'status':
      if (!args[0]) {
        console.error('❌ 请指定工作流 ID');
        process.exit(1);
      }
      await cmdStatus(args[0]);
      break;

    case 'metrics':
      if (!args[0]) {
        console.error('❌ 请指定工作流 ID');
        process.exit(1);
      }
      await cmdMetrics(args[0]);
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error('❌ CLI 执行失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
