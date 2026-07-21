/**
 * RuntimeAPI — 运行时引擎能力 REST API 路由
 *
 * 暴露后端引擎能力给前端。
 * 零修改现有后端业务代码。
 * 只加路由，不改引擎。
 */
import type { Router as ExpressRouter } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function registerRuntimeRoutes(app: ExpressRouter): void {
  const DATA_DIR = path.resolve('data');

  // ═════════════════════════════════════════════
  // Runtime: FSM + DAG 执行状态
  // ═════════════════════════════════════════════

  // GET /api/runtime/executions — 列出所有执行
  app.get('/api/runtime/executions', (_req, res) => {
    try {
      const fsmDir = path.join(DATA_DIR, 'fsm');
      if (!fs.existsSync(fsmDir)) return res.json({ ok: true, count: 0, executions: [] });
      const files = fs.readdirSync(fsmDir).filter(f => f.endsWith('.jsonl'));
      const executions = files.map(f => {
        const id = f.replace('.jsonl', '');
        const content = fs.readFileSync(path.join(fsmDir, f), 'utf-8').trim();
        const lines = content.split('\n').filter(Boolean);
        const latest = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
        return { id, state: latest?.currentState || 'unknown', transitions: latest?.history?.length || 0, updatedAt: latest?.updatedAt, createdAt: latest?.createdAt };
      });
      executions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return res.json({ ok: true, count: executions.length, executions });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/runtime/execution/:id — 单个执行详情
  app.get('/api/runtime/execution/:id', (req, res) => {
    try {
      const f = path.join(DATA_DIR, 'fsm', `${req.params.id}.jsonl`);
      if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: 'Execution not found' });
      const content = fs.readFileSync(f, 'utf-8').trim();
      const lines = content.split('\n').filter(Boolean);
      const snapshots = lines.map(l => JSON.parse(l));
      const latest = snapshots[snapshots.length - 1];

      // Try to find associated DAG result
      let dagResult = null;
      const dagFile = path.join(DATA_DIR, 'dag', `${req.params.id}.json`);
      if (fs.existsSync(dagFile)) {
        dagResult = JSON.parse(fs.readFileSync(dagFile, 'utf-8'));
      }

      return res.json({ ok: true, execution: { id: req.params.id, latest, snapshots: snapshots.slice(-10), dagResult } });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═════════════════════════════════════════════
  // Artifact: Registry + Graph + Lineage
  // ═════════════════════════════════════════════

  // GET /api/artifacts/list — 列出所有已注册产物
  app.get('/api/artifacts/list', (_req, res) => {
    try {
      const artDir = path.join(DATA_DIR, 'artifacts');
      if (!fs.existsSync(artDir)) return res.json({ ok: true, count: 0, artifacts: [] });
      const files = fs.readdirSync(artDir).filter(f => f.endsWith('.jsonl'));
      const artifacts: any[] = [];
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(artDir, f), 'utf-8').trim();
          const lines = content.split('\n').filter(Boolean);
          for (const l of lines) {
            const art = JSON.parse(l);
            artifacts.push({ id: art.id, name: art.name, type: art.type, version: art.version, status: art.status, updatedAt: art.updatedAt });
          }
        } catch { /* skip malformed */ }
      }
      artifacts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return res.json({ ok: true, count: artifacts.length, artifacts });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/artifacts/graph — ArtifactGraph 节点+边
  app.get('/api/artifacts/graph', (_req, res) => {
    try {
      // Read from artifact graph persistence
      const graphFile = path.join(DATA_DIR, 'artifacts', '_graph.json');
      if (!fs.existsSync(graphFile)) return res.json({ ok: true, nodes: [], edges: [] });
      const graph = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
      return res.json({ ok: true, nodes: graph.nodes || [], edges: graph.edges || [] });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/artifacts/lineage/:id — 产物血缘
  app.get('/api/artifacts/lineage/:id', (req, res) => {
    try {
      const graphFile = path.join(DATA_DIR, 'artifacts', '_graph.json');
      if (!fs.existsSync(graphFile)) return res.json({ ok: true, ancestors: [], descendants: [] });
      const graph = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
      const nodes = graph.nodes || [];
      const edges = graph.edges || [];
      // Find ancestors (nodes that depend on the requested node)
      const ancestors = nodes.filter((n: any) => edges.some((e: any) => e.from === req.params.id && e.to === n.id));
      // Find descendants (nodes that the requested node depends on)
      const descendants = nodes.filter((n: any) => edges.some((e: any) => e.to === req.params.id && e.from === n.id));
      return res.json({ ok: true, artifactId: req.params.id, ancestors: ancestors.length, descendants: descendants.length, ancestorNodes: ancestors, descendantNodes: descendants });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═════════════════════════════════════════════
  // Architecture: Auditor v3 Health Report
  // ═════════════════════════════════════════════

  // GET /api/architecture/health — 运行 Auditor 返回健康报告
  app.get('/api/architecture/health', async (_req, res) => {
    try {
      const { ArchitectureAuditor } = await import('../../core/src/auditor/ArchitectureAuditor.js');
      const auditor = new ArchitectureAuditor();
      const report = await auditor.runFullAudit();
      return res.json({
        ok: true,
        score: report.architectureScore,
        breakdown: report.scoreBreakdown,
        runtimeCoverage: report.runtimeCoverage,
        events: report.eventFlows?.filter((e: any) => !e.gap).length || 0,
        totalEvents: report.eventFlows?.length || 0,
        deadModules: report.unusedModules?.length || 0,
        criticalIssues: report.criticalIssues?.length || 0,
        classification: report.modules ? {
          total: report.modules.length,
          // Approximate from unusedModules inverse
          connected: report.modules.length - (report.unusedModules?.length || 0),
        } : null,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═════════════════════════════════════════════
  // Memory: Activation Engine
  // ═════════════════════════════════════════════

  // POST /api/memory/activate — 上下文感知记忆激活
  app.post('/api/memory/activate', async (req, res) => {
    try {
      const { MemoryActivationEngine } = await import('../../core/src/memory/MemoryActivationEngine.js');
      const engine = new MemoryActivationEngine();
      const { executionStatus, goal, currentStep, totalSteps, completedSteps, errors, tags } = req.body || {};
      const result = engine.activate({
        executionStatus: executionStatus || 'idle',
        goal: goal || '',
        currentStep: currentStep || 0,
        totalSteps: totalSteps || 1,
        completedSteps: completedSteps || [],
        errors: errors || [],
        tags: tags || [],
      });
      return res.json({
        ok: true,
        memories: result.memories?.slice(0, 5).map((m: any) => ({ id: m.id, content: m.content?.substring(0, 100), score: m.relevanceScore })),
        activationScore: result.activationScore,
        contextBias: result.contextBias,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═════════════════════════════════════════════
  // Learning: Experience + Evaluation + Templates
  // ═════════════════════════════════════════════

  // GET /api/learning/stats — 学习循环统计
  app.get('/api/learning/stats', async (_req, res) => {
    try {
      const { ExperienceExtractor } = await import('../../core/src/learning/ExperienceExtractor.js');
      const { PlanEvaluator } = await import('../../core/src/learning/PlanEvaluator.js');
      const { TemplateEvolutionEngine } = await import('../../core/src/learning/TemplateEvolutionEngine.js');

      const extractor = new ExperienceExtractor();
      const evaluator = new PlanEvaluator();
      const templateEngine = new TemplateEvolutionEngine();
      const stats = templateEngine.getStats();

      return res.json({
        ok: true,
        // ExperienceExtractor — no public stats API, report basic health
        experienceExtractor: { available: true, recentExtractions: 0 },
        // PlanEvaluator — no public stats API
        planEvaluator: { available: true },
        // TemplateEvolutionEngine
        templateEvolution: { totalTemplates: stats.total, avgSuccessRate: stats.avgSuccessRate, avgUsage: stats.avgUsage },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═════════════════════════════════════════════
  // System: Validation + Health Report
  // ═════════════════════════════════════════════

  // GET /api/system/health — 读取已生成的 System Health Report
  app.get('/api/system/health', (_req, res) => {
    try {
      const reportFile = path.join(DATA_DIR, 'system-health-report.json');
      if (!fs.existsSync(reportFile)) return res.json({ ok: true, message: 'No report generated yet. Run: npx tsx tests/run-all.ts' });
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
      return res.json({
        ok: true,
        architectureCoverage: report.architectureCoverage,
        runtimeCoverage: report.runtimeCoverage,
        scenarioSuccessRate: report.scenarioSuccessRate,
        recoveryRate: report.recoveryRate,
        learningEffectiveness: report.learningEffectiveness,
        performance: report.performanceMetrics,
        testsPassed: report.testResults?.filter((r: any) => r.passed).length || 0,
        testsTotal: report.testResults?.length || 0,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/system/validate — 运行验证套件（异步）
  app.post('/api/system/validate', async (_req, res) => {
    try {
      const { RuntimeValidator } = await import('../../core/src/validation/RuntimeValidator.js');
      const validator = new RuntimeValidator();
      const result = await validator.runAll();
      return res.json({
        ok: true,
        passed: result.summary?.passed === result.summary?.total,
        total: result.results?.length || 0,
        passedCount: result.results?.filter((r: any) => r.status === 'passed').length || 0,
        healthScore: result.healthScore,
        details: result.results?.map((r: any) => ({ name: r.name, status: r.status, assertions: `${r.assertionsPassed}/${r.assertionsTotal}` })),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════
  // Event: real-time SSE stream for EventBus events
  // ═══════════════════════════════════════════════════

  // GET /api/events/stream — SSE 事件流
  app.get('/api/events/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial heartbeat
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Keep alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    // Watch for new FSM state changes
    const watchDir = path.join(DATA_DIR, 'fsm');
    let lastCheck = Date.now();
    const watcher = setInterval(() => {
      if (!fs.existsSync(watchDir)) return;
      try {
        const files = fs.readdirSync(watchDir).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          const stat = fs.statSync(path.join(watchDir, f));
          if (stat.mtimeMs > lastCheck) {
            const id = f.replace('.jsonl', '');
            const content = fs.readFileSync(path.join(watchDir, f), 'utf-8').trim();
            const lines = content.split('\n').filter(Boolean);
            const latest = JSON.parse(lines[lines.length - 1]);
            res.write(`event: fsm.transition\ndata: ${JSON.stringify({ executionId: id, state: latest.currentState, transitions: latest.history?.length })}\n\n`);
          }
        }
        lastCheck = Date.now();
      } catch { /* ignore */ }
    }, 2000);

    req.on('close', () => {
      clearInterval(keepAlive);
      clearInterval(watcher);
    });
  });

  console.log('[RuntimeAPI] 已注册 11 个运行时 API 路由 + SSE 事件流');
}
