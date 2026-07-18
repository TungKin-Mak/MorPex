/**
 * IPlanningExtension — 计划扩展生命周期接口
 *
 * v2 核心抽象：所有认知引擎（及 v1 适配器）以统一的生命周期拦截点接入 MetaPlanner。
 *
 * 拦截点：
 *   onPrePlan   — DAG Generator 运行前（上下文增强、战略拆解）
 *   onPostPlan  — 静态图生成后（前瞻模拟演练）
 *   onRuntimeEvent — 运行时 MemoryBus 事件（动态反射重规划）
 *
 * 设计约束：
 *   - 所有方法均为可选（no-op 扩展不需要实现全部）
 *   - 所有方法返回 Promise，支持异步操作
 *   - onRuntimeEvent 接收 IRuntimeController 影子句柄，限制操作范围
 *
 * @see PrePlanContext — 注入 KnowledgeGraph/ArtifactRegistry 等系统资源
 * @see PostPlanContext — 包含生成的 ExecutionDAG
 * @see RuntimeEventContext — 包含 DeviationEvent + DAGEngine 引用
 * @see IRuntimeController — 有限控制句柄（pause/patchDAG/resume）
 */

export type {
  IPlanningExtension,
  PrePlanContext,
  PrePlanResult,
  PostPlanContext,
  PostPlanResult,
  RuntimeEventContext,
  RuntimeEventResult,
  IRuntimeController,
} from '../types.js';
