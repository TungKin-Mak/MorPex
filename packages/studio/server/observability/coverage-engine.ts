/**
 * CoverageEngine — 基于 Observation 的覆盖率引擎（v2，替代旧的 buffer 扫描版）
 *
 * 从 ObservationCollector 的数据计算：
 *   - 模块健康（调用次数、延迟分位数、错误率、状态）
 *   - 路径覆盖（实际调用链 vs 全部可能）
 *   - 数据流完整度
 *   - 自动调用拓扑
 *
 * 使用方式：
 *   const engine = new CoverageEngine();
 *   engine.feed(observations);
 *   const report = engine.calculate();
 */

import { ObservationCollector } from './observation.js';
import { DEFAULT_MODULES } from './types.js';

export type ModuleStatus = 'active' | 'dormant' | 'never-called' | 'broken';

export interface ModuleHealth {
  name: string;
  layer: string;
  called: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  lastCalledAt: number | null;
  callers: string[];
  callees: string[];
  status: ModuleStatus;
}

export interface CoverageReportV2 {
  timestamp: number;
  totalModules: number;
  calledModules: number;
  moduleCoverage: number;
  pathCoverage: number;
  dataFlowCompleteness: number;
  moduleHealth: ModuleHealth[];
  topology: Array<{ from: string; to: string; count: number }>;
  topLatencyModules: Array<{ name: string; avgMs: number; p95Ms: number }>;
  errorProneModules: Array<{ name: string; errorRate: number; errors: number }>;
}

export interface CoverageSnapshot {
  moduleCoverage: number;
  pathCoverage: Record<string, number>;
  dataFlowCoverage: number;
  totalModules: number;
  activatedModules: number;
  unusedModules: string[];
}

export class CoverageEngine {
  /** Calculate v2 coverage report (span-based) */
  calculate(): CoverageReportV2 {
    const registered = new Set(DEFAULT_MODULES.map(m => m.name));
    const called = ObservationCollector.getExercisedModules();
    const obs = ObservationCollector.getObservations(10000);

    // Group by module
    const byModule = new Map<string, typeof obs>();
    for (const o of obs) {
      const list = byModule.get(o.source.module) || [];
      list.push(o);
      byModule.set(o.source.module, list);
    }

    // Build caller/callee maps
    const callerMap = new Map<string, Set<string>>();
    const calleeMap = new Map<string, Set<string>>();
    const transitions = new Map<string, number>();

    for (const o of obs) {
      if (o.parentId) {
        const parent = obs.find(p => p.id === o.parentId);
        if (parent) {
          const key = `${parent.source.module}→${o.source.module}`;
          transitions.set(key, (transitions.get(key) || 0) + 1);
          if (!callerMap.has(o.source.module)) callerMap.set(o.source.module, new Set());
          callerMap.get(o.source.module)!.add(parent.source.module);
          if (!calleeMap.has(parent.source.module)) calleeMap.set(parent.source.module, new Set());
          calleeMap.get(parent.source.module)!.add(o.source.module);
        }
      }
    }

    // Per-module health
    const health: ModuleHealth[] = [];
    for (const name of registered) {
      const modObs = byModule.get(name) || [];
      const lats = modObs.filter(o => o.duration).map(o => o.duration!).sort((a, b) => a - b);
      const success = modObs.filter(o => o.status === 'success').length;
      const errors = modObs.filter(o => o.status === 'failed').length;
      const avg = lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;
      const p50 = lats[Math.floor(lats.length * 0.5)] || 0;
      const p95 = lats[Math.floor(lats.length * 0.95)] || 0;

      let status: ModuleStatus = 'never-called';
      if (called.has(name)) {
        if (errors > success) status = 'broken';
        else if (modObs.length > 0) status = 'active';
        else status = 'dormant';
      }

      health.push({
        name, layer: modObs[0]?.source?.layer || 'unknown',
        called: modObs.length, successCount: success, errorCount: errors,
        avgLatencyMs: avg, p50LatencyMs: p50, p95LatencyMs: p95,
        lastCalledAt: modObs.length > 0 ? Math.max(...modObs.map(o => o.timestamp)) : null,
        callers: [...(callerMap.get(name) ?? [])],
        callees: [...(calleeMap.get(name) ?? [])],
        status,
      });
    }

    const modCoverage = called.size / Math.max(registered.size, 1);
    const pathCoverage = registered.size > 0 ? transitions.size / (registered.size * registered.size) : 0;
    const completeObs = obs.filter(o => o.payload !== undefined && o.payload !== null);
    const dataFlow = obs.length > 0 ? completeObs.length / obs.length : 0;

    const topology = [...transitions.entries()]
      .map(([k, c]) => { const [f, t] = k.split('→'); return { from: f, to: t, count: c }; })
      .sort((a, b) => b.count - a.count);

    const topLat = health.filter(m => m.called > 0).sort((a, b) => b.avgLatencyMs - a.avgLatencyMs).slice(0, 10)
      .map(m => ({ name: m.name, avgMs: m.avgLatencyMs, p95Ms: m.p95LatencyMs }));

    const errMods = health.filter(m => m.errorCount > 0)
      .map(m => ({ name: m.name, errorRate: m.called > 0 ? m.errorCount / m.called : 0, errors: m.errorCount }))
      .sort((a, b) => b.errorRate - a.errorRate).slice(0, 10);

    return {
      timestamp: Date.now(),
      totalModules: registered.size, calledModules: called.size,
      moduleCoverage: modCoverage, pathCoverage, dataFlowCompleteness: dataFlow,
      moduleHealth: health, topology,
      topLatencyModules: topLat, errorProneModules: errMods,
    };
  }

  /** Legacy v1 compat — calculate coverage snapshot (now delegates to v2) */
  calculateLegacy(): CoverageSnapshot {
    const v2 = this.calculate();
    const transitions: Record<string, number> = {};
    for (const t of v2.topology) {
      const key = `${t.from} → ${t.to}`;
      transitions[key] = t.count;
    }
    return {
      moduleCoverage: v2.moduleCoverage,
      pathCoverage: transitions,
      dataFlowCoverage: v2.dataFlowCompleteness,
      totalModules: v2.totalModules,
      activatedModules: v2.calledModules,
      unusedModules: v2.moduleHealth.filter(m => m.status === 'never-called').map(m => m.name),
    };
  }
}
