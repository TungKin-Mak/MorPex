/**
 * TemplateManager — Unified template evolution + filesystem management
 *
 * OpenSpace Fusion: Phase 2+3 — Merged TemplateEvolutionEngine + TemplateFileSystem
 *
 * Merged from:
 *   - TemplateEvolutionEngine.ts (evolution: capture/derive/fix with lineage tracking)
 *   - TemplateFileSystem.ts (filesystem export/load/sync for human-readable TEMPLATE.md)
 *
 * Three evolution modes:
 *   CAPTURED — Capture new templates from successful executions
 *   DERIVED  — Derive variants from parent templates
 *   FIXED    — Fix failing templates (inject validations, adjust timeouts, swap tools)
 *
 * Filesystem structure managed internally (no separate FileSystem dependency):
 *   data/planning/templates/{domain}/{name}/TEMPLATE.md + lineage.json + stats.json
 *
 * Integration points:
 *   - PlanExperienceStore (persistence + sync)
 *   - ToolQualityManager.onDegradationDetected → fixTemplate()
 *   - SessionErrorExtractor.generateSessionErrorReport() → deriveTemplate()
 *   - PlanningIntelligenceEngine.learnFromGap() → captureTemplate()
 *
 * @see upgrade-plan-openspace-fusion.md §4-5
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryWiki } from '../../../../memory/src/index.js';
import type {
  PlanTemplate,
  PlanExecutionRecord,
  PlanNodeSkeleton,
  FailureCategory,
} from './types.js';
import type { PlanExperienceStore } from './PlanExperienceStore.js';

// ═══════════════════════════════════════════════════════════════
// Enums & Types
// ═══════════════════════════════════════════════════════════════

/** Evolution type — aligned with OpenSpace's three modes */
export enum EvolutionType {
  /** Capture brand-new template from successful execution */
  CAPTURED = 'captured',
  /** Derive variant from existing template (add/remove/reorder phases) */
  DERIVED = 'derived',
  /** Fix a template that caused failure (inject validation, adjust timeout, swap tool) */
  FIXED = 'fixed',
}

/** Template evolution lineage record */
export interface TemplateLineage {
  lineageId: string;
  templateId: string;
  evolutionType: EvolutionType;
  parentTemplateId: string | null;
  sourceExecutionId: string;
  triggerReason: string;
  changes: TemplateChange[];
  evolvedAt: number;
  evolvedBy: 'auto' | 'manual';
}

/** A single change in a template evolution */
export interface TemplateChange {
  type: 'add_phase' | 'remove_phase' | 'reorder_phase' | 'modify_phase' | 'add_validation';
  targetPhase: string;
  before: unknown;
  after: unknown;
  reason: string;
}

/** Configuration for TemplateManager */
export interface EvolutionConfig {
  captureMinScore: number;
  captureMinExecutions: number;
  maxDerivationsPerTemplate: number;
  useLLMForFix: boolean;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  captureMinScore: 0.7,
  captureMinExecutions: 3,
  maxDerivationsPerTemplate: 5,
  useLLMForFix: false,
};

/** Stats payload stored in stats.json */
export interface TemplateStats {
  successRate: number;
  usageCount: number;
  avgDurationMs: number;
  avgTokensUsed: number;
  qualityScore: number;
  lastUsedAt: number;
  version: number;
}

/** Frontmatter metadata for TEMPLATE.md */
export interface TemplateFrontmatter {
  template_id: string;
  domain: string;
  strategy: string;
  evolution_type: string;
  parent_template: string | null;
  created_at: string;
  version: number;
  quality_score: number;
  success_rate: number;
  total_executions: number;
  avg_duration_ms: number;
  avg_tokens: number;
}

/** TemplateFileSystem metadata */
export interface TemplateMeta {
  templateId: string;
  domain: string;
  name: string;
  version: number;
  qualityScore: number;
  successRate: number;
  lastExportedAt: number;
  directoryPath: string;
}

// ═══════════════════════════════════════════════════════════════
// TemplateManager
// ═══════════════════════════════════════════════════════════════

