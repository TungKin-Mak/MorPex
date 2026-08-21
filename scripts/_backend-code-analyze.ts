/**
 * _backend-code-analyze — 后端代码函数/关系链分析器（只读，TS compiler API）
 *
 * 用途：扫描后端 .ts 文件，提取每文件「函数清单 + import 依赖 + 调用表达式」，
 * 输出 data/backend-code-map.json（结构化全集）+ 生成分层 markdown 概览文档。
 *
 * 用法：
 *   npx tsx scripts/_backend-code-analyze.ts               # 全量后端
 *   npx tsx scripts/_backend-code-analyze.ts --roots Gate Execution  # 指定层
 *   npx tsx scripts/_backend-code-analyze.ts --json-only   # 只出 JSON
 */
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

export interface FnInfo { name: string; kind: string; exported: boolean; isAsync: boolean; line: number }
export interface FileInfo {
  file: string;
  functions: FnInfo[];
  imports: Array<{ from: string; names: string[] }>;
  calls: Array<{ expr: string; line: number }>;
}

const KIND_LABEL: Record<number, string> = {
  [ts.SyntaxKind.FunctionDeclaration]: 'fn',
  [ts.SyntaxKind.MethodDeclaration]: 'method',
  [ts.SyntaxKind.GetAccessor]: 'getter',
  [ts.SyntaxKind.SetAccessor]: 'setter',
  [ts.SyntaxKind.Constructor]: 'ctor',
  [ts.SyntaxKind.ArrowFunction]: 'const-fn',
  [ts.SyntaxKind.FunctionExpression]: 'expr-fn',
};

function analyzeFile(abs: string): FileInfo {
  const src = fs.readFileSync(abs, 'utf8');
  const kind = abs.endsWith('.tsx') ? ts.ScriptKind.TSX
    : (abs.endsWith('.js') || abs.endsWith('.cjs') || abs.endsWith('.mjs')) ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, kind);
  const fn: FnInfo[] = [];
  const imports: Array<{ from: string; names: string[] }> = [];
  const calls: Array<{ expr: string; line: number }> = [];
  const isExported = (n: ts.Node): boolean =>
    (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
  const lineOf = (p: number): number => sf.getLineAndCharacterOfPosition(p).line + 1;

  function visit(n: ts.Node): void {
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n)) {
      const nm = (n as ts.NamedDeclaration).name ? (n as ts.NamedDeclaration).name!.getText(sf) : '(anon)';
      fn.push({ name: nm, kind: KIND_LABEL[n.kind] ?? '?', exported: isExported(n),
        isAsync: (n as ts.FunctionLikeDeclaration).modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false, line: lineOf(n.getStart()) });
    }
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isVariableDeclarationList(n.parent.parent)) {
      fn.push({ name: n.parent.name.getText(sf), kind: 'const-fn', exported: isExported(n.parent),
        isAsync: n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false, line: lineOf(n.getStart()) });
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const names: string[] = []; const cl = n.importClause;
      if (cl?.name) names.push(cl.name.text);
      if (cl?.namedBindings) {
        if (ts.isNamedImports(cl.namedBindings)) cl.namedBindings.elements.forEach(e => names.push(e.name.text));
        else names.push('*');
      }
      imports.push({ from: n.moduleSpecifier.text, names });
    }
    if (ts.isCallExpression(n)) {
      const e = n.expression.getText(sf);
      if (e && e.length < 60 && !e.includes('(')) calls.push({ expr: e, line: lineOf(n.getStart()) });
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return { file: abs, functions: fn, imports, calls };
}

const SKIP_DIR = /(node_modules|__tests__|dist|build|\.git\/)/;
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|js)$/;
function collect(root: string, acc: string[] = []): string[] {
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, d.name);
    if (d.isDirectory()) { if (!SKIP_DIR.test(p)) collect(p, acc); }
    else if (/\.(ts|tsx|cjs|js|mjs)$/.test(d.name) && !SKIP_FILE.test(d.name)) acc.push(p);
  }
  return acc;
}

