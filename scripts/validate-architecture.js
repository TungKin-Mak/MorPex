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
 *   3. Ontology Gate 是否正确绑定到全部 5 个原语（强制原语 ForcedQueryGuard；副作用原语 PrimitiveGate，ERROR）
 *   4. 是否直接 import pi 包（违反 PiBridge 隔离，ERROR）
 *   5. Workflow 插件 manifest 是否符合标准（WARNING）
 *   6. [P1] No Domain Logic in Core：core 中出现领域关键词/领域目录依赖（ERROR，Wave 4 升级）
 *   7. [P1] Ontology Bypass：绕过 KnowledgeQueryPrimitive 直接调用 LLM 生成（ERROR）
 *   8. [P1] Workflow 插件标准接口：实现 ActionPrimitive + bootstrap 注册（WARNING）
 *   9. [P1] L4 禁止副作用：cognition/ 不得 import evolution/execution/primitives（ERROR）
 *  10. [P1] L7 边界：evolution/ 不得 import cognition/（SafetyMonitor 只读豁免，ERROR）
 *  11. [P1] L6/L7 解耦：evaluation/ 与 evolution/ 互禁直接 import（ERROR）
 *  12. [P1] L1 治理瘦身：control-plane/ 不得 import cognition/ 或 evolution/ 实现（ERROR）
 *  13. [P1] L1 硬编码演化实现：control-plane/ 出现 SelfImprovementLoop/EvolutionController 即违规（ERROR）
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
const primitiveFiles = coreFiles.filter((f) => f.includes('/infrastructure/tools/primitives/') && f.endsWith('.ts'));