export class TemplateManager {
  private wiki: MemoryWiki | null = null;
  private store: PlanExperienceStore;
  private config: EvolutionConfig;
  private lineages: Map<string, TemplateLineage[]> = new Map();
  private basePath: string;
  private lineagesPath: string;

  constructor(
    store: PlanExperienceStore,
    config?: Partial<EvolutionConfig>,
    basePath: string = './data/planning/templates',
  ) {
    this.store = store;
    this.config = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
    this.basePath = basePath;
    this.lineagesPath = path.join(this.basePath, '..', 'template-lineages.jsonl');
    this.loadLineages().catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════
  // === EVOLUTION OPERATIONS ===
  // ═══════════════════════════════════════════════════════════════

  /**
   * captureFromExecution — Capture a new template from a successful execution record.
   *
   * Conditions:
   *   1. Execution succeeded (record.success === true)
   *   2. Score exceeds threshold (record.score >= captureMinScore)
   *   3. No existing template with similarity > 80% (avoid duplicates)
   *
   * @param record - Successful execution record
   * @returns The captured template, or null if conditions not met
   */
  async captureFromExecution(record: PlanExecutionRecord): Promise<PlanTemplate | null> {
    if (!record.success || record.score < this.config.captureMinScore) {
      return null;
    }

    const existingSimilar = this.store.findSimilarTemplates(record.userInput, record.inputTags);
    const tooSimilar = existingSimilar.find(m => m.similarityScore > 0.8);
    if (tooSimilar) {
      return this.updateExistingTemplate(tooSimilar.template, record);
    }

    const nodeSkeletons: PlanNodeSkeleton[] = record.dagNodes.map(node => ({
      role: node.role,
      domain: node.domain,
      deps: [],
      expectedArtifacts: node.artifactUris.length > 0 ? ['*'] : [],
      optional: node.status === 'skipped',
      typicalTimeoutMs: node.durationMs > 0 ? Math.max(node.durationMs * 1.5, 30000) : undefined,
    }));

    const template: PlanTemplate = {
      templateId: `tpl_captured_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: this.inferTemplateName(record),
      description: `Auto-captured from execution ${record.executionId} (score: ${record.score.toFixed(2)})`,
      tags: [...record.inputTags],
      nodeSkeletons,
      successRate: 1.0,
      avgDurationMs: record.totalDurationMs,
      avgTokensUsed: record.totalTokensUsed,
      usageCount: 1,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      sourceExecutionIds: [record.executionId],
      version: 1,
      qualityScore: record.score,
    };

    await this.store.saveTemplate(template);

    this.recordLineage({
      lineageId: `lin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      templateId: template.templateId,
      evolutionType: EvolutionType.CAPTURED,
      parentTemplateId: null,
      sourceExecutionId: record.executionId,
      triggerReason: `Execution succeeded (score=${record.score.toFixed(2)}, duration=${record.totalDurationMs}ms)`,
      changes: [{
        type: 'add_phase',
        targetPhase: 'all',
        before: null,
        after: nodeSkeletons,
        reason: 'Captured from successful execution',
      }],
      evolvedAt: Date.now(),
      evolvedBy: 'auto',
    });

    // ★ Auto-export to filesystem
    await this.exportTemplate(template).catch((err: unknown) =>
      console.error(`[TemplateManager] Filesystem export failed:`, err)
    );

    return template;
  }

  /**
   * deriveFromParent — Derive a template variant from a parent template.
   */
  async deriveFromParent(
    parentId: string,
    modifications: TemplateChange[],
  ): Promise<PlanTemplate | null> {
    const parent = this.store.getTemplate(parentId);
    if (!parent) {
      console.warn(`[TemplateManager] Parent template not found: ${parentId}`);
      return null;
    }

    const existingDerivations = this.getLineage(parentId)
      .filter(l => l.evolutionType === EvolutionType.DERIVED);
    if (existingDerivations.length >= this.config.maxDerivationsPerTemplate) {
      console.warn(`[TemplateManager] Template ${parentId} has reached max derivations`);
      return null;
    }

    const newSkeletons = this.applyModifications(parent.nodeSkeletons, modifications);
    const template: PlanTemplate = {
      ...parent,
      templateId: `tpl_derived_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: `${parent.name} (variant ${existingDerivations.length + 1})`,
      description: `Derived from ${parent.name}: ${modifications.map(m => m.reason).join('; ')}`,
      nodeSkeletons: newSkeletons,
      successRate: parent.successRate * 0.9,
      usageCount: 0,
      lastUsedAt: 0,
      createdAt: Date.now(),
      sourceExecutionIds: [],
      version: 1,
      qualityScore: parent.qualityScore * 0.85,
    };

    await this.store.saveTemplate(template);
    this.recordLineage({
      lineageId: `lin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      templateId: template.templateId,
      evolutionType: EvolutionType.DERIVED,
      parentTemplateId: parentId,
      sourceExecutionId: '',
      triggerReason: modifications.map(m => m.reason).join('; '),
      changes: modifications,
      evolvedAt: Date.now(),
      evolvedBy: 'auto',
    });

