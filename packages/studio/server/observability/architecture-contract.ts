/**
 * Architecture Contract — ARCHITECTURE.md 的机器可读版本
 *
 * 定义每个模块的期望行为：是否必须调用、谁调用它、它调用谁、激活条件。
 * ArchitectureAuditor 将此契约与运行时数据对比，生成合规报告。
 */

export interface ModuleContract {
  name: string;
  required: boolean;
  expectedCallers: string[];
  expectedCallees: string[];
  activation: 'always' | 'on-demand' | 'failure-only' | 'knowledge-task';
  layer: string;
  minCallsPerTask?: number;
  maxLatencyMs?: number;
  description: string;
}

export const ARCHITECTURE_CONTRACT: ModuleContract[] = [
  // ═══ S34 校准：8 层架构（模块名 = 观测面实际发出的模块，required = 每次完整执行必须出现）═══
  // L1 入口与治理
  { name: 'approval-gate', required: true, expectedCallers: ['mission-runtime', 'morpex-runtime'], expectedCallees: [], activation: 'always', layer: 'L1-governance', description: '审批门禁（治理信号）' },
  // L2 Ontology Gate（强制知识门禁 — 绕过即违规）
  { name: 'ontology-service', required: true, expectedCallers: ['morpex-runtime', 'delivery-planner', 'company-facade'], expectedCallees: [], activation: 'knowledge-task', layer: 'L2-gate', description: 'Ontology Gate（强制先查后推）' },
  // L3 规划
  { name: 'delivery-planner', required: true, expectedCallers: ['company-facade'], expectedCallees: [], activation: 'always', layer: 'L3-planning', description: '交付规划器（plan.started/completed）' },
  // L4 认知与大脑（on-demand）
  { name: 'brain-facade', required: false, expectedCallers: ['company-facade'], expectedCallees: [], activation: 'on-demand', layer: 'L4-cognition', description: '大脑门面（学习闭环）' },
  { name: 'learning-loop', required: false, expectedCallers: ['brain-facade'], expectedCallees: [], activation: 'on-demand', layer: 'L4-cognition', description: '学习闭环' },
  // L5 执行
  { name: 'morpex-runtime', required: true, expectedCallers: ['company-facade'], expectedCallees: ['unified-execution-engine', 'artifact-facade', 'evaluation-engine', 'evolution-sandbox'], activation: 'always', layer: 'L5-execution', description: 'MorPexRuntime 主执行管线（runtime.started）' },
  { name: 'mission-runtime', required: true, expectedCallers: ['morpex-runtime', 'control-plane'], expectedCallees: ['pipeline-orchestrator', 'unified-execution-engine'], activation: 'always', layer: 'L5-execution', description: 'Mission 运行时（mission.created）' },
  { name: 'pipeline-orchestrator', required: true, expectedCallers: ['mission-runtime'], expectedCallees: [], activation: 'always', layer: 'L5-execution', description: '管线编排器（pipeline.orchestrated）' },
  { name: 'unified-execution-engine', required: true, expectedCallers: ['morpex-runtime', 'mission-runtime'], expectedCallees: [], activation: 'always', layer: 'L5-execution', description: '统一执行引擎（execution.engine.*）' },
  { name: 'sandbox-manager', required: false, expectedCallers: ['unified-execution-engine'], expectedCallees: [], activation: 'on-demand', layer: 'L5-execution', description: '沙箱管理' },
  // L6 评价
  { name: 'evaluation-engine', required: true, expectedCallers: ['morpex-runtime'], expectedCallees: [], activation: 'always', layer: 'L6-evaluation', description: '评价引擎（evaluation.completed）' },
  // L7 知识与记忆
  { name: 'artifact-facade', required: true, expectedCallers: ['morpex-runtime'], expectedCallees: [], activation: 'always', layer: 'L7-knowledge', description: '产物注册中心（artifact.created）' },
  { name: 'memory-api', required: false, expectedCallers: ['brain-persistor'], expectedCallees: [], activation: 'on-demand', layer: 'L7-knowledge', description: '统一记忆 API' },
  // L8 演化
  { name: 'evolution-sandbox', required: true, expectedCallers: ['morpex-runtime'], expectedCallees: [], activation: 'always', layer: 'L8-evolution', description: '演化沙箱（evolution.completed）' },
  // L9 工作流（on-demand）
  { name: 'workflow-registry', required: false, expectedCallers: [], expectedCallees: [], activation: 'on-demand', layer: 'L9-workflow', description: '工作流注册表' },
  // L10 基础设施
  { name: 'kernel', required: false, expectedCallers: [], expectedCallees: [], activation: 'always', layer: 'L10-infrastructure', description: '内核' },
  { name: 'safety-monitor', required: false, expectedCallers: ['morpex-runtime'], expectedCallees: [], activation: 'always', layer: 'L10-infrastructure', description: '安全监控' },
];
