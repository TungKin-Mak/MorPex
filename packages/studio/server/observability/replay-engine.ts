/**
 * ReplayEngine — 执行追踪回放引擎
 *
 * 归档 TraceSpan、回放调用时间线、对比两次执行差异。
 * 用于回归测试和性能分析。
 */

import type { Observation } from './observation.js';

export interface ReplaySession {
  id: string;
  originalTaskId: string;
  spans: Observation[];
  createdAt: number;
  replayedAt?: number;
  status: 'pending' | 'replaying' | 'completed' | 'failed';
}

export interface ReplayTimeline {
  time: number;
  module: string;
  operation: string;
  duration: number;
}

export interface ReplayDiff {
  addedModules: string[];
  removedModules: string[];
  latencyDiffs: Array<{ module: string; beforeMs: number; afterMs: number; deltaMs: number }>;
}

export class ReplayEngine {
  private sessions = new Map<string, ReplaySession>();
  private spanArchive: Observation[] = [];

  /** Archive spans from a completed execution */
  archive(taskId: string, spans: Observation[]): ReplaySession {
    const session: ReplaySession = {
      id: `replay_${taskId}_${Date.now()}`,
      originalTaskId: taskId,
      spans: [...spans],
      createdAt: Date.now(),
      status: 'pending',
    };
    this.sessions.set(session.id, session);
    this.spanArchive.push(...spans);
    return session;
  }

  listSessions(): ReplaySession[] {
    return [...this.sessions.values()];
  }

  getSession(id: string): ReplaySession | undefined {
    return this.sessions.get(id);
  }

  /** Replay a session — reconstruct call timeline */
  replay(sessionId: string): {
    timeline: ReplayTimeline[];
    modulesCalled: string[];
    totalDuration: number;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'replaying';
    session.replayedAt = Date.now();

    const sorted = [...session.spans].sort((a, b) => a.timestamp - b.timestamp);
    const base = sorted[0]?.timestamp || 0;

    const timeline: ReplayTimeline[] = sorted.map(s => ({
      time: s.timestamp - base,
      module: s.source.module,
      operation: s.operation,
      duration: s.duration || 0,
    }));

    const modulesCalled = [...new Set(sorted.map(s => s.source.module))];
    const totalDuration = sorted.length > 0
      ? Math.max(...sorted.map(s => (s.timestamp + (s.duration || 0)))) - base
      : 0;

    session.status = 'completed';
    return { timeline, modulesCalled, totalDuration };
  }

  /** Diff two replay sessions */
  diff(sessionIdA: string, sessionIdB: string): ReplayDiff | null {
    const a = this.replay(sessionIdA);
    const b = this.replay(sessionIdB);
    if (!a || !b) return null;

    const modsA = new Set(a.modulesCalled);
    const modsB = new Set(b.modulesCalled);

    const addedModules = b.modulesCalled.filter(m => !modsA.has(m));
    const removedModules = a.modulesCalled.filter(m => !modsB.has(m));

    const latA = new Map<string, number>();
    const latB = new Map<string, number>();
    for (const t of a.timeline) latA.set(t.module, (latA.get(t.module) || 0) + t.duration);
    for (const t of b.timeline) latB.set(t.module, (latB.get(t.module) || 0) + t.duration);

    const diffs: ReplayDiff['latencyDiffs'] = [];
    for (const mod of new Set([...latA.keys(), ...latB.keys()])) {
      const before = latA.get(mod) || 0;
      const after = latB.get(mod) || 0;
      if (before !== after) diffs.push({ module: mod, beforeMs: before, afterMs: after, deltaMs: after - before });
    }
    diffs.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs));

    return { addedModules, removedModules, latencyDiffs: diffs };
  }

  getStats(): { totalSessions: number; totalSpansArchived: number } {
    return { totalSessions: this.sessions.size, totalSpansArchived: this.spanArchive.length };
  }
}
