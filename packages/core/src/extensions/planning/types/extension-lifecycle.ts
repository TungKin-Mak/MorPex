import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { Milestone } from './config.js';
import type { SimulationReport, DAGPatch, DeviationEvent, PrePlanContext, PrePlanResult, PostPlanContext, PostPlanResult, RuntimeEventContext, RuntimeEventResult, MemoryBusLogEntry } from './simulation.js';

// ═══════════════════════════════════════════════════════════════
// Section 10: v2 扩展 - 插件扩展接口与控制器
// ═══════════════════════════════════════════════════════════════

/**
 * IPlanningExtension — 计划扩展生命周期接口
 *
 * 所有 v2 认知引擎（及 v1 能力适配器）都必须实现此接口。
 * 通过 MetaPlanner v2 的 registerExtension() 注册。
 */
export interface IPlanningExtension {
  /** 扩展名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小越先执行，默认 100） */
  priority?: number;

  /**
   * onPrePlan — DAG Generator 运行前触发
   * 用于上下文增强、战略拆解。
   */
  onPrePlan?(context: PrePlanContext): Promise<PrePlanResult>;

  /**
   * onPostPlan — 静态图生成后触发
   * 用于前瞻模拟演练。
   */
  onPostPlan?(plan: PostPlanContext): Promise<PostPlanResult>;

  /**
   * onRuntimeEvent — 运行时 MemoryBus 事件触发
   * 用于动态反射重规划。
   */
  onRuntimeEvent?(event: RuntimeEventContext, controller: IRuntimeController): Promise<RuntimeEventResult>;
}

/**
 * IRuntimeController — 运行时影子控制句柄
 *
 * 提供给 onRuntimeEvent 扩展的有限控制接口，
 * 限制扩展只能通过此句柄影响运行时，不能直接操作内核。
 */
export interface IRuntimeController {
  /**
   * pause — 挂起 DAG 执行
   * 在执行热修补前暂停调度器。
   */
  pause(): void;

  /**
   * patchDAG — 应用 DAG 热修补
   * 对后续未执行的节点进行拓扑修正。
   */
  patchDAG(patch: DAGPatch): Promise<boolean>;

  /**
   * resume — 恢复 DAG 执行
   * 热修补完成后恢复调度器。
   */
  resume(): void;

  /**
   * getDeviationCount — 获取当前 session 的偏离计数
   */
  getDeviationCount(sessionId: string): number;
}

// ═══════════════════════════════════════════════════════════════
// Section 11: v2 扩展 - MemoryBus 事件接口
// ═══════════════════════════════════════════════════════════════

/**
 * MemoryBusEvent — MemoryBus 本地事件
 *
 * 进程内 MemoryBus 发射的本地状态变更事件。
 */
export interface MemoryBusEvent {
  type: string;
  sessionId: string;
  executionId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * ExtendedMemoryBus — 扩展后的 MemoryBus 接口
 *
 * 在原有 remember/recall 基础上增加了事件订阅、发射和 JSONL 追踪能力。
 */
export interface ExtendedMemoryBus {
  /** 记忆写入 */
  remember(params: {
    content: string;
    source: string;
    sourceId: string;
    tags: string[];
    importance: number;
  }): Promise<void>;

  /** 记忆检索 */
  recall(params: { text: string; topK: number }): Promise<string[]>;

  /** 订阅本地事件 */
  on(eventType: string, handler: (event: MemoryBusEvent) => void): () => void;

  /** 发射本地事件 */
  emit(event: MemoryBusEvent): void;

  /** 追加 JSONL 追踪日志 */
  appendLog(entry: MemoryBusLogEntry): Promise<void>;
}

