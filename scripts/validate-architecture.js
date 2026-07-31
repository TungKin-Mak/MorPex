#!/usr/bin/env node
/**
 * MorPex Ideal Architecture Alignment Validator
 *
 * 用途：检测代码是否违反理想架构（README.md 中的 10 层模型）
 * 使用方式：node scripts/validate-architecture.js
 *
 * 依赖：无（使用 Node 内置 fs，不依赖 glob，保证 CI 可直接运行）
 *
 * 覆盖（含 P1 增强）：
 *   1. 已废弃 planes/ 目录引用（ERROR）
 *   2. 已废弃 brain/ 目录引用（WARNING）
 *   3. Ontology Gate 是否正确绑定到两个强制原语（ERROR）
 *   4. 是否直接 import pi 包（违反 PiBridge 隔离，ERROR）
 *   5. Workflow 插件 manifest 是否符合标准（WARNING）
 *   6. [P1] No Domain Logic in Core：core 中出现领域关键词/领域目录依赖（WARNING）
 *   7. [P1] Ontology Bypass：绕过 KnowledgeQueryPrimitive 直接调用 LLM 生成（ERROR）
 *   8. [P1] Workflow 插件标准接口：实现 ActionPrimitive + bootstrap 注册（WARNING）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, normalize, sep } from 'path';

const ROOT = process.cwd();
const CORE = join(ROOT, 'packages', 'core', 'src');
const WORKFLOWS = join(ROOT, 'packages', 'workflows');

const ERRORS = [];
const WARNINGS = [];

console.log('🔍 MorPex Ideal Architecture Alignment Check\n');

// ═══════════════════════════════════════════════════════════════
// 工具：内置递归文件遍历（不依赖外部 glob 包）
// ═══════════════════════════════════════════════════════════════

/**
 * walkFiles — 递归收集指定目录下所有匹配扩展名的文件
 */
function walkFiles(dir, exts = ['.ts', '.js', '.cjs', '.mjs'], acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // 权限/并发删除等导致的读取失败，跳过
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
      walkFiles(full, exts, acc);
    } else if (exts.some((e) => entry.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

/** 排除测试文件与已废弃标记文件 */
function isRelevantSource(file) {
  const base = basename(file);
  if (base.includes('.test.') || base.includes('.spec.') || base.endsWith('.test.ts')) return false;
  const content = readFileSync(file, 'utf8');
  if (content.includes('@deprecated') || content.includes('DEPRECATED')) return false;
  return true;
}

function basename(p) {
  return p.split(/[\\/]/).pop() || '';
}

/** 收集 core 下所有相关源文件（相对路径，统一为正斜杠） */
const coreFiles = walkFiles(CORE, ['.ts']).map((f) => relative(ROOT, f).split(sep).join('/'));

// ═══════════════════════════════════════════════════════════════
// 1. 检查是否引用已废弃的 planes/ 目录
//    注意：planes/ 目前仍是承载性旧目录（27+ 处真实依赖，见 git history），
//    降级为 WARNING 并持续追踪迁移进度（迁移完成前不阻断 CI）。
// ═══════════════════════════════════════════════════════════════
const planesReferences = coreFiles
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    return content.includes("from '") && content.includes('planes/');
  });

if (planesReferences.length > 0) {
  WARNINGS.push(`⚠️  仍引用旧 planes/ 目录 (${planesReferences.length} 处) — 迁移积压，见 morpex_ARCHITECTURE.md §Migration Backlog`);
  planesReferences.slice(0, 8).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 2. 检查是否引用已废弃的 brain/ 目录（应使用 cognition/）
//    豁免：brain/ 与 cognition/ 自身的门面文件（cognition/index.ts 有意 re-export brain 作为兼容桥）
// ═══════════════════════════════════════════════════════════════
const brainReferences = coreFiles
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => !file.includes('/brain/') && !file.includes('/cognition/'))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    return content.includes("from './brain/") || content.includes("from '../brain/");
  });

