/**
 * Observability REST API — Debug 前端数据接口
 *
 * 为 /debug 页面提供所有数据：
 *   - 实时事件流（WebSocket 替代 SSE）
 *   - 覆盖率统计
 *   - 运行时图
 *   - 任务时间线
 *   - 合成任务生成
 *   - 系统统计
 */

import { Router, type Request, type Response } from 'express';
import { traceBus } from './event-bus';
import { CoverageEngine } from './coverage-engine';
import { GraphBuilder } from './graph-builder';
import { taskGenerator } from './task-generator';
import { DEFAULT_MODULES } from './types';
import { ObservationCollector } from './observation.js';
import { exerciseAllFromGlobal, getExerciseContext } from './exercise-all.js';
import { RuntimeInvoker } from './runtime-invoker.js';

export function createObservabilityRouter(): Router {
  const router = Router();
  const store = traceBus.getStore();
  const coverageEngine = new CoverageEngine();
  const graphBuilder = new GraphBuilder(store);

  // ── Register default modules (fresh each startup, purge stale) ──
  store.clearRegistry();
  for (const mod of DEFAULT_MODULES) {
    store.registerModule(mod);
  }

  // ════════════════════════════════════════════════════════════════
  // Events
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/events — recent events
  router.get('/events', (_req: Request, res: Response) => {
    const limit = parseInt(_req.query.limit as string) || 100;
    const events = store.getRecentEvents(limit);
    res.json({ ok: true, count: events.length, events });
  });

  // GET /api/observability/events/:taskId — events by task
  router.get('/events/:taskId', (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const events = store.getEventsByTask(taskId);
    res.json({ ok: true, taskId, count: events.length, events });
  });

  // ════════════════════════════════════════════════════════════════
  // Modules & Coverage
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/modules — registered modules
  router.get('/modules', (_req: Request, res: Response) => {
    const modules = store.getRegisteredModules();
    res.json({ ok: true, count: modules.length, modules });
  });

  // GET /api/observability/coverage — coverage snapshot
  router.get('/coverage', (_req: Request, res: Response) => {
    const coverage = coverageEngine.calculateLegacy();
    res.json({ ok: true, coverage });
  });

  // ════════════════════════════════════════════════════════════════
  // Graph & Timeline
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/graph/:taskId — graph for one task
  router.get('/graph/:taskId', (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const nodes = graphBuilder.buildTaskGraph(taskId);
    res.json({ ok: true, taskId, nodes });
  });

  // GET /api/observability/graphs — all task graphs
  router.get('/graphs', (_req: Request, res: Response) => {
    const graphs = graphBuilder.buildAllTaskGraphs();
    const result: Array<{ taskId: string; nodes: unknown[] }> = [];
    for (const [taskId, nodes] of graphs) {
      result.push({ taskId, nodes });
    }
    res.json({ ok: true, graphs: result });
  });

  // GET /api/observability/timeline — task timeline
  router.get('/timeline', (_req: Request, res: Response) => {
    const timeline = graphBuilder.getTimeline();
    res.json({ ok: true, timeline });
  });

  // ════════════════════════════════════════════════════════════════
  // Synthetic Task Generator
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/generate — browser-friendly trigger
  router.get('/generate', (req: Request, res: Response) => {
    const mode = (req.query.mode as string) || 'random';
    if (mode === 'full-coverage') {
      res.json({ ok: true, message: 'Running 50-task coverage suite... Check server console.' });
      import('./coverage-runner.js').then(({ runCoverageSuite }) => {
        runCoverageSuite((phase, cur, total) => {
          if (cur === 1) console.log(`\n[Coverage] 📋 Phase ${phase} (${total} tasks)`);
          if (cur % 3 === 0 || cur === total) console.log(`[Coverage]   Phase ${phase}: ${cur}/${total}`);
        }).then(r => {
          console.log(`[Coverage] ✅ ${r.succeeded}/${r.succeeded + r.failed} tasks, ${r.before}→${r.after} exercised (+${r.gained.length})`);
          if (r.gained.length > 0) console.log(`[Coverage]   New: ${r.gained.sort().join(', ')}`);
        });
      });
      return;
    }
    res.json({ ok: true, tip: 'Use mode=full-coverage for 50-task suite' });
  });

  // POST /api/observability/generate — start generating tasks
  router.post('/generate', (req: Request, res: Response) => {
    const { count = 10, concurrency = 3, mode = 'random' } = req.body || {};

    // ★ Full-coverage mode: run 50 real HTTP tasks (phased)
    if (mode === 'full-coverage') {
      res.json({ ok: true, message: 'Running 50-task full coverage suite...' });
      import('./coverage-runner.js').then(({ runCoverageSuite }) => {
        runCoverageSuite((phase, cur, total) => {
          if (cur === 1) console.log(`\n[Coverage] 📋 Phase ${phase} (${total} tasks)`);
          if (cur % 3 === 0 || cur === total) console.log(`[Coverage]   Phase ${phase}: ${cur}/${total}`);
        }).then(r => {
          console.log(`[Coverage] ✅ ${r.succeeded}/${r.succeeded + r.failed} tasks, ${r.before}→${r.after} (+${r.gained.length})`);
        });
      });
      return;
    }

    res.json({
      ok: true,
      message: `Generating ${count} tasks (concurrency=${concurrency}, mode=${mode})`,
    });

    // Run in background, don't await
    taskGenerator
      .generateTasks(count, concurrency, mode, (completed, total) => {
        console.log(`[TaskGen] ⏳ ${completed}/${total}`);
      })
      .catch(err => {
        console.error('[TaskGen] ❌ Error:', err);
      });
  });

  // POST /api/observability/generate/abort — abort generation
  router.post('/generate/abort', (_req: Request, res: Response) => {
    taskGenerator.abort();
    res.json({ ok: true, message: 'Task generation aborted' });
  });

  // GET /api/observability/generate/status — generation status
  router.get('/generate/status', (_req: Request, res: Response) => {
    res.json({ ok: true, running: taskGenerator.running });
  });

  // ════════════════════════════════════════════════════════════════
  // Stats & System
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/stats — overall system stats
  router.get('/stats', (_req: Request, res: Response) => {
    const events = store.getAllEvents(10000);

    const tasks = new Set<string>();
    let successCount = 0;
    let failedCount = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const event of events) {
      if (event.taskId) tasks.add(event.taskId);

      if (event.eventType === 'MODULE_END') {
        successCount++;
      }
      if (event.eventType === 'ERROR') {
        failedCount++;
      }
      if (event.metadata?.latency && typeof event.metadata.latency === 'number') {
        totalLatency += event.metadata.latency;
        latencyCount++;
      }
    }

    const coverage = coverageEngine.calculateLegacy();

    res.json({
      ok: true,
      stats: {
        totalTasks: tasks.size,
        totalEvents: events.length,
        successCount,
        failedCount,
        avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
        moduleCoverage: Math.round(coverage.moduleCoverage * 10000) / 100,
        pathCoverage: Object.keys(coverage.pathCoverage).length,
        dataFlowCoverage: Math.round(coverage.dataFlowCoverage * 10000) / 100,
        activatedModules: coverage.activatedModules,
        totalModules: coverage.totalModules,
        unusedModules: coverage.unusedModules,
      },
    });
  });

  // ════════════════════════════════════════════════════════════════
  // Module Heartbeat (自检)
  // ════════════════════════════════════════════════════════════════

  // POST /api/observability/heartbeat — module self-registration
  router.post('/heartbeat', (req: Request, res: Response) => {
    const { name, version, layer, status } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'Missing name' });
    store.heartbeat({ name, version: version || '1.0.0', layer: layer || 'unknown', status: status || 'online' });
    res.json({ ok: true });
  });

  // GET /api/observability/heartbeats — unified from ObservationCollector + TraceStore
  router.get('/heartbeats', (_req: Request, res: Response) => {
    const report = store.getHealthReport();
    const ocStates = ObservationCollector.getModuleStates();
    const ocExercised = ObservationCollector.getExercisedModules();

    // Override exercisedModules from ObservationCollector (single source of truth)
    report.exercisedModules = [...ocExercised];
    report.onlineButUnused = []; // OC handles this — no false positives

    // Merge/override heartbeats with OC state (displayStatus from state machine)
    const ocMap = new Map(ocStates.map(s => [s.name, s]));
    for (const hb of report.heartbeats) {
      const oc = ocMap.get(hb.name);
      if (oc) {
        hb.status = oc.displayStatus;  // 'online' | 'degraded' | 'offline' | 'unknown'
        hb.metadata = {
          ...hb.metadata,
          callCount: oc.callCount,
          successCount: oc.successCount,
          errorCount: oc.errorCount,
          runtimeState: oc.runtimeState,
          source: oc.source,
        };
      }
    }

    // Add OC-only modules not in TraceStore heartbeats
    for (const oc of ocStates) {
      if (!report.heartbeats.find(h => h.name === oc.name)) {
        report.heartbeats.push({
          name: oc.name,
          version: '9.2.0',
          layer: oc.layer,
          status: oc.displayStatus,
          registeredAt: oc.registeredAt,
          lastHeartbeat: oc.lastHeartbeatAt || oc.registeredAt,
          metadata: {
            callCount: oc.callCount,
            successCount: oc.successCount,
            errorCount: oc.errorCount,
            runtimeState: oc.runtimeState,
            source: oc.source,
          },
        });
      }
    }

    report.onlineCount = report.heartbeats.filter(h => h.status === 'online').length;
    report.totalCount = report.heartbeats.length;
    (report as any).ocStats = ObservationCollector.getStats();
    res.json({ ok: true, report });
  });

  // POST /api/observability/clear — clear trace events only (keep modules & heartbeats)
  router.post('/clear', (_req: Request, res: Response) => {
    store.clear();
    res.json({ ok: true, message: 'Events cleared. Modules & heartbeats preserved.' });
  });

  // POST /api/observability/reset — full reset: wipe everything + re-register defaults
  router.post('/reset', (_req: Request, res: Response) => {
    store.resetToDefaults(DEFAULT_MODULES);
    res.json({ ok: true, message: `Full reset to ${DEFAULT_MODULES.length} default modules` });
  });

  // POST /api/observability/ingest — external process ingestion (auto-feed-runner etc.)
  router.post('/ingest', (req: Request, res: Response) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ ok: false, error: 'Expected { events: TraceEvent[] }' });
    }
    let count = 0;
    for (const ev of events) {
      if (!ev.id || !ev.taskId || !ev.module?.name) continue;
      // Auto-register heartbeat for modules we haven't seen before
      const mod = ev.module;
      if (mod?.name && !store.getHeartbeats().some(h => h.name === mod.name)) {
        store.heartbeat({ name: mod.name, version: mod.version || '1.0.0', layer: mod.layer || 'unknown', status: 'online' });
      }
      traceBus.emit(ev as import('./types.js').TraceEvent);
      count++;
    }
    res.json({ ok: true, ingested: count });
  });

  // ════════════════════════════════════════════════════════════════
  // Phase 3: Architecture Audit + Coverage V2 + Replay
  // ════════════════════════════════════════════════════════════════

  const getServices = () => (traceBus as any)._services || {};

  // GET /api/observability/audit — architecture compliance report
  // Uses unified ObservationCollector so exercise-all forkContext chain is visible
  // Query params: ?strict=true → enables strict mode (bootstrapped modules → WARNING)
  router.get('/audit', (req: Request, res: Response) => {
    const { archAuditor } = getServices();
    if (!archAuditor) return res.status(503).json({ ok: false, error: 'ArchitectureAuditor not initialized' });
    const spans = ObservationCollector.getObservations(10000);
    const strict = req.query.strict === 'true' || req.query.strict === '1';
    const report = archAuditor.audit(spans, { strict });
    res.json({ ok: true, report, strict });
  });

  // GET /api/observability/coverage-v2 — span-based coverage report
  router.get('/coverage-v2', (_req: Request, res: Response) => {
    const report = coverageEngine.calculate();
    res.json({ ok: true, report });
  });

  // POST /api/observability/replay/archive/:taskId — archive spans for replay
  router.post('/replay/archive/:taskId', (req: Request, res: Response) => {
    const { replayEngine, execTracer } = getServices();
    if (!replayEngine) return res.status(503).json({ ok: false, error: 'ReplayEngine not initialized' });
    const taskId = String(req.params.taskId);
    const spans = execTracer?.getStats?.()?.spanTree ?? [];
    const session = replayEngine.archive(taskId, spans);
    res.json({ ok: true, session });
  });

  // GET /api/observability/replay/sessions — list replay sessions
  router.get('/replay/sessions', (_req: Request, res: Response) => {
    const { replayEngine } = getServices();
    if (!replayEngine) return res.status(503).json({ ok: false, error: 'ReplayEngine not initialized' });
    res.json({ ok: true, sessions: replayEngine.listSessions(), stats: replayEngine.getStats() });
  });

  // POST /api/observability/replay/:sessionId — replay a session
  router.post('/replay/:sessionId', (req: Request, res: Response) => {
    const { replayEngine } = getServices();
    if (!replayEngine) return res.status(503).json({ ok: false, error: 'ReplayEngine not initialized' });
    const result = replayEngine.replay(String(req.params.sessionId));
    if (!result) return res.status(404).json({ ok: false, error: 'Session not found' });
    res.json({ ok: true, ...result });
  });

  // GET /api/observability/replay/diff?a=...&b=... — diff two sessions
  router.get('/replay/diff', (req: Request, res: Response) => {
    const { replayEngine } = getServices();
    if (!replayEngine) return res.status(503).json({ ok: false, error: 'ReplayEngine not initialized' });
    const a = String(req.query.a || '');
    const b = String(req.query.b || '');
    if (!a || !b) return res.status(400).json({ ok: false, error: 'Missing ?a=...&b=...' });
    const diff = replayEngine.diff(a, b);
    if (!diff) return res.status(404).json({ ok: false, error: 'One or both sessions not found' });
    res.json({ ok: true, diff });
  });

  // ════════════════════════════════════════════════════════════════
  // Phase 4: Unified Observation API
  // ════════════════════════════════════════════════════════════════

  // GET /api/observability/observations — raw observations
  router.get('/observations', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 500;
    const taskId = req.query.taskId as string | undefined;
    const traceId = req.query.traceId as string | undefined;
    let obs;
    if (taskId) obs = ObservationCollector.getObservationsByTask(taskId);
    else if (traceId) obs = ObservationCollector.getObservationsByTrace(traceId);
    else obs = ObservationCollector.getObservations(limit);
    res.json({ ok: true, count: obs.length, observations: obs });
  });

  // GET /api/observability/modules-v2 — module states from ObservationCollector
  router.get('/modules-v2', (_req: Request, res: Response) => {
    const states = ObservationCollector.getModuleStates();
    const exercised = ObservationCollector.getExercisedModules();
    const stats = ObservationCollector.getStats();
    res.json({
      ok: true,
      totalModules: stats.totalModules,
      exercisedModules: stats.exercisedModules,
      failedModules: stats.failedModules,
      modules: states.map(s => ({
        ...s,
        exercised: exercised.has(s.name),
      })),
    });
  });

  // GET /api/observability/topology — auto-generated call topology
  router.get('/topology', (_req: Request, res: Response) => {
    const topology = ObservationCollector.getTopology();
    res.json({ ok: true, topology });
  });

  // GET /api/observability/span-tree/:taskId — span tree for a task
  router.get('/span-tree/:taskId', (req: Request, res: Response) => {
    const tree = ObservationCollector.getSpanTree(String(req.params.taskId));
    res.json({ ok: true, taskId: req.params.taskId, spans: tree });
  });

  // GET /api/observability/exercise-status — coverage tracking for exercise-all-real.ts
  router.get('/exercise-status', (_req: Request, res: Response) => {
    const stats = ObservationCollector.getStats();
    const exercised = [...ObservationCollector.getExercisedModules()];
    res.json({
      ok: true,
      totalModules: stats.totalModules,
      exercisedCount: exercised.length,
      coverage: stats.totalModules > 0 ? (exercised.length / stats.totalModules * 100).toFixed(1) + '%' : '0%',
      exercisedModules: exercised.sort(),
    });
  });

  // POST /api/observability/exercise-all — exercise all unexercised modules
  router.post('/exercise-all', async (req: Request, res: Response) => {
    try {
      // If global context exists, use it
      if (getExerciseContext()) {
        const result = await exerciseAllFromGlobal();
        res.json({ ok: true, ...result });
        return;
      }
      // Fallback: direct RuntimeInvoker calls for virtual modules
      const fallbackModules = [
        'retry-policy', 'mission-fsm', 'dag-runtime', 'dag-executor-adapter',
        'cognitive-pipeline', 'execution-stage', 'learning-stage',
        'workflow-intelligence', 'context-assembly-engine', 'brain-persistor',
      ];
      const fallbackPromises = fallbackModules.map(mod =>
        RuntimeInvoker.call(mod, 'exercise', async () => {}, null, {}, 'runtime').catch(() => {})
      );
      await Promise.allSettled(fallbackPromises);
      const after = [...ObservationCollector.getExercisedModules()];
      res.json({ ok: true, gained: after, before: after.length, after: after.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // GET /api/observability/exercise-all — browser-friendly trigger
  router.get('/exercise-all', (req: Request, res: Response) => {
    res.json({ ok: true, message: 'Use POST /api/observability/exercise-all to trigger exercise' });
  });

  return router;
}
