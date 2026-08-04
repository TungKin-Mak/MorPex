/**
 * ast-utils — TypeScript Compiler API 工具（结构修正器 AST/tsc 适配器，功能② Phase 2 增强）
 *
 * 用途：对"生成的代码"做 AST 级检测 + tsc 类型校验（区别于 regex 文本匹配）：
 *   - typeCheck：内存内 TS 程序类型检查（零磁盘写入，自包含单文件，无相对导入）
 *   - findVarDeclarations：AST 识别 `var` 声明（`variable`/`var2` 等标识符不误报）
 *   - findEvalCalls：AST 识别 eval()/Function() 调用（`foo.eval()`/`obj.Function()` 成员访问不误报——
 *     这正是"区分声明/调用"相对 regex 的价值）
 *   - fixVarToLetConst：AST 变换 var → const/let（const 推断：有初始化且未重赋值 → const；
 *     否则 → let；优于 eslint no-var 恒转 let）
 *
 * 架构边界：core 零领域依赖——本文件在软件领域插件内，经 DetectorRegistry /
 * StructuralCorrectionRegistry 注入（与 eslint 适配器同模式）。
 *
 * @packageDocumentation
 */

import ts from 'typescript';

const DEFAULT_FILE = 'generated.ts';
/** 类型检查最大源码长度（防病态输入拖垮校验；超出跳过类型检查，仅 AST 检测） */
const MAX_CHECK_LENGTH = 100_000;

// ── 解析 ──

/** 解析为 AST（不做类型检查；轻量，用于 AST 级检测） */
export function parseSource(code: string, fileName = DEFAULT_FILE): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// ── tsc 类型检查（内存内程序，零磁盘写入）──

export interface TypeCheckResult {
  sourceFile: ts.SourceFile;
  /** 语法 + 语义诊断（空 = 无类型错误） */
  diagnostics: ts.Diagnostic[];
  /** 内存内 TS Program（null = 源码过长跳过类型检查） */
  program: ts.Program | null;
}

/**
 * typeCheck — 对自包含 TS 源码做内存内类型检查
 *
 * 自定义 CompilerHost：虚拟文件（生成的源码）+ typescript 自带 lib.d.ts（ts.sys 读盘）。
 * 适用于"LLM 生成的单个自包含文件"（无相对导入）；有相对导入 → 模块解析报错（如实报告，
 * 非静默）。源码超 MAX_CHECK_LENGTH → 返回空诊断 + program=null（跳过类型检查，AST 检测仍可用）。
 */
export function typeCheck(code: string, fileName = DEFAULT_FILE): TypeCheckResult {
  if (!code || code.length > MAX_CHECK_LENGTH) {
    return { sourceFile: parseSource(code.slice(0, MAX_CHECK_LENGTH), fileName), diagnostics: [], program: null };
  }
  const sourceFile = parseSource(code, fileName);
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.es2020.d.ts'],
    skipLibCheck: true,
    types: [],
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  const origFileExists = host.fileExists.bind(host);
  const origReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, langVersion, onError, shouldCreateNewSourceFile) => {
    if (name === fileName) return sourceFile;
    return origGetSourceFile(name, langVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => (name === fileName ? true : origFileExists(name));
  host.readFile = (name) => (name === fileName ? code : origReadFile(name));

  const program = ts.createProgram([fileName], options, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];
  return { sourceFile, diagnostics, program };
}

/** 诊断 → 可读文本（"行:列 消息"；无位置则纯消息） */
export function formatDiagnostic(d: ts.Diagnostic): string {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (d.file && typeof d.start === 'number') {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    return `${pos.line + 1}:${pos.character + 1} ${msg}`;
  }
  return msg;
}

// ── AST 级检测 ──

export interface VarDeclInfo {
  name: string;
  /** 是否被重新赋值（= 号左值出现） */
  isReassigned: boolean;
  node: ts.VariableDeclaration;
}

/**
 * findVarDeclarations — AST 识别 `var` 声明
 *
 * 判定：VariableDeclarationList 既无 Let 也无 Const flag → var。
 * 相对 regex（`\bvar\s+\w+`）优势：`variable`、`var2`、`var_foo` 等标识符不误报。
 */
export function findVarDeclarations(sourceFile: ts.SourceFile): VarDeclInfo[] {
  const vars: Array<{ name: string; node: ts.VariableDeclaration }> = [];
  const reassigned = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclarationList(node)) {
      const flags = node.flags;
      const isVar = !(flags & ts.NodeFlags.Let) && !(flags & ts.NodeFlags.Const);
      if (isVar) {
        for (const decl of node.declarations) {
          if (ts.isIdentifier(decl.name)) {
            vars.push({ name: decl.name.text, node: decl });
          }
        }
      }
    }
    // 重赋值检测：`x = ...`（赋值号左值为标识符）
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(node.left)) reassigned.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return vars.map((v) => ({ ...v, isReassigned: reassigned.has(v.name) }));
}