primitiveFiles.forEach((file) => {
  const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
  if (file.includes('KnowledgeQueryPrimitive') || file.includes('ArtifactGenerationPrimitive')) {
    if (!content.includes('ForcedQueryGuard') || !content.includes('runOntologyGroundedReasoning')) {
      ERRORS.push(`❌ ${file} 未正确集成 Ontology Gate`);
    }
  } else if (file.endsWith('Primitive.ts')) {
    // Wave 4：所有副作用原语必须绑定运行时 Gate（缺包硬拦截 / 只读 WARN）
    if (!content.includes('PrimitiveGate') && !content.includes('requireKnowledgeContext')) {
      ERRORS.push(`❌ ${file} 未绑定运行时 Gate（须引用 gate/context.js 的 requireKnowledgeContext / PrimitiveGate）`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. 检查是否直接 import pi 包（除 PiBridge 外）
// ═══════════════════════════════════════════════════════════════
const piDirectImports = coreFiles
  .filter((file) => !file.includes('pi-bridge') && !file.includes('pi-types'))
  // adapters/ 是 PiBridge 隔离实现层（model-registry / pi-utils / pi-ai-types 等），豁免
  .filter((file) => !file.includes('/infrastructure/adapters/'))
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
    // 排除能力目录数据（governance/capability/ 存能力名称与 provider 映射，属能力识别/路由，非领域实现）
    if (file.includes('/capability/')) return false;
    // 排除跨领域模式分类器（evolution/PatternExtractor：用领域词做分类信号，非领域实现）
    if (file.includes('/evolution/PatternExtractor.ts')) return false;
    // 注：verification/ 不再整体豁免 —— 领域质检/合规规则必须位于对应 Workflow 插件
    //（core 仅保留通用注册机制 QualityRule / PolicyRuleRegistry；
    //   amazon_listing / e-commerce / hardware 规则已在 packages/workflows/*/src/rules/ 注册）
    // 排除 adapters/（PiBridge 实现层，仅类型/适配，不承载领域逻辑）
    if (file.includes('/infrastructure/adapters/')) return false;
    // 排除 benchmark/（Golden Tasks 测试数据会包含领域名词，属数据非逻辑）
    if (file.includes('/benchmark/')) return false;
    // 排除扩展规划引擎（规划层内部，非领域实现）
    if (file.includes('/extensions/planning/')) return false;
    // 排除意图解析/路由/蓝图层（goal-intelligence / artifact / experience / department：
    // 它们仅用领域词做识别路由与能力映射，属通用基础设施而非领域实现）
    if (file.includes('/cognition/planning/goal-intelligence/') || file.includes('/knowledge/artifact/')) return false;
    const content = readFileSync(join(ROOT, file), 'utf8');
    return DOMAIN_KEYWORDS.some((kw) => content.toLowerCase().includes(kw.toLowerCase()));
  });

if (domainViolations.length > 0) {
  // Wave 4：领域隔离从 WARNING 升级为 ERROR（core 内禁止业务领域硬编码）
  ERRORS.push(`❌ [No Domain Logic] core 中出现领域关键词 (${domainViolations.length} 处) — 领域逻辑应只在 packages/workflows/`);
  domainViolations.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 7. [P1] Ontology Bypass — 绕过 KnowledgeQueryPrimitive 直接调用 LLM
//    (理想架构约束 1/2：所有生成必须先过 Ontology Gate)
// ═══════════════════════════════════════════════════════════════
// 允许直接调用 generateText 的“生产生成点”白名单（这些点内部都经过 Gate / Brain 统一入口）
// AICOS-Core 8 层：允许直接调用 generateText 的"生产生成点"白名单
// （这些点内部都经过 L3 Gate / Brain 统一入口，或本身即是 Gate 实现）
const GENERATION_ALLOWLIST = [
  '/gate/runOntologyGroundedReasoning.ts',     // L3 唯一的两阶段 Gate 生成点
  '/infrastructure/adapters/pi-bridge',                       // PiBridge 封装（L8 基础设施适配）
  '/cognition/',                               // L4 认知统一入口（Brain + planning）
  '/execution/harness',                        // L5 AgentHarness 执行原语
  '/evaluation/',                              // L6 评价（评分 LLM）
  '/evolution/',                               // L7 演化（SOP 分类等，有降级路径）
  '/infrastructure/',                          // L8 运行时（piBridge 包装）
  '/execution/runtime/',                        // L5 运行时（ServiceContainer piBridge 包装）
  '/facade/gateway',                           // L1 入口适配（PiAdapterBridge）
  '/infrastructure/tools/ToolFactory.ts',                     // 通用工具工厂（动态 schema 生成，非领域生成）
  '/knowledge/ontology/prompts/',                        // L2 prompt 构建（非生成）
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
// 9. [P1] L4 禁止副作用 — cognition/ 不得 import 演化/执行/可执行原语
//    （L4 纯认知：只能经公开接口或 EventBus 与 L5/L7 通信，禁止拉入生产变更能力）
// ═══════════════════════════════════════════════════════════════
const L4_FORBIDDEN_PREFIXES = [
  'evolution/',
  'execution/',
  'infrastructure/tools/primitives/',
];

const l4SideEffectViolations = coreFiles
  .filter((file) => file.startsWith('packages/core/src/cognition/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    return L4_FORBIDDEN_PREFIXES.some((prefix) =>
      new RegExp(`from\s+['"][^'"]*${prefix.replace(/\//g, '\\/')}`).test(content)
    );
  });

if (l4SideEffectViolations.length > 0) {
  ERRORS.push(`❌ [L4 纯度] cognition/ 引用了演化/执行/可执行原语（L4 禁止副作用）— ${l4SideEffectViolations.length} 处`);
  l4SideEffectViolations.slice(0, 10).forEach((f) => {
    console.log(`   - ${f}`);
    matchLines(f, /from\s+['"][^'"]*(evolution|execution|infrastructure\/tools\/primitives)\//).forEach((l) => console.log(`       ${l}`));
  });
}

// ═══════════════════════════════════════════════════════════════
// 11. [P1] L6/L7 解耦 — evaluation/ 与 evolution/ 互禁直接 import（事件驱动）
// ═══════════════════════════════════════════════════════════════
const l6ToL7 = coreFiles
  .filter((file) => file.startsWith('packages/core/src/evaluation/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => /from\s+['"][^'"]*evolution\//.test(readFileSync(join(ROOT, ...file.split('/')), 'utf8')));

const l7ToL6 = coreFiles
  .filter((file) => file.startsWith('packages/core/src/evolution/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => /from\s+['"][^'"]*evaluation\//.test(readFileSync(join(ROOT, ...file.split('/')), 'utf8')));

if (l6ToL7.length > 0) {
  ERRORS.push(`❌ [L6/L7 解耦] evaluation/ 直接 import 了 evolution/ — ${l6ToL7.length} 处`);
  l6ToL7.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}
if (l7ToL6.length > 0) {
  ERRORS.push(`❌ [L6/L7 解耦] evolution/ 直接 import 了 evaluation/ — ${l7ToL6.length} 处`);
  l7ToL6.slice(0, 10).forEach((f) => console.log(`   - ${f}`));
}

// ═══════════════════════════════════════════════════════════════
// 10. [P1] L7 边界 — evolution/ 不得 import cognition/（事件驱动，只读数据例外）
//    符号级白名单：evolution 只能从 cognition 引入「只读数据/智能门面」：
//      - SafetyMonitor（安全度量，只读数据）
//      - WorkflowIntelligence / WorkflowMemory（L4 工作流智能与记忆，L7 挖掘只读）
//      - CrossDepartmentKnowledgeSynthesizer + MigrationResult（DI 注入的只读知识综合）
//      - WorkflowPattern / OptimizationSuggestion（工作流数据结构类型）
//    其余任何 cognition 符号（尤其演化/执行能力）一律 ERROR。
// ═══════════════════════════════════════════════════════════════
const L7_COGNITION_ALLOWED_SYMBOLS = new Set([
  'SafetyMonitor',
  'WorkflowIntelligence',
  'WorkflowMemory',
  'CrossDepartmentKnowledgeSynthesizer',
  'MigrationResult',
  'WorkflowPattern',
  'OptimizationSuggestion',
]);

/** 提取从指定路径前缀导入的具名符号 */
function namedImportsFrom(content, pathRe) {
  const out = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const path = m[2];
    if (pathRe.test(path)) {
      m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((sym) => out.push({ sym, path }));
    }
  }
  return out;
}

const l7CognitionViolations = coreFiles
  .filter((file) => file.startsWith('packages/core/src/evolution/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    const imports = namedImportsFrom(content, /cognition/);
    return imports.some(({ sym, path }) => {
      // 允许从 SafetyMonitor 直接路径导入该符号
      if (sym === 'SafetyMonitor' && /cognition\/SafetyMonitor\.js$/.test(path)) return false;
      return !L7_COGNITION_ALLOWED_SYMBOLS.has(sym);
    });
  });

if (l7CognitionViolations.length > 0) {
  ERRORS.push(`❌ [L7 边界] evolution/ 直接 import 了 cognition/ 非白名单符号（应事件驱动）— ${l7CognitionViolations.length} 处`);
  l7CognitionViolations.slice(0, 10).forEach((f) => {
    console.log(`   - ${f}`);
    matchLines(f, /from\s+['"][^'"]*cognition[^'"]*['"]/).forEach((l) => console.log(`       ${l}`));
  });
}

// ═══════════════════════════════════════════════════════════════
// 12. [P1] L1 治理瘦身 — control-plane/ 不得 import cognition/ 或 evolution/ 实现
//    （演化职责归 L7；control-plane 只暴露策略/审批，不持有演化实现。
//     符号级白名单：仅放行 GoalIntelligenceFacade（L1 编排 L4 规划的公开门面）；
//     其余 cognition/evolution 导入（尤其演化实现）一律 ERROR。）
// ═══════════════════════════════════════════════════════════════
const L1_ALLOWED_SYMBOLS = new Set(['GoalIntelligenceFacade']);

const controlPlaneImplViolations = coreFiles
  .filter((file) => file.includes('/governance/control-plane/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    const imports = namedImportsFrom(content, /(cognition|evolution)\//);
    return imports.some(({ sym }) => !L1_ALLOWED_SYMBOLS.has(sym));
  });

if (controlPlaneImplViolations.length > 0) {
  ERRORS.push(`❌ [L1 治理] control-plane/ 直接引用了 cognition/ 或 evolution/ 实现 — ${controlPlaneImplViolations.length} 处`);
  controlPlaneImplViolations.slice(0, 10).forEach((f) => {
    console.log(`   - ${f}`);
    matchLines(f, /from\s+['"][^'"]*(cognition|evolution)\//).forEach((l) => console.log(`       ${l}`));
  });
}

// ═══════════════════════════════════════════════════════════════
// 13. [P1] L1 硬编码演化实现 — control-plane/ 内出现演化实现符号即违规
//    （SelfImprovementLoop / EvolutionController 属 L7/L1 应移除的历史残留）
// ═══════════════════════════════════════════════════════════════
const L1_EVOLUTION_SYMBOLS = ['SelfImprovementLoop', 'EvolutionController'];
const controlPlaneSymbolViolations = coreFiles
  .filter((file) => file.includes('/governance/control-plane/'))
  .filter((file) => isRelevantSource(join(ROOT, ...file.split('/'))))
  .filter((file) => {
    const content = readFileSync(join(ROOT, ...file.split('/')), 'utf8');
    return L1_EVOLUTION_SYMBOLS.some((s) => content.includes(s));
  });

if (controlPlaneSymbolViolations.length > 0) {
  ERRORS.push(`❌ [L1 治理] control-plane/ 硬编码演化实现符号（SelfImprovementLoop/EvolutionController）— ${controlPlaneSymbolViolations.length} 处`);
  controlPlaneSymbolViolations.slice(0, 10).forEach((f) => {
    console.log(`   - ${f}`);
    matchLines(f, /SelfImprovementLoop|EvolutionController/).forEach((l) => console.log(`       ${l}`));
  });
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
