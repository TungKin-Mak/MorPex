/**
 * V10API — v10 模块 REST API 路由
 *
 * 暴露 Simulation, Verification, EventMesh, Learning, Federation 模块的能力。
 * 零修改现有后端业务代码。
 * 只加路由，不改引擎。
 *
 * 使用方式:
 *   import { registerV10Routes } from './V10API.js';
 *   registerV10Routes(app, { simulationEngine, verificationEngine, ... });
 *
 * 所有 v10 模块均为可选注入。未注入时返回 501 Not Implemented。
 */

import type { Router as ExpressRouter } from 'express';
import type { SimulationEngine } from './simulation/simulation-engine.js';
import type { ExecutionPredictor } from './simulation/execution-predictor.js';
import type { BehaviorVerificationEngine } from './verification/behavior-verification-engine.js';
import type { EventMesh } from './event-mesh/event-mesh.js';
import type { LearningPlane } from './learning/learning-plane.js';
import type { FederationManager } from './federation/federation-manager.js';

// ── V10Dependencies — 所有可注入的 v10 模块 ──

export interface V10Dependencies {
  simulationEngine?: SimulationEngine;
  executionPredictor?: ExecutionPredictor;
  verificationEngine?: BehaviorVerificationEngine;
  eventMesh?: EventMesh;
  learningPlane?: LearningPlane;
  federationManager?: FederationManager;
}

// ── 辅助：统一响应格式 ──

function ok(data: unknown) {
  return { ok: true, data };
}

function notImplemented(name: string) {
  return { ok: false, error: `${name} module not available`, code: 501 };
}

function fail(error: unknown) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

// ── registerV10Routes — 注册所有 v10 API 路由 ──