/**
 * findEvalCalls — AST 识别 eval() / Function() / new Function() 调用
 *
 * 只匹配**裸标识符**调用（Identifier 表达式）：`eval(...)`、`Function(...)`、`new Function(...)`。
 * 相对 regex（`\b(eval|Function)\s*\(`）优势：`foo.eval()`、`obj.Function()`、`my.eval2()` 等
 * 成员访问/变体不误报——"区分声明/调用/成员访问"。
 */
export function findEvalCalls(sourceFile: ts.SourceFile): ts.Expression[] {
  const calls: ts.Expression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'eval' || node.expression.text === 'Function') calls.push(node);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'Function') calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

// ── AST 变换：var → const/let ──

export interface VarFixResult {
  output: string;
  /** 修正的声明数 */
  fixed: number;
}

/**
 * fixVarToLetConst — AST 变换 var → const/let
 *
 * 每条声明列表独立判定：
 *   - 全部声明都有初始化 且 均未被重赋值 → `const`
 *   - 否则 → `let`
 * （与 eslint no-var+prefer-const 语义一致，但一步到位，且不依赖两条规则同时激活）
 *
 * 覆盖 VariableStatement（`var x = 1;`）与 ForStatement 初始化（`for (var i...)`）。
 * 重赋值判定基于 AST 左值检测；误判风险：函数参数遮蔽（同名局部赋值）——MVP 保守接受
 * （宁可转 let 也不转错 const，语义安全）。
 */
export function fixVarToLetConst(code: string): VarFixResult {
  const sourceFile = parseSource(code);
  const vars = findVarDeclarations(sourceFile);
  if (vars.length === 0) return { output: code, fixed: 0 };

  // 重赋值集合（任一声明被重赋值 → 该名称为 let）
  const reassignedNames = new Set(vars.filter((v) => v.isReassigned).map((v) => v.name));
  // 无初始化的声明不能 const（收集：若列表内存在 → 列表转 let）
  const noInitNames = new Set(
    vars.filter((v) => v.node.initializer === undefined).map((v) => v.name),
  );

  let fixed = 0;
  const result = ts.transform(sourceFile, [
    (context) => (root) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isVariableDeclarationList(node)) {
          const flags = node.flags;
          const isVar = !(flags & ts.NodeFlags.Let) && !(flags & ts.NodeFlags.Const);
          if (isVar && node.declarations.length > 0) {
            const names = node.declarations
              .filter((d) => ts.isIdentifier(d.name))
              .map((d) => (d.name as ts.Identifier).text);
            const needsLet = names.some(
              (n) => reassignedNames.has(n) || noInitNames.has(n),
            );
            const newFlags = needsLet ? ts.NodeFlags.Let : ts.NodeFlags.Const;
            fixed += names.length;
            // createVariableDeclarationList（新 flags）：update 只保留原 flags，改 let/const 需重建
            return ts.factory.createVariableDeclarationList(node.declarations, newFlags);
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      // visitNode 返回 Node，Transformer<SourceFile> 要求 SourceFile → 显式断言（变换保留文件结构）
      return ts.visitNode(root, visit) as ts.SourceFile;
    },
  ]);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = printer.printFile(result.transformed[0] as ts.SourceFile).replace(/\n+$/, '');
  result.dispose?.();

  return { output, fixed };
}
