const fs = require('fs');

// Read original file
let content = fs.readFileSync('E:/Morpex/packages/studio/server/StudioServer.ts', 'utf-8');

// ============================================================
// Step 1: Add v8.5 imports
// ============================================================

const oldImport = "import { MetaPlannerAdapter, DAGExecutorAdapter, GatewayMissionHandler } from '../../core/src/runtime/mission/adapters/index.js';\nimport { VerificationEngine } from '../../core/src/runtime/verification/index.js';\nimport { ApprovalEngine } from '../../core/src/runtime/approval/index.js';\nimport { RiskAnalyzer } from '../../core/src/control/index.js';\nimport { AuditTrail } from '../../core/src/control/index.js';";

const newImport = "import { MetaPlannerAdapter, DAGExecutorAdapter, GatewayMissionHandler } from '../../core/src/runtime/mission/adapters/index.js';\nimport { VerificationEngine } from '../../core/src/runtime/verification/index.js';\nimport { ApprovalEngine } from '../../core/src/runtime/approval/index.js';\nimport { RiskAnalyzer } from '../../core/src/control/index.js';\nimport { AuditTrail } from '../../core/src/control/index.js';\n\n// ── v8.5 升级模块 ──\nimport { CognitiveLoop } from '../../core/src/runtime/cognitive-loop/CognitiveLoop.js';\nimport { BehaviorTwin } from '../../core/src/cognition/twin/BehaviorTwin.js';\nimport { DecisionTwin } from '../../core/src/cognition/decision/DecisionTwin.js';\nimport { PreferenceModel } from '../../core/src/cognition/twin/PreferenceModel.js';\nimport { PersonalBrain, BrainPersistor } from '../../core/src/cognition/memory/index.js';\nimport { WorkflowMiner } from '../../core/src/evolution/workflow/WorkflowMiner.js';\nimport { WorkflowRegistry } from '../../core/src/evolution/workflow/WorkflowRegistry.js';\nimport { WorkflowExecutor } from '../../core/src/evolution/workflow/WorkflowExecutor.js';\nimport { EventStore as EventSourcingStore, EventProjection } from '../../core/src/protocol/events/store/index.js';";

content = content.replace(oldImport, newImport);
console.log("Step 1: Imports updated");

// ============================================================
// Step 2: Add v8.5 fields
// ============================================================

const oldFields = "  // ── v8 模块 ──\n  private v8Gateway?: MessageGateway;\n  private v8MissionRuntime?: MissionRuntime;\n  private v8Verification?: VerificationEngine;\n  private v8Approval?: ApprovalEngine;\n  private v8RiskAnalyzer?: RiskAnalyzer;\n  private v8AuditTrail?: AuditTrail;";

const newFields = "  // ── v8 模块 ──\n  private v8Gateway?: MessageGateway;\n  private v8MissionRuntime?: MissionRuntime;\n  private v8Verification?: VerificationEngine;\n  private v8Approval?: ApprovalEngine;\n  private v8RiskAnalyzer?: RiskAnalyzer;\n  private v8AuditTrail?: AuditTrail;\n\n  // ── v8.5 升级模块 ──\n  private v8CognitiveLoop?: CognitiveLoop;\n  private v8BehaviorTwin?: BehaviorTwin;\n  private v8DecisionTwin?: DecisionTwin;\n  private v8PreferenceModel?: PreferenceModel;\n  private v8PersonalBrain?: PersonalBrain;\n  private v8WorkflowRegistry?: WorkflowRegistry;\n  private v8WorkflowMiner?: WorkflowMiner;\n  private v8WorkflowExecutor?: WorkflowExecutor;\n  private v8EventSourcingStore?: EventSourcingStore;\n  private v8PeriodicTimer?: ReturnType<typeof setInterval>;";

content = content.replace(oldFields, newFields);
console.log("Step 2: Fields updated");

// ============================================================
// Step 3: Replace initV8Modules method
// ============================================================

const oldMethodStart = "  /** ★ v8: 初始化 v8 模块（MessageGateway + MissionRuntime + 适配器） */\n  private async initV8Modules(";
const methodEndMarker = "\n\n  /** ★ v3.2: 接线 DomainDispatcher 回调 → SessionManager */";

const startIdx = content.indexOf(oldMethodStart);
const endIdx = content.indexOf(methodEndMarker, startIdx);

if (startIdx < 0 || endIdx < 0) {
  console.log('ERROR: cannot find initV8Modules boundaries');
  process.exit(1);
}