export function registerV10Routes(app: ExpressRouter, deps: V10Dependencies): void {
  const { simulationEngine, executionPredictor, verificationEngine, eventMesh, learningPlane, federationManager } = deps;

  // ═══════════════════════════════════════════════════════════════
  // Simulation API
  // ═══════════════════════════════════════════════════════════════

  // POST /api/v10/simulate — 仿真预测
  app.post('/api/v10/simulate', async (req, res) => {
    try {
      if (!simulationEngine) return res.status(501).json(notImplemented('SimulationEngine'));
      const { mission, plan, history } = req.body || {};
      if (!mission || !plan) return res.status(400).json({ ok: false, error: 'Missing required fields: mission, plan' });
      const result = await simulationEngine.simulate(mission, plan, history);
      return res.json(ok(result));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/simulate/simple — 简化仿真（无需 history）
  app.post('/api/v10/simulate/simple', async (req, res) => {
    try {
      if (!simulationEngine) return res.status(501).json(notImplemented('SimulationEngine'));
      const { plan } = req.body || {};
      if (!plan) return res.status(400).json({ ok: false, error: 'Missing required field: plan' });
      const result = await simulationEngine.simulateSimple(plan);
      return res.json(ok(result));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/simulate/execution — 执行预测
  app.post('/api/v10/simulate/execution', async (req, res) => {
    try {
      if (!executionPredictor) return res.status(501).json(notImplemented('ExecutionPredictor'));
      const { missionId, plan, history } = req.body || {};
      if (!missionId || !plan) return res.status(400).json({ ok: false, error: 'Missing required fields: missionId, plan' });
      const result = await executionPredictor.predict(missionId, plan, history);
      return res.json(ok(result));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/simulate/health — 仿真引擎健康检查
  app.get('/api/v10/simulate/health', (_req, res) => {
    if (!simulationEngine) return res.status(501).json(notImplemented('SimulationEngine'));
    return res.json(ok(simulationEngine.health()));
  });

  // ═══════════════════════════════════════════════════════════════
  // Verification API
  // ═══════════════════════════════════════════════════════════════

  // POST /api/v10/verify — 执行行为验证
  app.post('/api/v10/verify', async (req, res) => {
    try {
      if (!verificationEngine) return res.status(501).json(notImplemented('BehaviorVerificationEngine'));
      const { mission, result } = req.body || {};
      if (!mission || !result) return res.status(400).json({ ok: false, error: 'Missing required fields: mission, result' });
      const report = await verificationEngine.verify(mission, result);
      return res.json(ok(report));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/verify/from-plan — 直接从 Plan + Result 验证
  app.post('/api/v10/verify/from-plan', async (req, res) => {
    try {
      if (!verificationEngine) return res.status(501).json(notImplemented('BehaviorVerificationEngine'));
      const { missionId, plan, result } = req.body || {};
      if (!missionId || !plan || !result) return res.status(400).json({ ok: false, error: 'Missing required fields: missionId, plan, result' });
      const report = await verificationEngine.verifyFromPlan(missionId, plan, result);
      return res.json(ok(report));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/verify/regression/:missionId — 查询历史验证记录
  app.get('/api/v10/verify/regression/:missionId', async (req, res) => {
    try {
      if (!verificationEngine) return res.status(501).json(notImplemented('BehaviorVerificationEngine'));
      const regressionStore = verificationEngine.getRegressionStore();
      if (!regressionStore) return res.status(501).json({ ok: false, error: 'RegressionStore not attached' });
      const records = await regressionStore.getByMissionId(req.params.missionId);
      return res.json(ok(records));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/quality/score/:missionId — 查询质量评分
  app.get('/api/v10/quality/score/:missionId', async (req, res) => {
    try {
      if (!verificationEngine) return res.status(501).json(notImplemented('BehaviorVerificationEngine'));
      const regressionStore = verificationEngine.getRegressionStore();
      if (!regressionStore) return res.status(501).json({ ok: false, error: 'RegressionStore not attached' });
      const records = await regressionStore.getByMissionId(req.params.missionId);
      const latest = Array.isArray(records) ? records[records.length - 1] : null;
      if (!latest) return res.status(404).json({ ok: false, error: `No quality score found for mission ${req.params.missionId}` });
      return res.json(ok({ missionId: req.params.missionId, score: latest.score, grade: latest.grade }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/verify/health — 验证引擎健康检查
  app.get('/api/v10/verify/health', (_req, res) => {
    if (!verificationEngine) return res.status(501).json(notImplemented('BehaviorVerificationEngine'));
    return res.json(ok(verificationEngine.health()));
  });

  // ═══════════════════════════════════════════════════════════════
  // Event Mesh API
  // ═══════════════════════════════════════════════════════════════

  // GET /api/v10/events/schemas — 列出已注册的 event schema
  app.get('/api/v10/events/schemas', (_req, res) => {
    try {
      if (!eventMesh) return res.status(501).json(notImplemented('EventMesh'));
      const registry = eventMesh.getRegistry();
      const schemas = registry.listSchemas();
      return res.json(ok(schemas));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/events/register — 注册 event schema
  app.post('/api/v10/events/register', async (req, res) => {
    try {
      if (!eventMesh) return res.status(501).json(notImplemented('EventMesh'));
      const { type, schema, version, backwardCompatible } = req.body || {};
      if (!type || !schema) return res.status(400).json({ ok: false, error: 'Missing required fields: type, schema' });
      const registry = eventMesh.getRegistry();
      registry.register(type, schema, { version: version ?? undefined, backwardCompatible: backwardCompatible ?? true });
      return res.json(ok({ registered: true, type, version: version ?? registry.getLatestVersion(type) }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/events/replay — 触发事件重放
  app.post('/api/v10/events/replay', async (req, res) => {
    try {
      if (!eventMesh) return res.status(501).json(notImplemented('EventMesh'));
      const { eventTypes, missionId, startTime, endTime } = req.body || {};
      const result = await eventMesh.replay({ eventTypes, missionId, startTime, endTime });
      return res.json(ok(result));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/events/emit — 发布 v10 格式事件
  app.post('/api/v10/events/emit', async (req, res) => {
    try {
      if (!eventMesh) return res.status(501).json(notImplemented('EventMesh'));
      const event = req.body;
      if (!event || !event.type) return res.status(400).json({ ok: false, error: 'Missing required field: type' });
      const result = eventMesh.publish(event);
      return res.json(ok({ emitted: true, type: event.type, warnings: result?.warnings }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/events/health — EventMesh 健康检查
  app.get('/api/v10/events/health', (_req, res) => {
    if (!eventMesh) return res.status(501).json(notImplemented('EventMesh'));
    return res.json(ok(eventMesh.health()));
  });

  // ═══════════════════════════════════════════════════════════════
  // Federation API
  // ═══════════════════════════════════════════════════════════════

  // GET /api/v10/federation/status — 联邦状态
  app.get('/api/v10/federation/status', (_req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      return res.json(ok(federationManager.getStatus()));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/federation/nodes — 列出所有已注册节点
  app.get('/api/v10/federation/nodes', (_req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      const nodes = federationManager.listNodes();
      return res.json(ok(nodes));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/federation/register — 注册节点
  app.post('/api/v10/federation/register', async (req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      const { nodeId, address, transport, capabilities } = req.body || {};
      if (!nodeId) return res.status(400).json({ ok: false, error: 'Missing required field: nodeId' });
      federationManager.registerNode(nodeId, address || 'local', transport || 'local', capabilities || []);
      return res.json(ok({ registered: true, nodeId }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/federation/unregister — 注销节点
  app.post('/api/v10/federation/unregister', async (req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      const { nodeId } = req.body || {};
      if (!nodeId) return res.status(400).json({ ok: false, error: 'Missing required field: nodeId' });
      federationManager.unregisterNode(nodeId);
      return res.json(ok({ unregistered: true, nodeId }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/federation/capabilities — 列出已发现的能力
  app.get('/api/v10/federation/capabilities', (_req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      const capabilities = federationManager.getAllCapabilities();
      return res.json(ok(capabilities));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/federation/execute — 远程执行
  app.post('/api/v10/federation/execute', async (req, res) => {
    try {
      if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
      const { targetNodeId, agentId, action, payload, timeout } = req.body || {};
      if (!targetNodeId || !action) return res.status(400).json({ ok: false, error: 'Missing required fields: targetNodeId, action' });
      const result = await federationManager.executeRemotely({ targetNodeId, agentId, action, payload, timeout });
      return res.json(ok(result));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // GET /api/v10/federation/health — 联邦健康检查
  app.get('/api/v10/federation/health', (_req, res) => {
    if (!federationManager) return res.status(501).json(notImplemented('FederationManager'));
    return res.json(ok(federationManager.health()));
  });

  // ═══════════════════════════════════════════════════════════════
  // Learning API
  // ═══════════════════════════════════════════════════════════════

  // GET /api/v10/learning/status — 学习平面状态
  app.get('/api/v10/learning/status', (_req, res) => {
    try {
      if (!learningPlane) return res.status(501).json(notImplemented('LearningPlane'));
      const health = learningPlane.health();
      return res.json(ok({ initialized: true, submodules: health.submodules }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // POST /api/v10/learning/record — 记录学习经验
  app.post('/api/v10/learning/record', async (req, res) => {
    try {
      if (!learningPlane) return res.status(501).json(notImplemented('LearningPlane'));
      const { experience, type } = req.body || {};
      if (!experience) return res.status(400).json({ ok: false, error: 'Missing required field: experience' });
      await learningPlane.record(experience, type || 'experience');
      return res.json(ok({ recorded: true, type: type || 'experience' }));
    } catch (err) {
      return res.status(500).json(fail(err));
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Health — 聚合所有 v10 模块健康状态
  // ═══════════════════════════════════════════════════════════════

  // GET /api/v10/health — 聚合健康检查
  app.get('/api/v10/health', (_req, res) => {
    const modules: Record<string, unknown> = {};
    if (simulationEngine) modules.simulation = simulationEngine.health();
    if (verificationEngine) modules.verification = verificationEngine.health();
    if (eventMesh) modules.eventMesh = eventMesh.health();
    if (learningPlane) modules.learning = learningPlane.health();
    if (federationManager) modules.federation = federationManager.health();

    const allOk = Object.values(modules).every((m: any) => m?.ok !== false);
    return res.json({
      ok: true,
      data: {
        healthy: allOk,
        moduleCount: Object.keys(modules).length,
        modules,
      },
    });
  });

  console.log('[V10API] ✅ 已注册 v10 API 路由 (simulation, verification, event-mesh, learning, federation)');
}
