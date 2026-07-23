/**
 * Architecture Auditor — 架构合规审计器
 *
 * 对比 ARCHITECTURE_CONTRACT 与运行时 ExecutionTracer 数据：
 *   1. 必须调用的模块是否被调用
 *   2. 期望的调用者/被调用者是否匹配
 *   3. 生成合规报告（ok/warning/error）
 */

import type { ModuleContract } from './architecture-contract.js';
import { ARCHITECTURE_CONTRACT } from './architecture-contract.js';
import { ObservationCollector } from './observation.js';
import type { Observation } from './observation.js';

export interface AuditFinding {
  module: string;
  severity: 'ok' | 'warning' | 'error';
  issue: string;
  detail: string;
  expectedCallers: string[];
  actualCallers: string[];
  expectedCallees: string[];
  actualCallees: string[];
}

export interface ArchitectureAuditReport {
  timestamp: number;
  totalModules: number;
  findings: AuditFinding[];
  summary: { ok: number; warning: number; error: number };
  healthScore: number;
}

export interface AuditOptions {
  /** Enable strict mode: bootstrapped modules (exercised but zero callers) become WARNINGs */
  strict?: boolean;
}

export class ArchitectureAuditor {
  private contract: ModuleContract[];

  constructor(contract?: ModuleContract[]) {
    this.contract = contract ?? ARCHITECTURE_CONTRACT;
  }

  /** Run audit against span data and module tracker */
  audit(spans: Observation[], options?: AuditOptions): ArchitectureAuditReport {
    const findings: AuditFinding[] = [];
    const strict = options?.strict ?? false;

    // Build actual caller/callee maps from span tree
    const actualCallers = new Map<string, Set<string>>();
    const actualCallees = new Map<string, Set<string>>();

    for (const span of spans) {
      const parent = spans.find(s => s.id === span.parentId);
      if (parent) {
        const child = span.source.module;
        const par = parent.source.module;

        if (!actualCallers.has(child)) actualCallers.set(child, new Set());
        actualCallers.get(child)!.add(par);

        if (!actualCallees.has(par)) actualCallees.set(par, new Set());
        actualCallees.get(par)!.add(child);
      }
    }

    for (const c of this.contract) {
      const exercised = ObservationCollector.getExercisedModules().has(c.name);
      const callers = [...(actualCallers.get(c.name) ?? [])];
      const callees = [...(actualCallees.get(c.name) ?? [])];

      // Error: required but never called
      if (c.required && !exercised) {
        findings.push({
          module: c.name, severity: 'error',
          issue: 'REQUIRED_MODULE_NEVER_CALLED',
          detail: `${c.name} (${c.activation}) is required but never called`,
          expectedCallers: c.expectedCallers, actualCallers: callers,
          expectedCallees: c.expectedCallees, actualCallees: callees,
        });
        continue;
      }

      // Warning: expected callers not observed
      // In non-strict mode: if module is exercised with zero actual callers, it was bootstrapped (valid)
      // In strict mode: bootstrapped modules with expectedCallers are flagged as warning
      if (c.expectedCallers.length > 0 && exercised) {
        if (callers.length === 0 && strict) {
          findings.push({
            module: c.name, severity: 'warning',
            issue: 'BOOTSTRAPPED_NO_CALLERS',
            detail: `${c.name} exercised via bootstrap (no parent span), expected callers [${c.expectedCallers.join(', ')}]`,
            expectedCallers: c.expectedCallers, actualCallers: callers,
            expectedCallees: c.expectedCallees, actualCallees: callees,
          });
          continue;
        }
        if (callers.length > 0) {
          const missing = c.expectedCallers.filter(e => !callers.includes(e));
          if (missing.length > 0) {
            findings.push({
              module: c.name, severity: 'warning',
              issue: 'EXPECTED_CALLER_NOT_OBSERVED',
              detail: `${c.name} expected callers [${missing.join(', ')}] not observed`,
              expectedCallers: c.expectedCallers, actualCallers: callers,
              expectedCallees: c.expectedCallees, actualCallees: callees,
            });
            continue;
          }
        }
      }

      // Warning: expected callees not observed
      // In non-strict mode: if module is exercised with zero actual callees, it was bootstrapped (valid)
      // In strict mode: bootstrapped modules with expectedCallees are flagged as warning
      if (c.expectedCallees.length > 0 && exercised) {
        if (callees.length === 0 && strict) {
          findings.push({
            module: c.name, severity: 'warning',
            issue: 'BOOTSTRAPPED_NO_CALLEES',
            detail: `${c.name} exercised via bootstrap (no child span), expected to call [${c.expectedCallees.join(', ')}]`,
            expectedCallers: c.expectedCallers, actualCallers: callers,
            expectedCallees: c.expectedCallees, actualCallees: callees,
          });
          continue;
        }
        if (callees.length > 0) {
          const missing = c.expectedCallees.filter(e => !callees.includes(e));
          if (missing.length > 0) {
            findings.push({
              module: c.name, severity: 'warning',
              issue: 'EXPECTED_CALLEE_NOT_OBSERVED',
              detail: `${c.name} expected to call [${missing.join(', ')}] but did not`,
              expectedCallers: c.expectedCallers, actualCallers: callers,
              expectedCallees: c.expectedCallees, actualCallees: callees,
            });
            continue;
          }
        }
      }

      // OK
      const chainType = exercised
        ? (callers.length > 0 ? 'traced' : 'bootstrap')
        : 'inactive';
      findings.push({
        module: c.name, severity: 'ok', issue: chainType === 'traced' ? 'CHAIN_VERIFIED' : 'OK',
        detail: exercised
          ? (callers.length > 0
            ? `Called by [${callers.join(', ')}] → verified`
            : `Called by [bootstrap]`)
          : 'Not required, not called',
        expectedCallers: c.expectedCallers, actualCallers: callers,
        expectedCallees: c.expectedCallees, actualCallees: callees,
      });
    }

    const ok = findings.filter(f => f.severity === 'ok').length;
    const warn = findings.filter(f => f.severity === 'warning').length;
    const err = findings.filter(f => f.severity === 'error').length;

    return {
      timestamp: Date.now(),
      totalModules: this.contract.length,
      findings,
      summary: { ok, warning: warn, error: err },
      healthScore: Math.round((ok * 100) / Math.max(ok + warn + err, 1)),
    };
  }
}
