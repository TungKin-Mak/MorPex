#!/usr/bin/env node
/**
 * 方案 A：esbuild 把后端打成单文件 server.mjs
 *
 * 产物布局（默认 <desktop>/portable/runtime/，可用 argv[2] 覆盖）：
 *   runtime/
 *   ├── server.mjs                          # 全部纯 JS 打包（业务源码 + pi-* + express/eslint 等）
 *   ├── node_modules/                       # 仅原生模块运行时闭包（require('better-sqlite3') 可直接解析）
 *   │   ├── better-sqlite3/                 #   prebuilt .node 随包，用户免编译工具链
 *   │   ├── bindings/
 *   │   └── file-uri-to-path/
 *   └── config/                             # morpex.yaml / embeddingconfig.yaml 模板（复用根目录 config）
 *
 * 启动：node.exe runtime/server.mjs   （cwd=runtime/ 或仓库数据目录）
 *
 * external 决策（依据 probe 迭代结果）：
 *   - better-sqlite3        原生 NAPI 模块，无法打进 JS bundle，随包带 prebuilt
 *   - jiti、jiti/package.json  eslint 的可选动态依赖（packages/workflows/software/src/rules/
 *     structural-eslint.ts 引入 eslint → eslint/lib/config/config-loader.js 内 `await import("jiti")`），
 *     仅在 eslint 运行时加载 TS 版配置文件才触达；external 容忍缺失，触达时报错可接受
 *
 * 解耦红线：只打包，不改任何 packages 下各包的 src 业务代码。
 */
import { build } from 'esbuild';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(__dirname, '..');
const ROOT = resolve(DESKTOP, '../../..');
const PORTABLE = join(DESKTOP, 'portable');
const DEFAULT_OUT = join(PORTABLE, 'runtime');

const ENTRY = join(ROOT, 'packages/studio/server/index.ts');
const EXTERNALS = ['better-sqlite3', 'jiti', 'jiti/package.json'];

/** better-sqlite3 的运行时依赖闭包（bindings → file-uri-to-path）；prebuild-install 仅安装期需要 */
const NATIVE_PACKAGES = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

function log(step) {
  console.log(`[bundle-server] ${step}`);
}

/** 复制单个包（.d.ts/.map 由调用方统一剥离） */
function copyRuntimePackage(name, destNodeModules) {
  const src = join(ROOT, 'node_modules', name);
  const dest = join(destNodeModules, name);
  if (!existsSync(src)) throw new Error(`缺少原生依赖包: ${name}（请先在仓库根 npm install）`);
  cpSync(src, dest, { recursive: true });
  stripTypes(dest);
}

function stripTypes(dir) {
  let n = 0;
  (function walk(d) {
    for (const x of readdirSync(d)) {
      const p = join(d, x);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.d\.ts(\.map)?$|\.c?js\.map$|\.mjs\.map$/.test(x)) {
        try { rmSync(p, { force: true }); n++; } catch {}
      }
    }
  })(dir);
  return n;
}

export async function buildRuntime(outDir = DEFAULT_OUT) {
  if (!existsSync(ENTRY)) throw new Error(`入口不存在: ${ENTRY}`);
  log(`输出目录: ${outDir}`);
  // 幂等：先清空再产出
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. esbuild 单文件打包
  log('esbuild 打包中（platform=node format=esm target=node20 minify）…');
  const result = await build({
    entryPoints: [ENTRY],
    outfile: join(outDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: true,
    sourcemap: false,
    external: EXTERNALS,
    // CJS 依赖在 ESM 产物里的动态 require/全局量需要垫片（否则报 Dynamic require of "path" / __filename is not defined）
    // 注意：__filename/__dirname 指向 server.mjs 自身（esbuild 单文件产物的标准做法）
    banner: {
      js: [
        "import { createRequire as __cR } from 'node:module';",
        "import { dirname as __dN } from 'node:path';",
        "import { fileURLToPath as __fUP } from 'node:url';",
        "const require = __cR(import.meta.url);",
        "const __filename = __fUP(import.meta.url);",
        "const __dirname = __dN(__filename);",
      ].join('\n'),
    },
    logLevel: 'warning',
  });
  const jsSize = statSync(join(outDir, 'server.mjs')).size / 1024 / 1024;

  // 2. 原生模块闭包
  log(`复制原生模块闭包: ${NATIVE_PACKAGES.join(', ')}`);
  const nm = join(outDir, 'node_modules');
  mkdirSync(nm, { recursive: true });
  let stripped = 0;
  for (const name of NATIVE_PACKAGES) {
    copyRuntimePackage(name, nm);
    stripped += stripTypes(join(nm, name));
  }

  // 3. 校验 prebuilt 二进制存在（Windows 免编译的关键）
  const nativeBin = join(nm, 'better-sqlite3/build/Release/better_sqlite3.node');
  if (!existsSync(nativeBin)) throw new Error('better_sqlite3.node 缺失——请确认仓库根已安装 better-sqlite3 prebuilt');

  // 4. config 模板
  const cfgSrc = join(ROOT, 'config');
  if (existsSync(cfgSrc)) {
    log('复制 config/ 模板');
    cpSync(cfgSrc, join(outDir, 'config'), { recursive: true });
  }

  log(`✅ server.mjs = ${jsSize.toFixed(1)} MB；剥离类型文件 ${stripped} 个`);
  return { outDir, jsSizeMB: Number(jsSize.toFixed(1)) };
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

// 直接执行（非被 import）：跑完整构建 + 报体积
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  buildRuntime(outDir)
    .then(({ jsSizeMB }) => {
      const total = sizeMB(outDir);
      log(`✅ 完成: ${outDir} 总计 ${total} MB（server.mjs ${jsSizeMB} MB + 原生闭包 + config）`);
      log('启动命令: node.exe <runtime>/server.mjs');
    })
    .catch((err) => {
      console.error('[bundle-server] ❌', err.message);
      process.exit(1);
    });
}
