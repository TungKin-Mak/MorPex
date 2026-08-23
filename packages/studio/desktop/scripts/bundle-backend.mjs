#!/usr/bin/env node
/**
 * 打包「可移植后端运行时」→ packages/studio/desktop/portable/
 *
 * 默认（方案 A，esbuild 单文件）：
 *   portable/
 *   ├── node.exe                  # Node 运行时（随包，用户无需本机 Node）
 *   ├── runtime/                  # 单文件运行时（bundle-server.mjs 产出）
 *   │   ├── server.mjs            # 全部纯 JS 打包产物（启动快，无 npm install / 源码树）
 *   │   ├── node_modules/         # 仅 better-sqlite3 原生闭包（prebuilt）
 *   │   └── config/               # morpex.yaml 等模板
 *   └── repo.zip                  # runtime/ 内容打包（供 NSIS 资源 + 壳首启解压）
 *
 * 运行: <portable>/node.exe <解压目录>/server.mjs
 * 壳侧：src-tauri/lib.rs 已同步（RuntimeLayout 探测新旧布局，新版优先）
 *
 * --legacy（旧方案，tsx + 源码树）：
 *   portable/
 *   ├── node.exe
 *   └── repo/                     # 迷你仓库（tsconfig + package.json + node_modules + packages/ 源码 + config）
 *       运行: node.exe repo/node_modules/tsx/dist/cli.mjs repo/packages/studio/server/index.ts
 *
 * 解耦红线：只复制/打包源码与依赖，不改任何业务代码。
 */
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(__dirname, '..');
const ROOT = resolve(DESKTOP, '../../..');
const PORTABLE = join(DESKTOP, 'portable');
const REPO = join(PORTABLE, 'repo');
const RUNTIME = join(PORTABLE, 'runtime');

/** 后端运行时依赖（去掉了 pm2/playwright 等仅测试/运维用的包） */
const RUNTIME_DEPS = {
  '@earendil-works/pi-agent-core': '^0.81.1',
  '@earendil-works/pi-ai': '^0.81.1',
  '@earendil-works/pi-coding-agent': '^0.81.1',
  'better-sqlite3': '^12.11.1',
  cors: '^2.8.5',
  express: '^4.21.0',
  'lru-cache': '^11.5.2',
  ws: '^8.21.1',
  tsx: '^4.22.4',
};

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '__tests__',
  'dist',
  '.git',
  'data',
  'build',
  'desktop', // studio/desktop：桌面壳，非后端运行时
  'web', // studio/web：前端渲染层，非后端运行时
  'portable', // 本脚本输出目录，防递归
]);
const EXCLUDED_FILES = /\.test\.(ts|js|tsx)$|\.spec\.(ts|js)$/;

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (EXCLUDED_DIRS.has(name)) continue;
    const s = join(src, name);
    const d = join(dest, name);
    const st = statSync(s);
    if (st.isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else if (!EXCLUDED_FILES.test(name)) {
      copyFileSync(s, d);
    }
  }
}

function log(step) {
  console.log(`[bundle] ${step}`);
}

function sizeMB(dir) {
  let n = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else n += st.size;
    }
  };
  walk(dir);
  return (n / 1024 / 1024).toFixed(1);
}

