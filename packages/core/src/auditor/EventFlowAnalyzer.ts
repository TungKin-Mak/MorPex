/**
 * EventFlowAnalyzer v3.2 — Hybrid Event Detection
 *
 * Core events from hardcoded list, supplemented by dynamic discovery.
 * Only reports gaps for events that have at least one active side.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModuleInfo, EventFlowInfo } from './types.js';

const CORE_EVENTS = [
  'kernel.started','gateway.adapter.registered','gateway.harness.attached',
  'runtime.execution.started','runtime.execution.completed','runtime.execution.failed','runtime.execution.aborted',
  'artifact.created','artifact.updated','artifact.status_changed','artifact.relation_created',
  'knowledge.entity_added','knowledge.relation_added','knowledge.imported',
  'knowledge.import.artifact','knowledge.import.memory','knowledge.import.execution',
  'knowledge.search','knowledge.path','knowledge.neighborhood','knowledge.get_stats',
  'memory.activated','harness.ready','harness.executing','harness.context-updated',
  'harness.disposed','harness.artifact-registered','harness.memory-search','harness.knowledge-query',
  'metaplanner.plan_started','metaplanner.plan_completed',
  'workflow.step_started','workflow.step_completed',
];

export class EventFlowAnalyzer {
  analyze(modules: ModuleInfo[], srcRoot: string): EventFlowInfo[] {
    const contentMap = new Map<string, string>();
    for (const m of modules) {
      if (m.type !== 'test') {
        try { contentMap.set(m.path, fs.readFileSync(path.join(srcRoot, m.path), 'utf-8')); } catch {}
      }
    }

    // Pre-compute which files have emit or on patterns
    const emitterFiles = new Set<string>();
    const listenerFiles = new Set<string>();
    for (const [fp, ct] of contentMap) {
      if (/\.emit\s*\(/.test(ct) || /emitEvent\s*\(/.test(ct)) emitterFiles.add(fp);
      if (/\.on\s*\(/.test(ct) || /\.subscribe(?:To)?\s*\(/.test(ct)) listenerFiles.add(fp);
    }

    // Also detect plugin-style listeners (switch-case on event type)
    for (const [fp, ct] of contentMap) {
      if (/case\s+['"`][\w.-]+['"`]\s*:/.test(ct)) listenerFiles.add(fp);
    }

    const results: EventFlowInfo[] = [];

    for (const eventType of CORE_EVENTS) {
      const emitters: string[] = [];
      const listeners: string[] = [];
      let isPersisted = false;

      for (const [fp, ct] of contentMap) {
        if (!ct.includes(eventType)) continue;
        if (emitterFiles.has(fp)) emitters.push(fp);
        if (listenerFiles.has(fp)) listeners.push(fp);
        if ((fp.includes('EventStore') || fp.includes('Mirror')) && /append|persist/.test(ct)) {
          isPersisted = true;
        }
      }

      let gap: string | null = null;
      if (emitters.length === 0 && listeners.length === 0) gap = 'unused';
      else if (emitters.length === 0) gap = 'listener-no-emitter';
      else if (listeners.length === 0) gap = 'emitter-no-listener';

      results.push({ eventType, emitters, listeners, isPersisted, gap });
    }

    return results;
  }

  buildSubscriberMap(modules: ModuleInfo[], srcRoot: string): Map<string, string[]> {
    const subscribers = new Map<string, string[]>();
    for (const mod of modules) {
      if (mod.type !== 'implementation') continue;
      try {
        const content = fs.readFileSync(path.join(srcRoot, mod.path), 'utf-8');
        const events: string[] = [];
        const onRegex = /\.(?:on|subscribe(?:To)?)\s*\(\s*['"`]([\w.-]+)['"`]/g;
        let m: RegExpExecArray | null;
        while ((m = onRegex.exec(content)) !== null) events.push(m[1]);
        const caseRegex = /case\s+['"`]([\w.-]+)['"`]\s*:/g;
        while ((m = caseRegex.exec(content)) !== null) events.push(m[1]);
        if (events.length > 0) subscribers.set(mod.path, events);
      } catch {}
    }
    return subscribers;
  }
}
