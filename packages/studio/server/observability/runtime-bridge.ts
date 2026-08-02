/**
 * runtime-bridge — 核心运行时 → 可观测面 的桥接器
 *
 * 解决"架构黑盒"问题：真实执行（/api/execute、/api/chat/send、MorPexRuntime.run 等）
 * 在核心 EventBus 上发出的事件，此前从不流入 ObservationCollector，
 * 导致 /api/observability 的 observations/topology/heartbeats 全空、/audit 503。
 *
 * 本模块：
 *   1. 订阅核心 EventBus（projected 事件，含全部执行/产物/演化/门禁事件）
 *   2. 按 executionId 建立父子 span 链（首个事件=根，后续=子），映射到 8 层架构
 *   3. collect() 到 ObservationCollector → observations/exercised/heartbeats/topology 全部可见
 *   4. 接线 ArchitectureAuditor / ReplayEngine / ExecutionTracer → /audit、/replay 可用
 *
 * 层模型（对齐 docs/AICOS_CORE_ARCHITECTURE.md 8 层）：
 *   L1-governance / L2-gate / L3-planning / L4-cognition / L5-execution /
 *   L6-evaluation / L7-knowledge / L8-evolution / L9-workflow / L10-infrastructure
 */
import type { EventBus } from '../../../core/src/infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../../../core/src/infrastructure/common/types.js';
import { ObservationCollector } from './observation.js';
import { traceBus } from './event-bus.js';
import { ArchitectureAuditor } from './architecture-auditor.js';
import { ReplayEngine } from './replay-engine.js';
import { createExecutionTracer } from './execution-tracer.js';
import type { Observation } from './observation.js';

// ── 事件类型 → (模块, 层) 映射（按前缀匹配，越靠前越具体）──
interface LayerRule {
  module: string;
  layer: string;
}
const EVENT_LAYER_RULES: Array<[RegExp, LayerRule]> = [
  [/^mission\./, { module: 'mission-runtime', layer: 'L5-execution' }],
  [/^plan\./, { module: 'delivery-planner', layer: 'L3-planning' }],
  [/^planner\./, { module: 'delivery-planner', layer: 'L3-planning' }],
  [/^execution\./, { module: 'unified-execution-engine', layer: 'L5-execution' }],
  [/^artifact\./, { module: 'artifact-facade', layer: 'L7-knowledge' }],
  [/^ontology\./, { module: 'ontology-service', layer: 'L2-gate' }],
  [/^evolution\./, { module: 'evolution-sandbox', layer: 'L8-evolution' }],
  [/^approval\./, { module: 'approval-gate', layer: 'L1-governance' }],
  [/^sandbox\./, { module: 'sandbox-manager', layer: 'L5-execution' }],
  [/^memory\./, { module: 'memory-api', layer: 'L7-knowledge' }],
  [/^brain\./, { module: 'brain-facade', layer: 'L4-cognition' }],
  [/^learning\./, { module: 'learning-loop', layer: 'L4-cognition' }],
  [/^evaluation\./, { module: 'evaluation-engine', layer: 'L6-evaluation' }],
  [/^control\.|^policy\.|^governance\./, { module: 'control-plane', layer: 'L1-governance' }],
  [/^gateway\./, { module: 'company-facade', layer: 'L1-governance' }],
  [/^kernel\./, { module: 'kernel', layer: 'L10-infrastructure' }],
  [/^safety\./, { module: 'safety-monitor', layer: 'L10-infrastructure' }],
  [/^runtime\./, { module: 'morpex-runtime', layer: 'L5-execution' }],
  [/^pipeline\./, { module: 'pipeline-orchestrator', layer: 'L5-execution' }],
  [/^workflow\./, { module: 'workflow-registry', layer: 'L9-workflow' }],
];

function resolve(eventType: string): LayerRule {
  for (const [re, rule] of EVENT_LAYER_RULES) {
    if (re.test(eventType)) return rule;
  }
  return { module: 'runtime-event', layer: 'L10-infrastructure' };
}

function resolveStatus(eventType: string): Observation['status'] {
  if (/failed|error|blocked/.test(eventType)) return 'failed';
  if (/started|begin|pending/.test(eventType)) return 'started';
  return 'success';
}

// ── 每 executionId 的 span 链（首个事件为根）──
const lastSpanByExec = new Map<string, string>();

function bridgeEvent(event: MorPexEvent): void {
  if (!event?.type || !event?.executionId) return;
  const { module, layer } = resolve(event.type);
  const executionId = event.executionId;
  const parentId = lastSpanByExec.get(executionId);
  const obsId = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  ObservationCollector.registerModule(module, layer);
  ObservationCollector.collect({
    id: obsId,
    traceId: `trace_${executionId}`,
    executionId,
    taskId: executionId,
    parentId,
    type: 'SPAN',
    source: { module, layer, version: '1.0.0' },
    operation: event.type,
    timestamp: event.timestamp ?? Date.now(),
    status: resolveStatus(event.type),
    payload: event.payload,
    metadata: { eventType: event.type, source: event.source },
  });
  lastSpanByExec.set(executionId, obsId);
}

/**
 * startObservabilityBridge — 订阅核心 EventBus，将真实执行桥接到观测面
 * 幂等：重复调用先清掉旧订阅标记（用 Set 防重复注册）。
 */
let bridgeSubscribed = false;
export function startObservabilityBridge(eventBus: EventBus): void {
  if (bridgeSubscribed) return;
  bridgeSubscribed = true;
  eventBus.onProjected(bridgeEvent);
  console.log('[ObservabilityBridge] ✅ 已接线：核心 EventBus → ObservationCollector（真实执行可观测）');
}

/**
 * wireObservabilityServices — 接线 /audit、/replay 所需服务（此前全部未初始化 → 503）
 */
export function wireObservabilityServices(): void {
  (traceBus as any)._services = {
    archAuditor: new ArchitectureAuditor(),
    replayEngine: new ReplayEngine(),
    execTracer: createExecutionTracer({ autoFlush: true }),
  };
  console.log('[ObservabilityBridge] ✅ 服务接线：ArchitectureAuditor/ReplayEngine/ExecutionTracer → /audit /replay 可用');
}

/** 测试/重置用：清空 span 链状态 */
export function resetBridgeState(): void {
  lastSpanByExec.clear();
}