console.log("Found initV8Modules at", startIdx, "to", endIdx);

// Build new method content
const newMethod = `  /** ★ v8: 初始化 v8 模块（MessageGateway + MissionRuntime + CognitiveLoop + 全链路） */
  private async initV8Modules(
    bus: import('../../core/src/common/EventBus.js').EventBus,
    identity: import('../../core/src/common/ExecutionIdentity.js').ExecutionIdentity
  ): Promise<void> {
    try {
      // ═══════════════════════════════════════════════════════
      // v8.5: PersonalBrain + Workflow Evolution 初始化
      // ═══════════════════════════════════════════════════════

      // ── PersonalBrain（五层记忆） ──
      this.v8PersonalBrain = new PersonalBrain();

      // ── Workflow Registry + Miner ──
      this.v8WorkflowRegistry = new WorkflowRegistry();
      const workflowMemory = this.v8PersonalBrain.workflow;
      this.v8WorkflowMiner = new WorkflowMiner(workflowMemory);

      // ── BehaviorTwin + DecisionTwin + PreferenceModel ──
      this.v8BehaviorTwin = new BehaviorTwin('default');
      this.v8DecisionTwin = new DecisionTwin();
      this.v8PreferenceModel = new PreferenceModel();

      // ── Event Sourcing Store（强制执行） ──
      this.v8EventSourcingStore = new EventSourcingStore({
        dataDir: './data/event-sourcing-v8',
      });
      await this.v8EventSourcingStore.load();
      console.log('  ├─ v8.5 EventStore   ✅ (Event Sourcing 强制)');

      // ── Restore PersonalBrain from MemoryWiki ──
      if (this.wiki) {
        await BrainPersistor.restore(this.v8PersonalBrain, this.wiki);
        console.log('  ├─ v8.5 BrainRestore ✅ (MemoryWiki)');
      }

      // ═══════════════════════════════════════════════════════
      // v8: MessageGateway + MissionRuntime
      // ═══════════════════════════════════════════════════════

      // ── 1. MessageGateway ──
      this.v8Gateway = new MessageGateway(bus);
      const webAdapter = new WebAdapter();
      this.v8Gateway.registerAdapter(webAdapter);
      console.log('  ├─ v8 Gateway     ✅');

      // ── 2. Verification + Approval + Risk + Audit ──
      this.v8Verification = new VerificationEngine();
      this.v8Approval = new ApprovalEngine(bus);
      this.v8RiskAnalyzer = new RiskAnalyzer();
      this.v8AuditTrail = new AuditTrail();
      console.log('  ├─ v8 Verification ✅');
      console.log('  ├─ v8 Approval    ✅');
      console.log('  ├─ v8 RiskAnalyzer ✅');
      console.log('  ├─ v8 AuditTrail  ✅');

      // ── 3. MissionRuntime ──
      this.v8MissionRuntime = new MissionRuntime(bus, {
        verificationEngine: this.v8Verification,
        approvalEngine: this.v8Approval,
      });

      // ★ v8.5: 强制启用 Event Sourcing
      this.v8MissionRuntime.setEventStore(this.v8EventSourcingStore);
      console.log('  ├─ v8.5 EventSrc   ✅ (已注入 MissionRuntime)');

      // ── 4. Planner Adapter (MetaPlanner + Twin 约束) ──
      if (this.metaPlanner) {
        const plannerAdapter = new MetaPlannerAdapter(this.metaPlanner);
        this.v8MissionRuntime.setPlanner(plannerAdapter);
        console.log('  ├─ v8 PlannerAdapter ✅ (Twin 约束已注入)');
      } else {
        console.warn('  ├─ v8 PlannerAdapter ⚠️ MetaPlanner 未就绪，使用默认规划器');
      }

      // ── 5. Executor Adapter (委托 DomainDispatcher) ──
      if (this.domainDispatcher) {
        const executorAdapter = {
          execute: async (mission: any, plan: any) => {
            const startTime = Date.now();
            let completed = 0; let failed = 0;
            const errors: string[] = [];
            for (const step of plan.steps) {
              try {
                const node = { taskId: step.id, domain: step.domain, goal: step.description, deps: step.deps || [], status: 'pending' as const };
                const sessionCtx = { sessionId: mission.context?.sessionId || 'mis_' + mission.id, executionId: mission.id, input: step.description, artifacts: {} as Record<string, any[]>, memory: [] };
                const result = await this.domainDispatcher!.executeNode(node, sessionCtx);
                if (result.status === 'completed') completed++;
                else { failed++; e
