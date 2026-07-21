/**
 * PublicAPIAnalyzer v3 — 公开 API 检测
 *
 * Parses barrel export chains, marks modules as Public API.
 * Exported but internally unreferenced modules → not dead code, public interface.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleInfo, PublicAPIModule } from './types.js';

export class PublicAPIAnalyzer {
  scan(srcRoot: string, modules: ModuleInfo[]): { apiModules: PublicAPIModule[]; apiPaths: Set<string> } {
    const apiModules: PublicAPIModule[] = [];
    const apiPaths = new Set<string>();

    const barrelFiles = ['../src/index.ts', '../index.ts', '../src/runtime/index.ts', '../src/extensions/index.ts'];

    for (const relPath of barrelFiles) {
      const fullPath = path.resolve(srcRoot, relPath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        this.parseExports(content, relPath.replace('../src/', 'src/'), modules, apiModules, apiPaths);
      } catch {}
    }

    return { apiModules, apiPaths };
  }

  private parseExports(
    content: string, barrelPath: string, modules: ModuleInfo[],
    apiModules: PublicAPIModule[], apiPaths: Set<string>,
  ): void {
    // Match: export { ... } from './path.js' OR export type { ... } from './path.js' OR export * from './path.js'
    const exportRegex = /export\s+(?:\{[^}]*\}|\*\s|type\s+\{[^}]*\})\s+from\s+['"](\.\/.+?)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = exportRegex.exec(content)) !== null) {
      let importPath = match[1].replace(/\.js$/, '').replace(/\/index$/, '');
      if (!importPath.startsWith('./')) importPath = './' + importPath;

      let barrelDir = barrelPath.includes('/') ? barrelPath.substring(0, barrelPath.lastIndexOf('/')) : '.';
      if (barrelDir === 'src') barrelDir = '.';
      let resolved = path.normalize(path.join(barrelDir, importPath)).replace(/\\/g, '/');
      if (resolved.startsWith('src/')) resolved = resolved.slice(4);

      // Add resolved path
      apiPaths.add(resolved);

      // Match against module paths
      for (const mod of modules) {
        const modClean = mod.path.replace(/\.ts$/, '').replace(/\/index$/, '');
        if (modClean === resolved || modClean === importPath.replace(/.\//, '')) {
          apiPaths.add(mod.path);
          // Phase 9: Also mark transitive dependencies of public API modules
          this.addTransitiveDeps(mod.path, modules, apiPaths);
        }
      }
    }
  }

  /** Mark transitive dependencies of public API modules as also public API */
  private addTransitiveDeps(modPath: string, modules: ModuleInfo[], apiPaths: Set<string>): void {
    const mod = modules.find(m => m.path === modPath);
    if (!mod || !mod.dependencies) return;
    for (const dep of mod.dependencies) {
      // Resolve relative dep to a module path
      for (const m of modules) {
        const mClean = m.path.replace(/\.ts$/, '').replace(/\/index$/, '');
        const depClean = dep.replace(/\.js$/, '');
        if (mClean.endsWith(depClean) || m.path.includes(depClean)) {
          if (!apiPaths.has(m.path)) {
            apiPaths.add(m.path);
          }
        }
      }
    }
  }
}
