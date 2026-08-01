import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleInfo } from './types.js';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(DIR, '..');
const TEST_SRC = path.resolve(DIR, '../../__tests__');
export class ModuleScanner {
  async scanAll(): Promise<ModuleInfo[]> {
    const r: ModuleInfo[] = []; await this._scan(SRC, r); await this._scan(TEST_SRC, r); return r;
  }
  private async _scan(dir: string, result: ModuleInfo[]): Promise<void> {
    let e: fs.Dirent[];
    try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of e) {
      const fp = path.join(dir, entry.name);
      const rp = path.relative(SRC, fp).replace(/\\/g, '/');
      if (entry.isDirectory()) { await this._scan(fp, result); }
      else if (entry.isFile() && entry.name.endsWith('.ts')) { result.push(this._ana(fp, rp)); }
    }
  }
  private _ana(fp: string, rp: string): ModuleInfo {
    const c = fs.readFileSync(fp, 'utf-8');
    const t = rp.includes('__tests__') || rp.includes('.test.') || rp.includes('.spec.') || rp.startsWith('runtime/verify-phase') ? 'test' : rp.endsWith('/index.ts') ? 'barrel' : rp.endsWith('/types.ts') ? 'types' : 'implementation';
    const deps: string[] = [];
    // Capture both ./ and ../ relative imports
    const re = /from\s+['"]((?:\.\.?\/).+?)['"]/g; let m;
    while ((m = re.exec(c)) !== null) deps.push(m[1]);
    // Also detect side-effect imports: import '...'
    const sideRe = /import\s+['"]((?:\.\.?\/).+?)['"]/g;
    while ((m = sideRe.exec(c)) !== null) deps.push(m[1]);
    return { path: rp, name: path.basename(rp, '.ts'), type: t, lines: c.split('\n').length, hasExport: /export\s+(const|function|class|interface|type|default|enum)/.test(c), importers: 0, dependencies: deps };
  }
  get coreSrcPath(): string { return SRC; }
}
