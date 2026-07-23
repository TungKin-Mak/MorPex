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
  // ═══ Control Plane ═══
  { name: 'policy-engine', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '策略引擎' },
  { name: 'risk-analyzer', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '风险分析器' },
  { name: 'permission-model', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '权限模型' },
  { name: 'audit-trail', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '审计追踪' },
  { name: 'org-policy-engine', required: false, expectedCallers: ['agent-scheduler'], expectedCallees: [], activation: 'on-demand', layer: 'control-plane', description: '组织策略引擎' },
  { name: 'intent-plugin', required: true, expectedCallers: ['intent-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '意图插件' },
  { name: 'industry-plugin', required: false, expectedCallers: ['intent-stage'], expectedCallees: [], activation: 'on-demand', layer: 'control-plane', description: '行业插件' },
  { name: 'meta-planner', required: true, expectedCallers: ['planning-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '元规划器' },
  { name: 'circuit-breaker', required: true, expectedCallers: ['error-handler'], expectedCallees: [], activation: 'failure-only', layer: 'control-plane', description: '熔断器' },
  { name: 'error-handler', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['circuit-breaker', 'retry-policy'], activation: 'failure-only', layer: 'control-plane', description: '错误处理器' },
  { name: 'retry-policy', required: true, expectedCallers: ['error-handler'], expectedCallees: [], activation: 'failure-only', layer: 'control-plane', description: '重试策略' },
  { name: 'metrics-collector', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '指标收集器' },
  { name: 'health-check', required: false, expectedCallers: [], expectedCallees: [], activation: 'on-demand', layer: 'control-plane', description: '健康检查' },
  { name: 'context-assembly-engine', required: true, expectedCallers: ['context-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '上下文组装引擎' },
  { name: 'meta-planner-adapter', required: true, expectedCallers: ['mission-runtime'], expectedCallees: ['meta-planner'], activation: 'always', layer: 'control-plane', description: '元规划适配器' },
  { name: 'verification-engine', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'control-plane', description: '验证引擎' },
  { name: 'approval-engine', required: false, expectedCallers: ['mission-runtime'], expectedCallees: [], activation: 'on-demand', layer: 'control-plane', description: '审批引擎' },

  // ═══ Cognitive Pipeline ═══
  { name: 'cognitive-pipeline', required: true, expectedCallers: ['message-gateway'], expectedCallees: ['context-stage','intent-stage','goal-stage','twin-stage','planning-stage','execution-stage','learning-stage','evolution-stage','persistence-stage'], activation: 'always', layer: 'control-plane', description: '认知管线' },
  { name: 'context-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['context-assembly-engine'], activation: 'always', layer: 'control-plane', description: '上下文阶段' },
  { name: 'intent-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['intent-plugin'], activation: 'always', layer: 'control-plane', description: '意图阶段' },
  { name: 'goal-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['goal-manager','goal-graph'], activation: 'always', layer: 'control-plane', description: '目标阶段' },
  { name: 'twin-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['behavior-twin','decision-twin'], activation: 'always', layer: 'control-plane', description: '双胞胎阶段' },
  { name: 'planning-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['meta-planner'], activation: 'always', layer: 'control-plane', description: '规划阶段' },
  { name: 'execution-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['mission-runtime','domain-dispatcher','sandbox-manager','verification-engine'], activation: 'always', layer: 'control-plane', description: '执行阶段' },
  { name: 'learning-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['cross-agent-learning'], activation: 'always', layer: 'control-plane', description: '学习阶段' },
  { name: 'evolution-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['workflow-registry','workflow-miner'], activation: 'always', layer: 'control-plane', description: '进化阶段' },
  { name: 'persistence-stage', required: true, expectedCallers: ['cognitive-pipeline'], expectedCallees: ['memory-wiki','brain-persistor'], activation: 'always', layer: 'control-plane', description: '持久化阶段' },

  // ═══ Runtime Kernel ═══
  { name: 'mission-runtime', required: true, expectedCallers: ['execution-stage'], expectedCallees: ['mission-fsm','domain-dispatcher'], activation: 'always', layer: 'runtime', minCallsPerTask: 1, description: '任务运行时' },
  { name: 'mission-fsm', required: true, expectedCallers: ['mission-runtime'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '任务状态机' },
  { name: 'dag-runtime', required: true, expectedCallers: ['cross-domain-router'], expectedCallees: ['domain-dispatcher'], activation: 'always', layer: 'runtime', description: 'DAG运行时' },
  { name: 'execution-fsm', required: true, expectedCallers: ['domain-dispatcher'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '执行状态机' },
  { name: 'checkpoint-manager', required: true, expectedCallers: ['recovery-manager'], expectedCallees: [], activation: 'failure-only', layer: 'runtime', description: '检查点管理器' },
  { name: 'recovery-manager', required: true, expectedCallers: ['error-handler'], expectedCallees: ['checkpoint-manager'], activation: 'failure-only', layer: 'runtime', description: '恢复管理器' },
  { name: 'sandbox-manager', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'runtime', minCallsPerTask: 1, description: '沙箱管理器' },
  { name: 'budget-manager', required: true, expectedCallers: ['execution-stage'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '预算管理器' },
  { name: 'compensation-engine', required: true, expectedCallers: ['recovery-manager'], expectedCallees: [], activation: 'failure-only', layer: 'runtime', description: '补偿引擎' },
  { name: 'domain-dispatcher', required: true, expectedCallers: ['mission-runtime','dag-runtime'], expectedCallees: ['execution-fsm','negotiation-engine','arbitration-handler'], activation: 'always', layer: 'runtime', minCallsPerTask: 1, description: '领域调度器' },
  { name: 'cross-domain-router', required: true, expectedCallers: ['mission-runtime'], expectedCallees: ['dag-runtime'], activation: 'always', layer: 'runtime', description: '跨领域路由器' },
  { name: 'negotiation-engine', required: false, expectedCallers: ['domain-dispatcher'], expectedCallees: ['arbitration-handler'], activation: 'on-demand', layer: 'runtime', description: '协商引擎' },
  { name: 'arbitration-handler', required: false, expectedCallers: ['negotiation-engine'], expectedCallees: [], activation: 'on-demand', layer: 'runtime', description: '仲裁处理器' },
  { name: 'session-manager', required: true, expectedCallers: ['message-gateway'], expectedCallees: ['session-repo'], activation: 'always', layer: 'runtime', description: '会话管理器' },
  { name: 'session-repo', required: true, expectedCallers: ['session-manager'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '会话仓库' },
  { name: 'session-store', required: true, expectedCallers: ['session-manager'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '会话持久化引擎' },
  { name: 'event-sourcing-store', required: true, expectedCallers: ['mission-runtime'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '事件溯源存储' },
  { name: 'unified-event-store', required: true, expectedCallers: ['cognitive-pipeline','mission-runtime'], expectedCallees: [], activation: 'always', layer: 'runtime', description: '统一事件存储' },
  { name: 'domain-manager', required: true, expectedCallers: ['studio-orchestrator'], expectedCallees: ['domain-dispatcher'], activation: 'always', layer: 'runtime', description: '领域管理器' },
  { name: 'studio-orchestrator', required: true, expectedCallers: ['message-gateway'], expectedCallees: ['domain-dispatcher','cross-domain-router'], activation: 'always', layer: 'runtime', description: 'Studio编排器' },
  { name: 'dag-executor-adapter', required: true, expectedCallers: ['mission-runtime'], expectedCallees: ['domain-dispatcher'], activation: 'always', layer: 'runtime', description: 'DAG执行适配器' },

  // ═══ Agent Plane ═══
  { name: 'agent-registry', required: true, expectedCallers: ['agent-scheduler'], expectedCallees: ['agent-memory-isolation'], activation: 'always', layer: 'runtime', description: 'Agent注册中心' },
  { name: 'agent-scheduler', required: true, expectedCallers: ['collaboration-manager','domain-dispatcher'], expectedCallees: ['agent-registry','org-policy-engine'], activation: 'always', layer: 'runtime', description: 'Agent调度器' },
  { name: 'agent-message-bus', required: true, expectedCallers: ['collaboration-manager'], expectedCallees: [], activation: 'always', layer: 'runtime', description: 'Agent消息总线' },
  { name: 'collaboration-manager', required: false, expectedCallers: ['mission-runtime'], expectedCallees: ['agent-scheduler','agent-message-bus','team-formation-engine','shared-memory-manager'], activation: 'on-demand', layer: 'runtime', description: '协作管理器' },
  { name: 'team-formation-engine', required: false, expectedCallers: ['collaboration-manager'], expectedCallees: [], activation: 'on-demand', layer: 'runtime', description: '团队组建引擎' },
  { name: 'cross-agent-learning', required: false, expectedCallers: ['learning-stage'], expectedCallees: [], activation: 'knowledge-task', layer: 'runtime', description: '跨Agent学习' },
  { name: 'shared-memory-manager', required: false, expectedCallers: ['collaboration-manager'], expectedCallees: [], activation: 'on-demand', layer: 'runtime', description: '共享内存管理器' },
  { name: 'agent-memory-isolation', required: true, expectedCallers: ['agent-registry'], expectedCallees: [], activation: 'always', layer: 'runtime', description: 'Agent内存隔离' },

  // ═══ Knowledge Plane ═══
  { name: 'behavior-twin', required: true, expectedCallers: ['twin-stage'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '行为双胞胎' },
  { name: 'decision-twin', required: true, expectedCallers: ['twin-stage'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '决策双胞胎' },
  { name: 'personal-brain', required: true, expectedCallers: ['twin-stage','persistence-stage'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '个人大脑' },
  { name: 'preference-model', required: false, expectedCallers: ['twin-stage'], expectedCallees: [], activation: 'on-demand', layer: 'knowledge', description: '偏好模型' },
  { name: 'goal-manager', required: true, expectedCallers: ['goal-stage'], expectedCallees: ['goal-graph'], activation: 'always', layer: 'knowledge', description: '目标管理器' },
  { name: 'goal-graph', required: false, expectedCallers: ['goal-manager'], expectedCallees: [], activation: 'on-demand', layer: 'knowledge', description: '目标图谱' },
  { name: 'knowledge-graph', required: true, expectedCallers: ['context-stage'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '知识图谱' },
  { name: 'artifact-registry', required: true, expectedCallers: ['execution-stage'], expectedCallees: ['artifact-writer'], activation: 'always', layer: 'knowledge', description: '产物注册表' },
  { name: 'artifact-writer', required: true, expectedCallers: ['artifact-registry'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '产物写入器' },
  { name: 'artifact-plane', required: false, expectedCallers: ['artifact-registry'], expectedCallees: [], activation: 'on-demand', layer: 'knowledge', description: '产物平面' },
  { name: 'memory-wiki', required: true, expectedCallers: ['persistence-stage','context-stage'], expectedCallees: ['memory-retriever','zvec-storage'], activation: 'always', layer: 'knowledge', description: '记忆维基' },
  { name: 'memory-retriever', required: true, expectedCallers: ['memory-wiki'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '记忆检索器' },
  { name: 'zvec-storage', required: true, expectedCallers: ['memory-wiki'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '向量存储' },
  { name: 'history-store', required: true, expectedCallers: ['session-manager'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '历史存储' },
  { name: 'brain-persistor', required: true, expectedCallers: ['persistence-stage'], expectedCallees: [], activation: 'always', layer: 'knowledge', description: '大脑持久化' },
  { name: 'workflow-intelligence', required: false, expectedCallers: ['evolution-stage'], expectedCallees: [], activation: 'knowledge-task', layer: 'knowledge', description: '工作流智能' },
  { name: 'doc-watcher', required: false, expectedCallers: [], expectedCallees: [], activation: 'on-demand', layer: 'knowledge', description: '文档监视器' },
  { name: 'doc-topology', required: false, expectedCallers: [], expectedCallees: [], activation: 'on-demand', layer: 'knowledge', description: '文档拓扑' },

  // ═══ Interaction ═══
  { name: 'message-gateway', required: true, expectedCallers: [], expectedCallees: ['cognitive-pipeline','session-manager'], activation: 'always', layer: 'interaction', description: '消息网关' },

  // ═══ Evolution Plane ═══
  { name: 'workflow-miner', required: false, expectedCallers: ['evolution-stage'], expectedCallees: [], activation: 'knowledge-task', layer: 'evolution', description: '工作流挖掘器' },
  { name: 'workflow-registry', required: true, expectedCallers: ['evolution-stage'], expectedCallees: ['workflow-executor'], activation: 'always', layer: 'evolution', description: '工作流注册表' },
  { name: 'workflow-executor', required: false, expectedCallers: ['workflow-registry'], expectedCallees: [], activation: 'on-demand', layer: 'evolution', description: '工作流执行器' },

  // ═══ Cognitive Loop ═══
  { name: 'cognitive-loop', required: false, expectedCallers: ['message-gateway'], expectedCallees: ['execution-stage'], activation: 'always', layer: 'control-plane', description: '认知循环引擎' },
];
