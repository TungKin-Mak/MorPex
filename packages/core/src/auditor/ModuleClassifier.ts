/**
 * ModuleClassifier v3 — 8 级模块分类系统
 *
 * 综合静态导入 + DI + Plugin + Event + Public API 分析。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleInfo, ClassifiedModule, ClassificationContext } from './types.js';
import { ModuleStatus } from './types.js';

const DORMANT = new Set([
  'NegotiationEngine', 'PermissionEngine', 'SessionProjection',
  'ContractGateway', 'PiAdapterBridge',
]);

export class ModuleClassifier {
  classify(modules: ModuleInfo[], context: ClassificationContext): ClassifiedModule[] {
    const diFiles = new Set((context.diEdges || []).map(e => e.filePath));
    const boot = context.bootstrapContent || '';

    return modules.map(m => {
      const status = this.classifyOne(m, diFiles, context.publicApiSet, boot);
      return { path: m.path, name: m.name, moduleInfo: m, status, reason: this.reasonText(status, m) };
    });
  }

  private classifyOne(
    m: ModuleInfo, diFiles: Set<string>, barrel: Set<string>, boot: string,
  ): ModuleStatus {
    const p = m.path;

    if (p.includes('__tests__') || p.startsWith('runtime/verify-') || p.startsWith('runtime/debug-'))
      return ModuleStatus.TEST_ONLY;
    if (p.endsWith('.d.ts'))
      return ModuleStatus.TEST_ONLY;

    if (m.importers > 0)
      return ModuleStatus.ACTIVE_RUNTIME;

    if (barrel.has(p) || barrel.has(m.name))
      return ModuleStatus.ACTIVE_PUBLIC_API;
    if ((p === 'index.ts' || p.endsWith('/index.ts')) && m.hasExport)
      return ModuleStatus.ACTIVE_PUBLIC_API;

    if (diFiles.has(p))
      return ModuleStatus.DI_CREATED;

    if (this.isPlugin(m, boot))
      return ModuleStatus.PLUGIN_CAPABILITY;

    if (p.includes('extensions/planning/pipeline/stages/') || m.name === 'helpers')
      return ModuleStatus.EVENT_LISTENER;

    if (m.name === 'MetaPlannerEngines')
      return ModuleStatus.PLUGIN_CAPABILITY;

    if (['AgentFactory', 'builtin-tools', 'ToolCallTracker'].includes(m.name))
      return ModuleStatus.ACTIVE_RUNTIME;

    if (DORMANT.has(m.name))
      return ModuleStatus.DORMANT_CAPABILITY;

    if (p.endsWith('/types.ts'))
      return ModuleStatus.DORMANT_CAPABILITY;

    return ModuleStatus.DEAD;
  }

  private isPlugin(m: ModuleInfo, bootContent: string): boolean {
    if (m.name !== 'plugin') return false;
    if (!bootContent) return false;
    return bootContent.includes('.registerPlugin') || bootContent.includes('new ArtifactPlugin') || bootContent.includes('new KnowledgeGraphPlugin');
  }

  private reasonText(status: ModuleStatus, m: ModuleInfo): string {
    const map: Record<string, string> = {
      ACTIVE_RUNTIME: `Imported by ${m.importers} module(s)`,
      ACTIVE_PUBLIC_API: 'Exported from public API barrel',
      PLUGIN_CAPABILITY: 'Plugin registered in bootstrap',
      DI_CREATED: 'Runtime new/DI in bootstrap/Kernel',
      EVENT_LISTENER: 'Dynamic pipeline stage',
      DORMANT_CAPABILITY: 'Preserved future capability',
      TEST_ONLY: 'Test/verification script',
      DEAD: 'No runtime connection found',
    };
    return map[status] || 'Unknown';
  }

  summarize(classified: ClassifiedModule[]): Record<string, number> {
    const s: Record<string, number> = {};
    for (const c of classified) s[c.status] = (s[c.status] || 0) + 1;
    return s;
  }
}
