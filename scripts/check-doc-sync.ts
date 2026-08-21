/**
 * check:doc-sync — 文档与代码一致性校验（从代码出发，零噪音）
 *
 * 校验：
 *   1. docs/AICOS_CORE_FILE_REGISTRY.md —— 每个登记代码文件必须解析到真实文件；
 *   2. docs/CAPABILITY_INDEX.md —— 每个锚点文件必须真实存在；
 *   3. 函数/关系链（BACKEND_CODE_MAP）= 由 scripts/_backend-code-analyze.ts 重生成保证。
 *
 * 用法：`npx tsx scripts/check-doc-sync.ts`（纳入"改码必更文档"门禁）。
 * 数据源：data/backend-code-map.json（由代码 AST 生成的真实文件集）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const bkey = (p: string): string => p.split('\\').join('/');
let map: { files: Array<{ file: string }> } = { files: [] };
try { map = JSON.parse(fs.readFileSync('data/backend-code-map.json', 'utf8')); } catch { /* 未生成过则只做 fs 校验 */ }
const realFiles = new Set(map.files.map((f) => bkey(f.file)));

function resolve(shown: string): string | null {
  if (realFiles.has(shown)) return shown;
  if (shown.startsWith('packages/')) return realFiles.has(shown) ? shown : null;
  if (realFiles.has('packages/core/src/' + shown)) return 'packages/core/src/' + shown;
  if (realFiles.has('packages/' + shown)) return 'packages/' + shown;
  // .../ 相对登记：用含目录的后缀匹配（如 observability/types.ts）
  if (shown.startsWith('.../')) {
    const suff = shown.slice(4);
    const h = [...realFiles].filter((f) => f.endsWith('/' + suff));
    if (h.length >= 1) return h[0];
    if (fs.existsSync('packages/studio/server/' + suff)) return 'packages/studio/server/' + suff;
  }
  const base = shown.split('/').pop() ?? '';
  // 后端 .../ 相对形式唯一匹配
  const hit = [...realFiles].filter((f) => f.endsWith('/' + base) && !f.includes('/__tests__/'));
  if (hit.length === 1) return hit[0];
  // 前端 web：src/* → packages/studio/web/src/*
  if (shown.startsWith('src/') || shown === 'vite.config.ts') {
    const f = shown === 'vite.config.ts' ? 'packages/studio/web/vite.config.ts' : 'packages/studio/web/' + shown;
    return fs.existsSync(f) ? f : null;
  }
  // 桌面壳：src-tauri/*、scripts/* → packages/studio/desktop/*
  if (shown.startsWith('src-tauri/') || shown.startsWith('scripts/') || shown === 'README.md') {
    const f = 'packages/studio/desktop/' + shown;
    return fs.existsSync(f) ? f : null;
  }
  // 测试文件：packages 递归找同名（唯一）
  if (base.includes('.test.') || base.includes('.spec.')) {
    const walk = (dir: string, acc: string[]): void => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (!/node_modules|portable|target|__snapshots__|\.git|dist/.test(p)) walk(p, acc); }
        else if (d.isFile() && d.name === base) acc.push(bkey(p));
      }
    };
    const w: string[] = []; walk('packages', w);
    return w.length >= 1 ? w[0] : null;
  }
  // 其它相对：先直接 fs，再 desktop
  if (fs.existsSync(shown)) return shown;
  const d = 'packages/studio/desktop/' + shown;
  return fs.existsSync(d) ? d : null;
}

let errors = 0;
const warn = (m: string): void => { errors++; console.log('  ✖ ' + m); };

console.log('[doc-sync] FILE_REGISTRY 校验…');
let total = 0;
for (const ln of fs.readFileSync('docs/AICOS_CORE_FILE_REGISTRY.md', 'utf8').split('\n')) {
  const m = ln.match(/^\| `([^`]+)` \| ([^|]+) \|/);
  if (m) {
    const shown = m[1];
    if (!/\.(ts|tsx|cjs|js|mjs|rs)$/.test(shown)) continue; // 跳过 .md/.json/.sh 等
    total++;
    if (!resolve(shown)) warn(`FILE_REGISTRY 登记路径未解析到真实文件: ${shown}`);
  }
}
console.log(`[doc-sync] FILE_REGISTRY 代码文件 ${total} 行校验完成，错误 ${errors}。`);

console.log('[doc-sync] CAPABILITY_INDEX 锚点校验…');
let err2 = 0;
for (const ln of fs.readFileSync('docs/CAPABILITY_INDEX.md', 'utf8').split('\n')) {
  const ms = ln.match(/`([a-zA-Z0-9_/.-]+\.ts)`/g);
  if (ms) for (const raw of ms) {
    const shown = raw.slice(1, -1);
    if (!shown.includes('docs/') && !resolve(shown)) { err2++; console.log(`  ✖ CAPABILITY_INDEX 锚点未解析: ${shown}`); }
  }
}
console.log(`[doc-sync] CAPABILITY_INDEX 锚点校验完成，错误 ${err2}。`);

const code = errors + err2 === 0 ? 0 : 1;
console.log(code === 0 ? '[doc-sync] ✅ 全部通过（登记/锚点均可解析）' : `[doc-sync] ❌ ${errors + err2} 处需修复`);
process.exit(code);