// 后端根：细化为 core 8 层 + 各独立包，便于 --roots 选层与分区块统计
const ROOTS = [
  'packages/core/src/facade',
  'packages/core/src/governance',
  'packages/core/src/knowledge',
  'packages/core/src/gate',
  'packages/core/src/cognition',
  'packages/core/src/execution',
  'packages/core/src/evaluation',
  'packages/core/src/evolution',
  'packages/core/src/infrastructure',
  'packages/core/src/workflow',
  'packages/connectors/src',
  'packages/memory/src',
  'packages/studio/server',
  'packages/workflows',
  'packages/workflow-sdk/src',
  'packages/contracts',
  'scripts',
];
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json-only');
const ri = args.indexOf('--roots');
const rootSel = ri >= 0 ? args.slice(ri + 1).filter(a => !a.startsWith('--')) : [];

function run(): void {
  const rootsToScan = rootSel.length ? rootSel.flatMap(s => {
    const hit = ROOTS.filter(r => r.toLowerCase().includes(s.toLowerCase()));
    return hit.length ? hit : [];
  }) : ROOTS;
  const files: string[] = [];
  for (const r of rootsToScan) { if (fs.existsSync(r)) collect(r, files); }
  files.sort();
  const map = files.map(f => analyzeFile(f));
  const totalFn = map.reduce((a, f) => a + f.functions.length, 0);
  const totalCall = map.reduce((a, f) => a + f.calls.length, 0);
  const totalImp = map.reduce((a, f) => a + f.imports.length, 0);

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/backend-code-map.json', JSON.stringify({ generatedAt: new Date().toISOString(), roots: rootsToScan, totalFiles: map.length, totalFunctions: totalFn, totalCalls: totalCall, totalImports: totalImp, files: map }, null, 1));
  console.log(`OK data/backend-code-map.json (${map.length} files / ${totalFn} fn / ${totalCall} calls / ${totalImp} imports)`);

  if (!jsonOnly) {
    const md = renderMd(map, rootsToScan, totalFn, totalCall, totalImp);
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('docs/BACKEND_CODE_MAP.md', md);
    console.log(`OK docs/BACKEND_CODE_MAP.md (${md.length} chars)`);
  }
}