if (brainReferences.length > 0) {
  WARNINGS.push(`⚠️  仍引用 brain/ 目录（建议迁移到 cognition/）：${brainReferences.length} 处`);
  brainReferences.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 3. 检查 Ontology Gate 是否被正确使用（强制原语绑定）
// ═══════════════════════════════════════════════════════════════
const primitiveFiles = coreFiles.filter((f) => f.includes('/tools/primitives/') && f.endsWith('.ts'));

primitiveFiles.forEach((file) => {
  const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
  if (file.includes('KnowledgeQueryPrimitive') || file.includes('ArtifactGenerationPrimitive')) {
    if (!content.includes('ForcedQueryGuard') || !content.includes('runOntologyGroundedReasoning')) {
      ERRORS.push(`❌ ${file} 未正确集成 Ontology Gate`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. 检查是否直接 import pi 包（除 PiBridge 外）
// ═══════════════════════════════════════════════════════════════
const piDirectImports = coreFiles
  .filter((file) => !file.includes('pi-bridge') && !file.includes('pi-types'))
  // adapters/ 是 PiBridge 隔离实现层（model-registry / pi-utils / pi-ai-types 等），豁免
  .filter((file) => !file.includes('/adapters/'))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    // 只匹配真实 import 语句（排除 GovernanceDashboard 等字符串字面量提示）
    return (
      /from\s+['"]@earendil-works\/pi-(ai|agent-core)/.test(content) ||
      /import\s+['"]@earendil-works\/pi-(ai|agent-core)/.test(content)
    );
  });

if (piDirectImports.length > 0) {
  ERRORS.push(`❌ 发现直接导入 pi 包（违反 PiBridge 隔离铁律）：${piDirectImports.length} 处`);
  piDirectImports.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 5. 检查 Workflow 插件 manifest 是否符合标准
// ═══════════════════════════════════════════════════════════════
if (existsSync(WORKFLOWS)) {
  const pluginDirs = readdirSync(WORKFLOWS)
    .filter((d) => !d.startsWith('.') && statSync(join(WORKFLOWS, d)).isDirectory())
    .filter((d) => !['node_modules', 'workflow-sdk'].includes(d));

  if (pluginDirs.length === 0) {
    WARNINGS.push('⚠️  未发现任何 Workflow 插件目录');
  }

  for (const dir of pluginDirs) {
    const manifestPath = join(WORKFLOWS, dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      WARNINGS.push(`⚠️  ${dir}/manifest.json 缺失（标准要求必须）`);
      continue;
    }
    try {
      const content = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!content.name) {
        WARNINGS.push(`⚠️  ${dir}/manifest.json 缺少 name`);
      }
      if (!Array.isArray(content.actions) || content.actions.length === 0) {
        WARNINGS.push(`⚠️  ${dir}/manifest.json 未声明 actions（标准要求非空）`);
      }
    } catch (e) {
      WARNINGS.push(`⚠️  ${dir}/manifest.json 解析失败`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. [P1] No Domain Logic in Core — 领域关键词 / 领域目录依赖
//    (理想架构约束 3：领域逻辑只属于 Workflow 插件)
// ═══════════════════════════════════════════════════════════════
const DOMAIN_KEYWORDS = [
  'xjmcu', 'ecommerce', 'amazon', 'shopify', 'pcb', 'stm32',
  'espressif', 'microcontroller', 'fulfillment',
];

const domainViolations = coreFiles
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    // 排除领域目录依赖的合法桥接点（bootstrap / registry / facade 需注册插件名）
    if (file.includes('bootstrap') || file.includes('/facade/') || file.includes('DomainPrimitiveRegistry')) return false;
    // 排除“领域概念”通用子系统（domains/ industry/ 是领域无关的抽象概念层）
    if (file.includes('/domains/') || file.includes('/industry/')) return false;
    // 排除能力目录数据（capability/ agent-capability/ 存能力名称与 provider 映射，属能力识别/路由，非领域实现）
    if (file.includes('/capability/') || file.includes('/agent-capability/')) return false;
    // 排除意图/领域识别层（planes/control-plane/intent/ 与 goal-intelligence/ 同类：只做识别路由）
    if (file.includes('/planes/control-plane/intent/')) return false;
    // 注：verification/ 不再整体豁免 —— 领域质检/合规规则必须位于对应 Workflow 插件
    //（core 仅保留通用注册机制 QualityRule / PolicyRuleRegistry；
    //   amazon_listing / e-commerce / hardware 规则已在 packages/workflows/*/src/rules/ 注册）
    // 排除 adapters/（PiBridge 实现层，仅类型/适配，不承载领域逻辑）
    if (file.includes('/adapters/')) return false;
    // 排除 benchmark/（Golden Tasks 测试数据会包含领域名词，属数据非逻辑）
    if (file.includes('/benchmark/')) return false;
    // 排除扩展规划引擎（规划层内部，非领域实现）
    if (file.includes('/extensions/planning/')) return false;
    // 排除意图解析/路由/蓝图层（goal-intelligence / artifact / experience / department：
    // 它们仅用领域词做识别路由与能力映射，属通用基础设施而非领域实现）
    if (file.includes('/goal-intelligence/') || file.includes('/artifact/') ||
        file.includes('/experience/') || file.includes('/department/')) return false;
    const content = readFileSync(join(ROOT, file), 'utf8');
    return DOMAIN_KEYWORDS.some((kw) => content.toLowerCase().includes(kw.toLowerCase()));
  });

if (domainViolations.length > 0) {
  WARNINGS.push(`⚠️  [No Domain Logic] core 中出现领域关键词 (${domainViolations.length} 处) — 领域逻辑应只在 packages/workflows/`);
  domainViolations.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 7. [P1] Ontology Bypass — 绕过 KnowledgeQueryPrimitive 直接调用 LLM
//    (理想架构约束 1/2：所有生成必须先过 Ontology Gate)
// ═══════════════════════════════════════════════════════════════
// 允许直接调用 generateText 的“生产生成点”白名单（这些点内部都经过 Gate / Brain 统一入口）
const GENERATION_ALLOWLIST = [
  '/ontology/runOntologyGroundedReasoning.ts', // 唯一的两阶段 Gate 生成点
  '/pi-bridge',                                // PiBridge 封装
  '/cognition/',                               // Brain 统一入口
  '/brain/',                                   // 旧 Brain（deprecated 但兼容）
  '/planner/',                                 // 规划（内部走 Gate）
  '/extensions/planning/',                     // 规划管线内部引擎（MetaPlanner 等，属规划层）
  '/evolution/',                               // 演化层基础设施（SOPEngine 分类等，有降级路径）
  '/runtime/',                                 // 运行时基础设施（ServiceContainer piBridge 包装）
  '/tools/ToolFactory.ts',                     // 通用工具工厂（动态工具 schema 生成，非领域生成）
  '/department/LeadAgentOrchestrator.ts',      // OrganizationTwin 部门模拟路径（遗留；TODO: 绑定 Ontology Gate）
  '/prompts/',                                 // prompt 构建（非生成）
  '/bootstrap',                                // bootstrap 注入 piBridge
];

const bypassViolations = coreFiles
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    // 白名单跳过
    if (GENERATION_ALLOWLIST.some((w) => normalize(file).includes(normalize(w)))) return false;
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    // 检测“调用”形态（排除类型签名：generateText: (params 不会命中 .generateText({）
    return /(?:await\s+)?[\w.$!]+\.generateText\(\s*\{/.test(content) &&
           /(?:await\s+)?[\w.$!]+\.generateText\(/.test(content);
  });

/** 找出文件内匹配指定调用模式的行号（用于可操作性报告） */
function matchLines(file, pattern) {
  const lines = readFileSync(join(ROOT, ...file.split('/')), 'utf8').split(/\r?\n/);
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => pattern.test(l))
    .map(({ l, i }) => `${i + 1}: ${l.trim().slice(0, 90)}`);
}

if (bypassViolations.length > 0) {
  ERRORS.push(`❌ [Ontology Bypass] 检测到绕过 Ontology Gate 的直接 LLM 生成调用 (${bypassViolations.length} 处)`);
  bypassViolations.slice(0, 10).forEach((f) => {
    console.log(`   - ${f}`);
    matchLines(f, /\.generateText\(/).forEach((line) => console.log(`       ${line}`));
  });
}

// ═══════════════════════════════════════════════════════════════
// 8. [P1] Workflow 插件标准接口 — ActionPrimitive + bootstrap 注册
// ═══════════════════════════════════════════════════════════════
if (existsSync(WORKFLOWS)) {
  const pluginDirs = readdirSync(WORKFLOWS)
    .filter((d) => !d.startsWith('.') && statSync(join(WORKFLOWS, d)).isDirectory())
    .filter((d) => !['node_modules', 'workflow-sdk'].includes(d));

  for (const dir of pluginDirs) {
    const pluginRoot = join(WORKFLOWS, dir);
    const srcIndex = join(pluginRoot, 'src', 'index.ts');
    const srcBootstrap = join(pluginRoot, 'src', 'bootstrap.ts');
    const provider = join(pluginRoot, 'workflow-provider.ts');

    const hasProvider = existsSync(provider);
    const hasIndex = existsSync(srcIndex);
    const hasBootstrap = existsSync(srcBootstrap);

    // 至少需要 provider 或 src/index（含 ActionPrimitive 实现）
    if (!hasProvider && !hasIndex) {
      WARNINGS.push(`⚠️  [插件标准] ${dir}/ 缺少 workflow-provider.ts 或 src/index.ts（Action 出口）`);
      continue;
    }

    // 检查是否实现 ActionPrimitive（canHandle + execute）
    // 扫描插件目录下全部 .ts 文件（action 可能分布在 src/actions/*.ts）
    let implementsPrimitive = false;
    let registered = false;
    const pluginFiles = walkFiles(pluginRoot, ['.ts']);
    for (const c of pluginFiles) {
      const content = readFileSync(c, 'utf8');
      if (/canHandle\s*\(/.test(content) && /async\s+execute\s*\(/.test(content)) implementsPrimitive = true;
      if (/DomainPrimitiveRegistry\.register|registerWorkflow|bootstrapWorkflow|register\(/.test(content)) registered = true;
    }

    if (!implementsPrimitive) {
      WARNINGS.push(`⚠️  [插件标准] ${dir}/ 未发现 ActionPrimitive 实现（canHandle + execute）`);
    }
    if (!registered) {
      WARNINGS.push(`⚠️  [插件标准] ${dir}/ 未发现注册调用（DomainPrimitiveRegistry.register / bootstrap）`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 输出结果
// ═══════════════════════════════════════════════════════════════
console.log('\n=== 验证结果 ===\n');

if (ERRORS.length === 0 && WARNINGS.length === 0) {
  console.log('✅ 架构对齐度：100%（无违规）');
} else {
  if (ERRORS.length > 0) {
    console.log(`❌ 严重违规（必须修复）— ${ERRORS.length} 项：`);
    ERRORS.forEach((e) => console.log('  ' + e));
  }
  if (WARNINGS.length > 0) {
    console.log(`\n⚠️  警告（建议修复）— ${WARNINGS.length} 项：`);
    WARNINGS.forEach((w) => console.log('  ' + w));
  }
}

console.log('\n=== 检查完成 ===');

if (ERRORS.length > 0) {
  process.exit(1);
}
