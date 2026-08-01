/**
 * runtime/mission/adapters — Mission Runtime 适配器 barrel
 *
 * P0 架构完善: 将新 v8 模块连接到现有引擎。
 *
 * 适配器清单：
 *   MetaPlannerAdapter  — MissionRuntime → MetaPlanner（7-Stage Pipeline）
 *   DAGExecutorAdapter  — MissionRuntime → DAGRuntime（TaskGraph/Scheduler）
 *   GatewayMissionHandler — deprecated, replaced by CognitiveLoop
 */

export { MetaPlannerAdapter } from './MetaPlannerAdapter.js';
export { DAGExecutorAdapter } from './DAGExecutorAdapter.js';
