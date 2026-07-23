/**
 * TaskGenerator — 合成任务运行器 v9.2
 *
 * 42 个真实模块 + 10 条执行路径，覆盖 6 个层级。
 * 用于生成模拟 Trace 事件，测试完整 Observability 管线。
 */

import { type TraceEvent } from './types';
import { traceBus } from './event-bus';

// ── 可用模块 (42 modules, from ARCHITECTURE.md) ──

const MODULES: Array<{ name: string; layer: string; version: string }> = [
  // Control Plane
  { name: 'policy-engine',          layer: 'control-plane', version: '9.2.0' },
  { name: 'risk-analyzer',          layer: 'control-plane', version: '9.2.0' },
  { name: 'permission-model',       layer: 'control-plane', version: '9.2.0' },
  { name: 'audit-trail',            layer: 'control-plane', version: '9.2.0' },
  { name: 'intent-plugin',          layer: 'control-plane', version: '9.2.0' },
  { name: 'meta-planner',           layer: 'control-plane', version: '9.2.0' },
  { name: 'org-policy-engine',      layer: 'control-plane', version: '9.2.0' },
  // Cognitive Pipeline stages
  { name: 'context-stage',          layer: 'control-plane', version: '9.2.0' },
  { name: 'intent-stage',           layer: 'control-plane', version: '9.2.0' },
  { name: 'goal-stage',             layer: 'control-plane', version: '9.2.0' },
  { name: 'twin-stage',             layer: 'control-plane', version: '9.2.0' },
  { name: 'planning-stage',         layer: 'control-plane', version: '9.2.0' },
  { name: 'execution-stage',        layer: 'control-plane', version: '9.2.0' },
  { name: 'learning-stage',         layer: 'control-plane', version: '9.2.0' },
  { name: 'evolution-stage',        layer: 'control-plane', version: '9.2.0' },
  { name: 'persistence-stage',      layer: 'control-plane', version: '9.2.0' },
  // Runtime Kernel
  { name: 'mission-fsm',            layer: 'runtime',       version: '9.2.0' },
  { name: 'dag-runtime',            layer: 'runtime',       version: '9.2.0' },
  { name: 'execution-fsm',          layer: 'runtime',       version: '9.2.0' },
  { name: 'checkpoint-manager',     layer: 'runtime',       version: '9.2.0' },
  { name: 'recovery-manager',       layer: 'runtime',       version: '9.2.0' },
  { name: 'sandbox-manager',        layer: 'runtime',       version: '9.2.0' },
  { name: 'budget-manager',         layer: 'runtime',       version: '9.2.0' },
  { name: 'compensation-engine',    layer: 'runtime',       version: '9.2.0' },
  { name: 'domain-dispatcher',      layer: 'runtime',       version: '9.2.0' },
  { name: 'cross-domain-router',    layer: 'runtime',       version: '9.2.0' },
  // Knowledge Plane
  { name: 'behavior-twin',          layer: 'knowledge',     version: '9.2.0' },
  { name: 'decision-twin',          layer: 'knowledge',     version: '9.2.0' },
  { name: 'personal-brain',         layer: 'knowledge',     version: '9.2.0' },
  { name: 'goal-manager',           layer: 'knowledge',     version: '9.2.0' },
  { name: 'knowledge-graph',        layer: 'knowledge',     version: '9.2.0' },
  { name: 'artifact-registry',      layer: 'knowledge',     version: '9.2.0' },
  { name: 'memory-wiki',            layer: 'knowledge',     version: '9.2.0' },
  { name: 'workflow-intelligence',  layer: 'knowledge',     version: '9.2.0' },
  // Agent Plane
  { name: 'agent-scheduler',        layer: 'runtime',       version: '9.2.0' },
  { name: 'collaboration-manager',  layer: 'runtime',       version: '9.2.0' },
  { name: 'negotiation-engine',     layer: 'runtime',       version: '9.2.0' },
  { name: 'team-formation-engine',  layer: 'runtime',       version: '9.2.0' },
  { name: 'cross-agent-learning',   layer: 'runtime',       version: '9.2.0' },
  { name: 'shared-memory-manager',  layer: 'runtime',       version: '9.2.0' },
  // Evolution
  { name: 'cognitive-loop',         layer: 'evolution',     version: '9.2.0' },
  { name: 'workflow-miner',         layer: 'evolution',     version: '9.2.0' },
  { name: 'workflow-registry',      layer: 'evolution',     version: '9.2.0' },
  // Resilience
  { name: 'circuit-breaker',        layer: 'control-plane', version: '9.2.0' },
  { name: 'error-handler',          layer: 'control-plane', version: '9.2.0' },
  { name: 'metrics-collector',      layer: 'control-plane', version: '9.2.0' },
  { name: 'health-check',           layer: 'control-plane', version: '9.2.0' },
];

// ── 执行路径 (10条, 覆盖 42 个模块中的 ~35 个) ──

type PathKey =
  | 'cognitive-full' | 'simple-task' | 'multi-agent'
  | 'knowledge-heavy' | 'runtime-recovery' | 'evolution-workflow'
  | 'learning-feedback' | 'cross-domain' | 'resilience-test' | 'control-audit';