function renderMd(map: FileInfo[], roots: string[], totalFn: number, totalCall: number, totalImp: number): string {
  const L: string[] = [];
  L.push('# MorPex 后端代码函数与关系链分析');
  L.push('');
  L.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')} ｜ 工具：\`scripts/_backend-code-analyze.ts\`（TS compiler API，只读）`);
  L.push('');
  L.push('## 0. 统计概览');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|---|---|');
  L.push(`| 扫描根 | ${roots.join('、')} |`);
  L.push(`| 文件数 | ${map.length} |`);
  L.push(`| 函数/方法数 | ${totalFn} |`);
  L.push(`| 调用表达式数 | ${totalCall} |`);
  L.push(`| import 数 | ${totalImp} |`);
  L.push('');
  L.push('## 1. 文件间依赖关系链（import 图）');
  L.push('');
  L.push('> 每文件列出其直接 import 的模块（相对路径按所在目录归一化）。');
  L.push('');
  for (const f of map) {
    L.push(`### ${f.file}`);
    if (!f.imports.length) { L.push('- （无 import）'); continue; }
    for (const i of f.imports) L.push(`- \`${i.from}\` → ${i.names.join(', ') || '(default)'}`);
    L.push('');
  }
  L.push('## 2. 文件内函数/方法清单');
  L.push('');
  for (const f of map) {
    L.push(`### ${f.file}（${f.functions.length} 个）`);
    if (!f.functions.length) { L.push('- （无顶层函数/方法提取）'); continue; }
    L.push('| 函数 | kind | async | export | 行 |');
    L.push('|---|---|---|---|---|');
    for (const g of f.functions) L.push(`| ${g.name} | ${g.kind} | ${g.isAsync ? 'Y' : ''} | ${g.exported ? 'Y' : ''} | ${g.line} |`);
    L.push('');
  }
  L.push('## 3. 核心执行链关系链（函数级，自动生成）');
  L.push('');
  L.push('> 对 8 层主链/装配/服务器/shell 链的关键入口文件，列出其内部实际出现的调用目标（去重+频次，取自上节 CALLS 实证数据）。横向跨文件链：文件→import 已在第 1 节；此处聚焦入口函数内部调用了什么。');
  L.push('');
  const CORE_FILES = ['CompanyFacade', 'ControlPlane', 'runOntologyGroundedReasoning', 'UnifiedExecutionEngine', 'DomainPrimitiveRegistry', 'ShellExecutionPrimitive', 'bootstrapUnified', 'StudioServer', 'EventBus', 'ForcedQueryGuard', 'OrchestratorAgent', 'KnowledgeQueryPrimitive', 'PluginSystem', 'ConnectorRegistry', 'ShellConnector'];
  const seen = new Set<string>();
  for (const f of map) {
    const base = path.basename(f.file).replace(/\.(ts|tsx|js|cjs|mjs)$/, '');
    if (!CORE_FILES.some(c => base === c || (c === 'bootstrapUnified' && base === 'bootstrap-unified'))) { continue; }
    seen.add(base);
    L.push(`### ${f.file.replace(/\\/g, '/')}`);
    const agg = new Map<string, number>();
    for (const c of f.calls) agg.set(c.expr, (agg.get(c.expr) ?? 0) + 1);
    const top = [...agg.entries()].filter(([k]) => !/^console\./.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18);
    if (!top.length) { L.push('- （无调用提取）'); continue; }
    L.push('| 调用目标 | 频次 | | 调用目标 | 频次 |');
    L.push('|---|---|---|---|---|');
    for (let i = 0; i < top.length; i += 2) {
      const a = top[i]; const b = top[i + 1];
      L.push(`| ${a[0]} | ${a[1]} |${b ? `| ${b[0]} | ${b[1]} |` : ' |  |'} `);
    }
    L.push('');
  }
  for (const c of CORE_FILES) if (c !== 'bootstrapUnified' && !seen.has(c)) L.push(`- 注：未在本次扫描命中入口文件 \`${c}\`（可能位于未启用 roots，或为类型/外观）。`);
  L.push('');
  L.push('### 主链值说明（8 层架构）');
  L.push('- 入口：`CompanyFacade.executeGoal`（L1 之上）→ ControlPlane.checkAll（L1 治理）→ Ontology Gate `runOntologyGroundedReasoning`（L3）→ `UnifiedExecutionEngine`（L5 执行，简单→原语快路径/复杂→OrchestratorAgent）→ L6 Evaluation → L7 Evolution');
  L.push('- 装配：`bootstrapUnified`（L8）→ PiBridge → `DomainPrimitiveRegistry.registerMultiple`（5 通用原语）→ `PluginSystem.startAll`（G2 接入，插件级 stop 可回卷）');
  L.push('- 服务器：`StudioServer`（HTTP/SSE :5473）→ RuntimeAPI → core 执行链 → EventBus（at-least-once + 事件契约校验）→ observability trace');
  L.push('- Shell 链：`ShellExecutionPrimitive.execute` → ConnectorRegistry shell.exec → `ShellConnector` → `runCommand`(secureExec：shell:false / scrubEnv / ExecOutcome 正交上报)');
  L.push('');
  return L.join('\n');
}

const isMain = (): boolean => {
  try { return process.argv[1] !== undefined && import.meta.url === url.pathToFileURL(process.argv[1]).href; }
  catch { return true; }
};
if (isMain()) run();