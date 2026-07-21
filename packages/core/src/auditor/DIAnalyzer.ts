/**
 * DIAnalyzer v3 — Runtime Dependency Injection Detection
 *
 * Detects runtime instantiation patterns that static import analysis misses:
 * - `new ClassName()` in bootstrap/Kernel/Gateway
 * - `.register()` plugin/system registrations
 * - Factory patterns (create*, build*, spawn*)
 *
 * Generates Runtime Dependency Edges for the Architecture Graph.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleInfo, DIEdge } from './types.js';

export class DIAnalyzer {
  /**
   * Scan bootstrap.ts, Kernel.ts, and key runtime files for DI patterns.
   */
  scan(srcRoot: string, modules: ModuleInfo[]): DIEdge[] {
    const edges: DIEdge[] = [];
    const filesToScan = [
      '../bootstrap.ts',
      '../src/common/Kernel.ts',
      '../src/gateway/ExecutionGateway.ts',
      '../src/services/AgentFactory.ts',
    ];

    for (const relPath of filesToScan) {
      const fullPath = path.resolve(srcRoot, relPath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const baseName = path.basename(relPath);

        // Find `new ClassName()` patterns
        const newRegex = /new\s+(\w+)\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = newRegex.exec(content)) !== null) {
          const className = match[1];
          // Skip native/built-in classes
          if (['Map', 'Set', 'Error', 'Promise', 'Date', 'RegExp', 'Array', 'Object'].includes(className)) continue;
          // Skip constructor references
          if (match.index > 0 && content[match.index - 1] === '.') continue;
          // Find which module defines this class
          const modulePath = this.findClassDefinition(className, modules);
          if (modulePath) {
            edges.push({
              className,
              filePath: modulePath,
              instantiatedIn: `src/${baseName.replace('.ts', '')}`,
              pattern: 'new',
            });
          }
        }

        // Find `.register(` patterns (PluginSystem, etc.)
        const registerRegex = /\.(register|registerPlugin|setDefaultAdapter|attachHarness|attachMemoryEngine|attachProviders)\s*\(/g;
        while ((match = registerRegex.exec(content)) !== null) {
          // The argument is often a class name
          const methodName = match[1];
          const afterParen = content.slice(match.index + match[0].length);
          const argMatch = afterParen.match(/^(\w+)/);
          if (argMatch) {
            const modulePath = this.findClassDefinition(argMatch[1], modules);
            if (modulePath) {
              edges.push({
                className: argMatch[1],
                filePath: modulePath,
                instantiatedIn: `src/${baseName.replace('.ts', '')}`,
                pattern: 'register',
              });
            }
          }
        }
      } catch {
        // File might not exist
      }
    }

    return edges;
  }

  /**
   * Find which module file defines a given class.
   */
  private findClassDefinition(className: string, modules: ModuleInfo[]): string | null {
    for (const mod of modules) {
      if (mod.type !== 'implementation' && mod.type !== 'types') continue;
      const fullPath = path.join(process.cwd(), 'packages/core/src', mod.path);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Check for `class ClassName` or `export class ClassName`
        if (new RegExp(`\\bclass\\s+${className}\\b`).test(content)) {
          return mod.path;
        }
        // Check for `export function createClassName` factory
        if (new RegExp(`\\bfunction\\s+create${className}\\b`).test(content)) {
          return mod.path;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Check if a specific module is referenced via DI in bootstrap/Kernel.
   */
  isDIConnected(modulePath: string, edges: DIEdge[]): boolean {
    return edges.some(e => e.filePath === modulePath);
  }
}