const PATHS: Record<PathKey, string[]> = {
  'cognitive-full': [
    'context-stage', 'intent-stage', 'goal-stage', 'twin-stage',
    'planning-stage', 'execution-stage', 'learning-stage',
    'evolution-stage', 'persistence-stage',
  ],
  'simple-task': [
    'intent-plugin', 'meta-planner', 'mission-fsm',
    'dag-runtime', 'execution-fsm', 'domain-dispatcher', 'health-check',
  ],
  'multi-agent': [
    'intent-plugin', 'meta-planner', 'agent-scheduler',
    'collaboration-manager', 'negotiation-engine',
    'team-formation-engine', 'shared-memory-manager',
    'execution-fsm', 'health-check',
  ],
  'knowledge-heavy': [
    'context-stage', 'intent-stage', 'behavior-twin', 'decision-twin',
    'personal-brain', 'goal-manager', 'knowledge-graph',
    'memory-wiki', 'artifact-registry', 'planning-stage',
    'execution-stage', 'persistence-stage',
  ],
  'runtime-recovery': [
    'mission-fsm', 'execution-fsm', 'checkpoint-manager',
    'recovery-manager', 'compensation-engine',
    'sandbox-manager', 'budget-manager', 'dag-runtime', 'health-check',
  ],
  'evolution-workflow': [
    'execution-stage', 'learning-stage', 'evolution-stage',
    'workflow-miner', 'workflow-registry', 'cognitive-loop',
    'persistence-stage',
  ],
  'learning-feedback': [
    'execution-stage', 'learning-stage', 'cross-agent-learning',
    'personal-brain', 'behavior-twin', 'decision-twin',
    'evolution-stage', 'persistence-stage',
  ],
  'cross-domain': [
    'intent-plugin', 'risk-analyzer', 'cross-domain-router',
    'domain-dispatcher', 'agent-scheduler',
    'collaboration-manager', 'execution-fsm',
  ],
  'resilience-test': [
    'circuit-breaker', 'error-handler', 'recovery-manager',
    'checkpoint-manager', 'compensation-engine',
    'execution-fsm', 'metrics-collector', 'health-check',
  ],
  'control-audit': [
    'policy-engine', 'risk-analyzer', 'permission-model',
    'audit-trail', 'org-policy-engine', 'intent-plugin',
    'execution-stage', 'metrics-collector', 'health-check',
  ],
};

const PATH_KEYS: PathKey[] = [
  'cognitive-full', 'simple-task', 'multi-agent', 'knowledge-heavy',
  'runtime-recovery', 'evolution-workflow', 'learning-feedback',
  'cross-domain', 'resilience-test', 'control-audit',
];

// ── TaskGenerator ──

export class TaskGenerator {
  private _running = false;
  private abortController: AbortController | null = null;

  get running(): boolean {
    return this._running;
  }

  async generateTasks(
    count: number,
    concurrency: number,
    mode: 'standard' | 'random' | 'stress' = 'random',
    onProgress?: (completed: number, total: number) => void,
  ): Promise<void> {
    this._running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const queue: number[] = [];
    for (let i = 0; i < count; i++) queue.push(i);

    let completed = 0;

    const worker = async () => {
      while (queue.length > 0 && !signal.aborted) {
        const idx = queue.shift();
        if (idx === undefined) break;

        const taskId = `task_${String(idx).padStart(4, '0')}`;
        try {
          await this.runSingleTask(taskId, mode);
        } catch (e) {
          console.warn(`[TaskGen] Task ${taskId} error:`, e);
        }
        completed++;
        onProgress?.(completed, count);
      }
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, count);
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this._running = false;
    console.log(`[TaskGen] ✅ Completed ${count} tasks across 10 path types`);
  }

  private async runSingleTask(taskId: string, mode: string): Promise<void> {
    const pathKey: PathKey =
      mode === 'random'
        ? PATH_KEYS[Math.floor(Math.random() * PATH_KEYS.length)]
        : PATH_KEYS[0];

    const path = PATHS[pathKey];
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    for (const moduleName of path) {
      if (this.abortController?.signal.aborted) break;

      const module = MODULES.find(m => m.name === moduleName);
      if (!module) continue;

      // 3% random failure (5% in stress mode)
      const failRate = mode === 'stress' ? 0.05 : 0.03;
      const willFail = Math.random() < failRate;

      const startEvent: TraceEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        executionId,
        timestamp: Date.now(),
        module: { ...module },
        eventType: 'MODULE_START',
        input: { goal: `Execute ${moduleName} for ${taskId}` },
      };
      traceBus.emit(startEvent);

      // Simulate processing time (20-100ms)
      await this.delay(20 + Math.random() * 80);

      if (willFail) {
        traceBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          taskId,
          executionId,
          timestamp: Date.now(),
          module: { ...module },
          eventType: 'ERROR',
          output: { error: `${moduleName} execution failed: timeout exceeded` },
          metadata: { latency: 50 + Math.random() * 30 },
        });
        break;
      }

      traceBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        executionId,
        timestamp: Date.now(),
        module: { ...module },
        eventType: 'MODULE_END',
        output: { result: `${moduleName} completed ok`, duration: 20 + Math.random() * 80 },
        metadata: { latency: 20 + Math.random() * 80 },
      });

      // 30% chance: emit DATA_FLOW to next module
      if (Math.random() < 0.3) {
        const nextModule = path[path.indexOf(moduleName) + 1];
        traceBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          taskId,
          executionId,
          timestamp: Date.now(),
          module: { ...module },
          eventType: 'DATA_FLOW',
          input: { from: moduleName },
          output: { to: nextModule || 'terminal', dataSize: Math.floor(Math.random() * 1024) },
        });
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  abort(): void {
    this.abortController?.abort();
    this._running = false;
  }
}

export const taskGenerator = new TaskGenerator();