/** 方案 A：esbuild 单文件运行时（默认） */
async function bundledBuild() {
  log(`仓库根: ${ROOT}`);
  log(`打包目标: ${PORTABLE}（方案 A：esbuild 单文件）`);

  rmSync(PORTABLE, { recursive: true, force: true });
  mkdirSync(PORTABLE, { recursive: true });

  // 1. Node 运行时
  const nodeBin = process.execPath;
  log(`复制 Node 运行时: ${nodeBin} -> portable/node.exe`);
  copyFileSync(nodeBin, join(PORTABLE, 'node.exe'));

  // 2. esbuild 单文件 runtime（复用 bundle-server.mjs，保证两脚本产物一致）
  const { buildRuntime } = await import('./bundle-server.mjs');
  await buildRuntime(RUNTIME);

  // 3. 打 repo.zip（沿用资源名与路径，NSIS/壳首启解压逻辑不变；内容变为单文件运行时）
  log('打包 repo.zip（= runtime/ 内容，bsdtar 支持长路径）');
  execSync('tar -a -cf repo.zip -C runtime .', { cwd: PORTABLE, stdio: 'inherit' });
  const zipSize = (statSync(join(PORTABLE, 'repo.zip')).size / 1024 / 1024).toFixed(1);
  log(`  repo.zip = ${zipSize} MB`);

  // 4. 校验关键路径
  log('校验关键文件…');
  const checks = [
    join(PORTABLE, 'node.exe'),
    join(PORTABLE, 'repo.zip'),
    join(RUNTIME, 'server.mjs'),
    join(RUNTIME, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    join(RUNTIME, 'config/morpex.yaml'),
  ];
  let ok = true;
  for (const c of checks) {
    if (!existsSync(c)) {
      ok = false;
      console.warn(`[bundle] ❌ 缺失: ${relative(PORTABLE, c)}`);
    }
  }
  if (!ok) process.exit(1);

  log(`✅ 打包完成: portable/ = ${sizeMB(PORTABLE)} MB（node.exe + repo.zip + runtime/）`);
  log('   启动命令: node.exe <runtime>/server.mjs');
}

/** 旧方案：tsx + 源码树（--legacy fallback） */
function legacyBuild() {

log(`仓库根: ${ROOT}`);
log(`打包目标: ${PORTABLE}`);

// 0. 清空旧产物
rmSync(PORTABLE, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });

// 1. Node 运行时
const nodeBin = process.execPath;
log(`复制 Node 运行时: ${nodeBin} -> portable/node.exe`);
copyFileSync(nodeBin, join(PORTABLE, 'node.exe'));

// 2. tsconfig（tsx 解析 @morpex/* 别名必需）
copyFileSync(join(ROOT, 'tsconfig.json'), join(REPO, 'tsconfig.json'));

// 3. config 模板
log('复制 config/');
copyTree(join(ROOT, 'config'), join(REPO, 'config'));

// 4. 后端源码 packages/
log('复制 packages/（排除测试/数据/构建产物）');
mkdirSync(join(REPO, 'packages'), { recursive: true });
for (const pkg of ['core', 'studio', 'memory', 'workflows', 'connectors', 'contracts', 'workflow-sdk']) {
  const src = join(ROOT, 'packages', pkg);
  if (!existsSync(src)) {
    console.warn(`[bundle] ⚠️ 缺少 packages/${pkg}，跳过`);
    continue;
  }
  log(`  - packages/${pkg}`);
  copyTree(src, join(REPO, 'packages', pkg));
}

// 5. 精简 package.json（仅运行时依赖 + tsx）
log('写 repo/package.json');
writeFileSync(
  join(REPO, 'package.json'),
  JSON.stringify(
    {
      name: 'morpex-portable-backend',
      private: true,
      type: 'module',
      engines: { node: '>=20' },
      dependencies: RUNTIME_DEPS,
    },
    null,
    2,
  ),
);

// 6. 安装运行时依赖
log('npm install --omit=dev（可能需几分钟，首次下载 pi-ai/better-sqlite3 等）');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
  cwd: REPO,
  stdio: 'inherit',
});

// 7. 剥离类型/源码映射（运行时不需要；同时规避 node_modules 深层路径超 Windows 260 字符）
log('剥离 node_modules 中的 .d.ts/.map（省体积 + 规避深路径）');
const stripped = execSync(
  `node -e "const fs=require('fs'),p=require('path');let n=0;(function w(d){for(const x of fs.readdirSync(d)){const q=p.join(d,x);let s;try{s=fs.lstatSync(q)}catch{continue}if(s.isDirectory())w(q);else if(/\.d\.ts(\.map)?$|\\.(js|mjs|cjs)\\.map$/.test(x)){try{fs.rmSync(q,{force:true});n++}catch{}}}w('node_modules');console.log(n)}"`,
  { cwd: REPO, encoding: 'utf8' },
).trim();
log(`  已剥离 ${stripped} 个文件`);

// 8. 打 repo.zip（安装包只带单个 zip，规避 NSIS 对深路径/海量小文件的处理问题）
log('打包 repo.zip（bsdtar，支持长路径）');
execSync('tar -a -cf repo.zip -C repo .', { cwd: PORTABLE, stdio: 'inherit' });
const zipSize = (statSync(join(PORTABLE, 'repo.zip')).size / 1024 / 1024).toFixed(1);
log(`  repo.zip = ${zipSize} MB`);

// 9. 校验关键路径存在
log('校验关键文件…');
const checks = [
  join(REPO, 'packages/studio/server/index.ts'),
  join(REPO, 'packages/core/index.ts'),
  join(REPO, 'node_modules/tsx/dist/cli.mjs'),
  join(REPO, 'config/morpex.yaml'),
  join(PORTABLE, 'node.exe'),
  join(PORTABLE, 'repo.zip'),
];
let ok = true;
for (const c of checks) {
  const e = existsSync(c);
  if (!e) {
    ok = false;
    console.warn(`[bundle] ❌ 缺失: ${relative(PORTABLE, c)}`);
  }
}
if (!ok) process.exit(1);

log(`✅ 打包完成: portable/ = ${sizeMB(PORTABLE)} MB（node.exe + repo.zip + repo/）`);
log(`   安装包资源: node.exe + repo.zip；首启由壳解压 repo.zip 后运行`);
}

// ── 分发入口 ──────────────────────────────────────────────
if (process.argv.includes('--legacy')) {
  legacyBuild();
} else {
  bundledBuild().catch((err) => {
    console.error('[bundle] ❌', err.message);
    process.exit(1);
  });
}