    await this.exportTemplate(template).catch((err: unknown) =>
      console.error(`[TemplateManager] Filesystem export failed:`, err)
    );

    return template;
  }

  /**
   * fixTemplate — Fix a template that caused execution failure.
   *
   * Fix strategies (heuristic, no LLM needed):
   *   token_exhaustion → add ContextPruner validation phase
   *   timeout → increase timeout config
   *   validation_failure → inject validation checkpoint
   *   dependency_missing → add dependency check phase
   *   tool_error / mcp_crash → add health check phase
   */
  async fixTemplate(
    templateId: string,
    failureRecord?: PlanExecutionRecord,
  ): Promise<PlanTemplate | null> {
    const template = this.store.getTemplate(templateId);
    if (!template) {
      console.warn(`[TemplateManager] Template not found for fix: ${templateId}`);
      return null;
    }

    const errorCategory: FailureCategory =
      failureRecord?.failureDetails?.[0]?.category ?? 'unknown';
    const modifications = this.diagnoseFix(errorCategory, failureRecord);

    if (modifications.length === 0) {
      console.log(`[TemplateManager] No fix needed: ${templateId} (category=${errorCategory})`);
      return null;
    }

    const newSkeletons = this.applyModifications(template.nodeSkeletons, modifications);
    const fixedTemplate: PlanTemplate = {
      ...template,
      nodeSkeletons: newSkeletons,
      version: template.version + 1,
      qualityScore: Math.max(0.3, template.qualityScore - 0.1),
      description: `${template.description}\n[FIXED v${template.version + 1}]: ${modifications.map(m => m.reason).join('; ')}`,
      createdAt: Date.now(),
    };

    await this.store.saveTemplate(fixedTemplate);
    this.recordLineage({
      lineageId: `lin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      templateId,
      evolutionType: EvolutionType.FIXED,
      parentTemplateId: templateId,
      sourceExecutionId: failureRecord?.executionId ?? '',
      triggerReason: `Failure fix: ${errorCategory}`,
      changes: modifications,
      evolvedAt: Date.now(),
      evolvedBy: 'auto',
    });

    // ★ Auto-export to filesystem (in-place overwrite)
    await this.exportTemplate(fixedTemplate).catch((err: unknown) =>
      console.error(`[TemplateManager] Filesystem export failed:`, err)
    );

    return fixedTemplate;
  }

  // ═══════════════════════════════════════════════════════════════
  // Lineage Management
  // ═══════════════════════════════════════════════════════════════

  private recordLineage(lineage: TemplateLineage): void {
    if (!this.lineages.has(lineage.templateId)) {
      this.lineages.set(lineage.templateId, []);
    }
    this.lineages.get(lineage.templateId)!.push(lineage);
  }

  getLineage(templateId: string): TemplateLineage[] {
    return this.lineages.get(templateId) ?? [];
  }

  getAncestors(templateId: string): TemplateLineage[] {
    const result: TemplateLineage[] = [];
    const visited = new Set<string>();
    const walk = (currentId: string): void => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      const directLineage = this.getLineage(currentId);
      for (const entry of directLineage) {
        if (entry.parentTemplateId && entry.parentTemplateId !== currentId) {
          result.push(entry);
          walk(entry.parentTemplateId);
        }
      }
    };
    walk(templateId);
    return result;
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  private async loadLineages(limit = 1000): Promise<void> {
    // ★ SQLite 优先
    if (this.wiki?.ready) {
      try {
        const rows = this.wiki.getTemplateLineages(undefined, limit) as Record<string, unknown>[];
        if (rows.length > 0) {
          for (const row of rows) {
            const lineage: TemplateLineage = {
              lineageId: `tli_${row.timestamp}_${Math.random().toString(36).slice(2, 6)}`,
              templateId: (row.template_id as string) ?? '',
              evolutionType: (row.evolution_type as EvolutionType) ?? EvolutionType.CAPTURED,
              parentTemplateId: (row.parent_template_id as string) ?? null,
              sourceExecutionId: '',
              triggerReason: (row.evolution_reason as string) ?? '',
              changes: [],
              evolvedAt: (row.timestamp as number) ?? Date.now(),
              evolvedBy: 'auto',
            };
            if (!this.lineages.has(lineage.templateId)) {
              this.lineages.set(lineage.templateId, []);
            }
            this.lineages.get(lineage.templateId)!.push(lineage);
          }
          console.log(`[TemplateManager] Restored ${rows.length} lineages from SQLite`);
          return;
        }
      } catch { /* fallback to JSONL */ }
    }

    try {
      const content = await fsp.readFile(this.lineagesPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean).slice(-limit);
      for (const line of lines) {
        try {
          const lineage: TemplateLineage = JSON.parse(line);
          if (!this.lineages.has(lineage.templateId)) {
            this.lineages.set(lineage.templateId, []);
          }
          this.lineages.get(lineage.templateId)!.push(lineage);
        } catch { /* skip invalid lines */ }
      }
    } catch { /* no persisted lineages */ }
  }

  getEvolutionStats(): { captured: number; derived: number; fixed: number } {
    let captured = 0, derived = 0, fixed = 0;
    for (const lineages of this.lineages.values()) {
      for (const l of lineages) {
        if (l.evolutionType === EvolutionType.CAPTURED) captured++;
        else if (l.evolutionType === EvolutionType.DERIVED) derived++;
        else if (l.evolutionType === EvolutionType.FIXED) fixed++;
      }
    }
    return { captured, derived, fixed };
  }

  getAllLineages(): TemplateLineage[] {
    const result: TemplateLineage[] = [];
    for (const lineages of this.lineages.values()) {
      result.push(...lineages);
    }
    return result.sort((a, b) => a.evolvedAt - b.evolvedAt);
  }

  // ═══════════════════════════════════════════════════════════════
  // === FILESYSTEM OPERATIONS ===
  // ═══════════════════════════════════════════════════════════════

  /**
   * exportTemplate — Export a single template to the filesystem.
   *
   * Creates directory structure: {basePath}/{domain}/{name}/TEMPLATE.md + lineage.json + stats.json
   */
  async exportTemplate(
    template: PlanTemplate,
    lineage?: TemplateLineage[],
  ): Promise<string> {
    const dir = this.templateDir(template);
    await fsp.mkdir(dir, { recursive: true });

    await fsp.writeFile(path.join(dir, '.skill_id'), template.templateId, 'utf-8');

    const md = this.buildTemplateMarkdown(template, lineage);
    await fsp.writeFile(path.join(dir, 'TEMPLATE.md'), md, 'utf-8');

    const stats: TemplateStats = {
      successRate: template.successRate,
      usageCount: template.usageCount,
      avgDurationMs: template.avgDurationMs,
      avgTokensUsed: template.avgTokensUsed,
      qualityScore: template.qualityScore,
      lastUsedAt: template.lastUsedAt,
      version: template.version,
    };
    await fsp.writeFile(path.join(dir, 'stats.json'), JSON.stringify(stats, null, 2), 'utf-8');

    if (lineage && lineage.length > 0) {
      await fsp.writeFile(path.join(dir, 'lineage.json'), JSON.stringify(lineage, null, 2), 'utf-8');
    }

    await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
    return dir;
  }

  /**
   * syncAll — Batch export all templates to the filesystem.
   */
  async syncAll(
    templates: PlanTemplate[],
    getLineage?: (templateId: string) => TemplateLineage[],
  ): Promise<string[]> {
    await fsp.mkdir(this.basePath, { recursive: true });
    const dirs: string[] = [];
    for (const tpl of templates) {
      const lineage = getLineage ? getLineage(tpl.templateId) : undefined;
      dirs.push(await this.exportTemplate(tpl, lineage));
    }
    return dirs;
  }

  /**
   * loadTemplate — Load a template from the filesystem by ID.
   */
  async loadTemplate(templateId: string): Promise<PlanTemplate | null> {
    const dirs = await this.findAllTemplateDirs();
    for (const dir of dirs) {
      try {
        const id = (await fsp.readFile(path.join(dir, '.skill_id'), 'utf-8')).trim();
        if (id === templateId) return this.readTemplateFromDir(dir);
      } catch { /* skip */ }
    }
    return null;
  }

  /**
   * loadAllTemplates — Load all templates from the filesystem.
   */
  async loadAllTemplates(): Promise<PlanTemplate[]> {
    const dirs = await this.findAllTemplateDirs();
    const templates: PlanTemplate[] = [];
    for (const dir of dirs) {
      try {
        const tpl = await this.readTemplateFromDir(dir);
        if (tpl) templates.push(tpl);
      } catch { /* skip */ }
    }
    return templates;
  }

  /**
   * loadLineage — Load lineage for a template from the filesystem.
   */
  async loadLineage(templateId: string): Promise<TemplateLineage[]> {
    const dirs = await this.findAllTemplateDirs();
    for (const dir of dirs) {
      try {
        const id = (await fsp.readFile(path.join(dir, '.skill_id'), 'utf-8')).trim();
        if (id === templateId) {
          const content = await fsp.readFile(path.join(dir, 'lineage.json'), 'utf-8');
          return JSON.parse(content) as TemplateLineage[];
        }
      } catch { /* skip */ }
    }
    return [];
  }

  /**
   * listAllTemplates — Load all templates from the filesystem.
   */
  async listAllTemplates(): Promise<PlanTemplate[]> {
    return this.loadAllTemplates();
  }

  /**
   * diffTemplates — Generate a human-readable diff between template versions.
   */
  async diffTemplates(templateId: string): Promise<string> {
    const lineage = await this.loadLineage(templateId);
    const relevantChanges = lineage.filter(l =>
      l.evolutionType === EvolutionType.FIXED || l.evolutionType === EvolutionType.DERIVED
    );
    if (relevantChanges.length === 0) {
      return `# Diff for ${templateId}\n\nNo changes recorded.`;
    }
    const lines: string[] = [`# Template Diff: ${templateId}`, '', `Total evolution events: ${relevantChanges.length}`, ''];
    for (const entry of relevantChanges) {
      lines.push(`## ${entry.evolutionType.toUpperCase()} (${new Date(entry.evolvedAt).toISOString()})`);
      lines.push(`Reason: ${entry.triggerReason}`, '');
      for (const change of entry.changes) {
        lines.push(`- **${change.type}**: ${change.targetPhase}`, `  Reason: ${change.reason}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * removeTemplate — Remove a template's filesystem directory.
   */
  async removeTemplate(templateId: string): Promise<boolean> {
    const dirs = await this.findAllTemplateDirs();
    for (const dir of dirs) {
      try {
        const id = (await fsp.readFile(path.join(dir, '.skill_id'), 'utf-8')).trim();
        if (id === templateId) {
          await fsp.rm(dir, { recursive: true, force: true });
          return true;
        }
      } catch { /* skip */ }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private: Evolution Helpers
  // ═══════════════════════════════════════════════════════════════

  private inferTemplateName(record: PlanExecutionRecord): string {
    const tags = record.inputTags.slice(0, 3).join('-');
    const roles = record.dagNodes.map(n => n.role).slice(0, 3).join('_');
    return tags ? `${tags}_${roles}` : `${roles}_strategy`;
  }

  private applyModifications(skeletons: PlanNodeSkeleton[], changes: TemplateChange[]): PlanNodeSkeleton[] {
    const result = [...skeletons.map(s => ({ ...s }))];
    for (const change of changes) {
      switch (change.type) {
        case 'add_phase':
        case 'add_validation':
          result.push(change.after as PlanNodeSkeleton);
          break;
        case 'remove_phase': {
          const idx = result.findIndex(s => s.role === change.targetPhase);
          if (idx >= 0) result.splice(idx, 1);
          break;
        }
        case 'modify_phase': {
          const modIdx = result.findIndex(s => s.role === change.targetPhase);
          if (modIdx >= 0) result[modIdx] = { ...result[modIdx], ...(change.after as Partial<PlanNodeSkeleton>) };
          break;
        }
        case 'reorder_phase': {
          const order = change.after as { fromIndex: number; toIndex: number };
          if (order.fromIndex >= 0 && order.fromIndex < result.length && order.toIndex >= 0 && order.toIndex < result.length) {
            const [moved] = result.splice(order.fromIndex, 1);
            result.splice(order.toIndex, 0, moved);
          }
          break;
        }
      }
    }
    return result;
  }

  private diagnoseFix(category: FailureCategory, failureRecord?: PlanExecutionRecord): TemplateChange[] {
    const changes: TemplateChange[] = [];
    const failedNodeId = failureRecord?.failureDetails?.[0]?.nodeId;
    switch (category) {
      case 'token_exhaustion':
        changes.push({ type: 'add_validation', targetPhase: 'before_heavy_compute', before: null, after: { role: 'context_prune', domain: 'general', deps: [], optional: false, expectedArtifacts: ['pruned_context'] }, reason: 'Add ContextPruner phase to prevent token exhaustion' });
        break;
      case 'timeout':
        changes.push({ type: 'modify_phase', targetPhase: failedNodeId ?? 'unknown', before: { typicalTimeoutMs: 30000 }, after: { typicalTimeoutMs: 60000 }, reason: 'Increase timeout from 30s to 60s' });
        break;
      case 'validation_failure':
        changes.push({ type: 'add_validation', targetPhase: 'post_production', before: null, after: { role: 'validate_output', domain: 'testing', deps: ['*'], optional: false, expectedArtifacts: ['validation_report'] }, reason: 'Inject validation checkpoint after production phase' });
        break;
      case 'dependency_missing':
        changes.push({ type: 'add_phase', targetPhase: 'dependency_check', before: null, after: { role: 'check_deps', domain: 'general', deps: [], optional: false, expectedArtifacts: ['dependency_report'] }, reason: 'Add dependency check phase before execution' });
        break;
      case 'tool_error':
      case 'mcp_crash':
        changes.push({ type: 'add_validation', targetPhase: 'tool_health_check', before: null, after: { role: 'health_check', domain: 'general', deps: [], optional: false, expectedArtifacts: ['health_report'] }, reason: 'Add tool health check phase' });
        break;
      default: break;
    }
    return changes;
  }

  private async updateExistingTemplate(existing: PlanTemplate, record: PlanExecutionRecord): Promise<PlanTemplate> {
    existing.usageCount++;
    existing.successRate = (existing.successRate * (existing.usageCount - 1) + (record.success ? 1 : 0)) / existing.usageCount;
    existing.avgDurationMs = Math.round((existing.avgDurationMs * (existing.usageCount - 1) + record.totalDurationMs) / existing.usageCount);
    existing.avgTokensUsed = Math.round((existing.avgTokensUsed * (existing.usageCount - 1) + record.totalTokensUsed) / existing.usageCount);
    existing.lastUsedAt = Date.now();
    existing.sourceExecutionIds.push(record.executionId);
    existing.qualityScore = Math.min(1, existing.qualityScore + 0.01);
    await this.store.saveTemplate(existing);
    return existing;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private: Filesystem Helpers
  // ═══════════════════════════════════════════════════════════════

  private templateDir(template: PlanTemplate): string {
    const domain = template.tags[0] ?? 'general';
    const safeName = template.name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_').slice(0, 60);
    return path.join(this.basePath, domain, safeName);
  }

  private async findAllTemplateDirs(): Promise<string[]> {
    const result: string[] = [];
    try {
      const entries = await fsp.readdir(this.basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const domainPath = path.join(this.basePath, entry.name);
        const subEntries = await fsp.readdir(domainPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory()) {
            const tplPath = path.join(domainPath, sub.name);
            try {
              await fsp.access(path.join(tplPath, '.skill_id'));
              result.push(tplPath);
            } catch { /* not a template dir */ }
          }
        }
      }
    } catch { /* base path doesn't exist */ }
    return result;
  }

  private async readTemplateFromDir(dir: string): Promise<PlanTemplate | null> {
    try {
      const mdContent = await fsp.readFile(path.join(dir, 'TEMPLATE.md'), 'utf-8');
      const statsContent = await fsp.readFile(path.join(dir, 'stats.json'), 'utf-8');
      const stats = JSON.parse(statsContent) as TemplateStats;
      const frontmatter = this.parseFrontmatter(mdContent);
      if (!frontmatter) return null;
      const nodeSkeletons = this.parseNodeSkeletons(mdContent);
      return {
        templateId: frontmatter.template_id,
        name: this.parseTitle(mdContent),
        description: `Template for domain ${frontmatter.domain}`,
        tags: [frontmatter.domain],
        nodeSkeletons,
        successRate: stats.successRate,
        avgDurationMs: stats.avgDurationMs,
        avgTokensUsed: stats.avgTokensUsed,
        usageCount: stats.usageCount,
        lastUsedAt: stats.lastUsedAt,
        createdAt: new Date(frontmatter.created_at).getTime(),
        sourceExecutionIds: [],
        version: stats.version ?? 1,
        qualityScore: stats.qualityScore,
      };
    } catch { return null; }
  }

  private buildTemplateMarkdown(template: PlanTemplate, lineage?: TemplateLineage[]): string {
    const frontmatter: TemplateFrontmatter = {
      template_id: template.templateId,
      domain: template.tags[0] ?? 'general',
      strategy: this.inferStrategy(template),
      evolution_type: 'managed',
      parent_template: null,
      created_at: new Date(template.createdAt).toISOString(),
      version: template.version,
      quality_score: template.qualityScore,
      success_rate: template.successRate,
      total_executions: template.usageCount,
      avg_duration_ms: template.avgDurationMs,
      avg_tokens: template.avgTokensUsed,
    };

    const parts: string[] = [
      '---',
      this.buildYamlFrontmatter(frontmatter),
      '---', '',
      `# ${template.name}`, '', template.description, '',
      '## Strategy', `Domain: ${template.tags.join(', ')}`,
      `This template defines a ${template.nodeSkeletons.length}-phase execution plan.`, '',
      '## DAG Skeleton', '',
    ];

    for (let i = 0; i < template.nodeSkeletons.length; i++) {
      const s = template.nodeSkeletons[i];
      parts.push(`### Phase ${i + 1}: ${s.role} (${s.domain})`);
      parts.push(`- Role: ${s.role}`, `- Domain: ${s.domain}`);
      parts.push(`- Dependencies: [${s.deps.join(', ')}]`);
      parts.push(`- Expected Artifacts: ${s.expectedArtifacts.join(', ')}`);
      parts.push(`- Optional: ${s.optional ?? false}`);
      if (s.typicalTimeoutMs) parts.push(`- Typical Timeout: ${s.typicalTimeoutMs}ms`);
      parts.push('');
    }

    parts.push('## Historical Performance');
    parts.push('| Metric | Value |', '|--------|-------|');
    parts.push(`| Success Rate | ${(template.successRate * 100).toFixed(1)}% (${template.usageCount} executions) |`);
    parts.push(`| Avg Duration | ${template.avgDurationMs}ms |`);
    parts.push(`| Avg Tokens | ${template.avgTokensUsed.toLocaleString()} |`);
    parts.push(`| Quality Score | ${(template.qualityScore * 100).toFixed(1)}% |`);
    parts.push(`| Version | ${template.version} |`, '');

    if (lineage && lineage.length > 0) {
      parts.push('## Evolution History', '');
      for (const entry of lineage) {
        const date = new Date(entry.evolvedAt).toISOString().slice(0, 10);
        const changes = entry.changes.map(c => `- ${c.type}: ${c.reason}`).join('\n');
        parts.push(`### v${template.version} (${date}): ${entry.evolutionType.toUpperCase()}`, '', `Trigger: ${entry.triggerReason}`, '', changes, '');
      }
    }

    const fixes = lineage?.filter(l => l.evolutionType === 'fixed') ?? [];
    if (fixes.length > 0) {
      parts.push('## Failure Patterns Mitigated', '');
      for (const fix of fixes) {
        const date = new Date(fix.evolvedAt).toISOString().slice(0, 10);
        parts.push(`- \`${fix.triggerReason}\` → mitigated (${date})`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  private buildYamlFrontmatter(fm: TemplateFrontmatter): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(fm)) {
      if (value === null) lines.push(`${key}: null`);
      else if (typeof value === 'string' && (value.includes(':') || value.includes('#'))) lines.push(`${key}: "${value}"`);
      else lines.push(`${key}: ${value}`);
    }
    return lines.join('\n');
  }

  private inferStrategy(template: PlanTemplate): string {
    const roles = template.nodeSkeletons.map(s => s.role);
    if (roles.some(r => r.includes('validate') || r.includes('test'))) return 'validation_first';
    if (roles.some(r => r.includes('research') || r.includes('analysis'))) return 'research_first';
    if (roles.some(r => r.includes('deploy') || r.includes('release'))) return 'build_first';
    return 'balanced';
  }

  private parseFrontmatter(md: string): TemplateFrontmatter | null {
    const match = md.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const yaml = match[1];
    const fm: Partial<TemplateFrontmatter> = {};
    for (const line of yaml.split('\n')) {
      const kvMatch = line.match(/^(\w+):\s*(.+)$/);
      if (!kvMatch) continue;
      const key = kvMatch[1] as keyof TemplateFrontmatter;
      let value: string | number | null = kvMatch[2].trim();
      if (value === 'null') value = null;
      else if (!isNaN(Number(value))) value = Number(value);
      else value = value.replace(/^"(.*)"$/, '$1');
      (fm as any)[key] = value;
    }
    if (!fm.template_id) return null;
    return {
      template_id: fm.template_id ?? '',
      domain: fm.domain ?? 'general',
      strategy: fm.strategy ?? 'balanced',
      evolution_type: fm.evolution_type ?? 'managed',
      parent_template: fm.parent_template ?? null,
      created_at: fm.created_at ?? new Date().toISOString(),
      version: (fm.version as number) ?? 1,
      quality_score: (fm.quality_score as number) ?? 0.5,
      success_rate: (fm.success_rate as number) ?? 0,
      total_executions: (fm.total_executions as number) ?? 0,
      avg_duration_ms: (fm.avg_duration_ms as number) ?? 0,
      avg_tokens: (fm.avg_tokens as number) ?? 0,
    };
  }

  private parseTitle(md: string): string {
    const match = md.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : 'Untitled Template';
  }

  private parseNodeSkeletons(md: string): PlanNodeSkeleton[] {
    const skeletons: PlanNodeSkeleton[] = [];
    const phaseRegex = /### Phase \d+:\s*([^(]+)\s*\(([^)]+)\)\n([\s\S]*?)(?=\n###|\n##|\n$)/g;
    let match: RegExpExecArray | null;
    while ((match = phaseRegex.exec(md)) !== null) {
      const role = match[1].trim();
      const domain = match[2].trim();
      const body = match[3];
      const deps: string[] = [];
      const expectedArtifacts: string[] = [];
      let optional = false;
      let typicalTimeoutMs: number | undefined;
      const depMatch = body.match(/- Dependencies:\s*\[([^\]]*)\]/);
      if (depMatch) deps.push(...depMatch[1].split(',').map(s => s.trim()).filter(Boolean));
      const artMatch = body.match(/- Expected Artifacts:\s*(.+)/);
      if (artMatch) expectedArtifacts.push(...artMatch[1].split(',').map(s => s.trim()).filter(Boolean));
      const optMatch = body.match(/- Optional:\s*(true|false)/);
      if (optMatch) optional = optMatch[1] === 'true';
      const timeoutMatch = body.match(/- Typical Timeout:\s*(\d+)ms/);
      if (timeoutMatch) typicalTimeoutMs = parseInt(timeoutMatch[1], 10);
      skeletons.push({ role, domain, deps, expectedArtifacts, optional, typicalTimeoutMs });
    }
    return skeletons;
  }
}
