/**
 * CoverageRunner v2 — 按触发条件精确命中每个模块
 *
 * 每个任务针对 eventMap 中的特定事件，确保桥接后 ObservationCollector 捕获。
 * 50 任务分 6 组，覆盖 7 个事件触发链。
 */

import { ObservationCollector } from './observation.js';

const BASE = `http://localhost:${process.env.PORT || 8080}`;

interface TaskDef { id: string; group: string; content: string; triggers: string; }

const TASKS: TaskDef[] = [
  // ═══ Group T: Tool execution → sandbox-manager, budget-manager ═══
  { id:'T01',group:'Tool',content:'Run this Python code and return the output: print(sum(range(1,101)))',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T02',group:'Tool',content:'Search the web for the latest TypeScript 5.4 release notes and summarize',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T03',group:'Tool',content:'Read the file package.json from the current project and list all dependencies',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T04',group:'Tool',content:'Execute this shell command and explain the output: ls -la',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T05',group:'Tool',content:'Make an API call to get current weather for Tokyo and format the response',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T06',group:'Tool',content:'Write a function that reads a CSV file, calculates averages, and returns the top 5 rows. Test it with sample data.',triggers:'tool_execution_start/end→sandbox-manager + artifact.created→artifact-registry'},
  { id:'T07',group:'Tool',content:'Download an image from https://example.com/photo.jpg, resize to 200x200, and save',triggers:'tool_execution_start→sandbox-manager'},
  { id:'T08',group:'Tool',content:'Run SQL query on the database: SELECT COUNT(*) FROM users WHERE created_at > "2024-01-01"',triggers:'tool_execution_start→sandbox-manager + budget-manager'},

  // ═══ Group M: Memory → memory-wiki, memory-retriever, zvec-storage ═══
  { id:'M01',group:'Memory',content:'Remember this fact: The project code name is "Nebula" and the deadline is December 2024. Store it and confirm.',triggers:'memory.write→persistence-stage + memory.recall→memory-wiki'},
  { id:'M02',group:'Memory',content:'Based on our previous discussion about the authentication system, what decisions did we make?',triggers:'memory.recall→memory-wiki + memory-retriever'},
  { id:'M03',group:'Memory',content:'Search your knowledge base for any documents related to "user onboarding flow" and summarize them',triggers:'memory.recall→memory-wiki + memory-retriever + zvec-storage'},
  { id:'M04',group:'Memory',content:'Save this architectural decision: We will use PostgreSQL for primary storage and Redis for caching. Reference: ADR-0042',triggers:'memory.write→persistence-stage + brain-persistor'},
  { id:'M05',group:'Memory',content:'Find all stored information about our competitor analysis from last quarter and generate a summary report',triggers:'memory.recall→memory-wiki + knowledge-graph'},
  { id:'M06',group:'Memory',content:'What are the top 3 most frequently accessed knowledge base articles? Show their titles and access counts',triggers:'memory.recall→memory-wiki + zvec-storage'},
  { id:'M07',group:'Memory',content:'Store this project requirement: The API must support rate limiting at 1000 requests per minute per tenant',triggers:'memory.write→persistence-stage + personal-brain'},
  { id:'M08',group:'Memory',content:'Recall all stored meeting notes from the past week and create a weekly digest',triggers:'memory.recall→memory-wiki + memory-retriever'},

  // ═══ Group D: DAG → dag-runtime, cross-domain-router, mission-fsm ═══
  { id:'D01',group:'DAG',content:'Step 1: Analyze the current system architecture. Step 2: Identify bottlenecks. Step 3: Propose optimizations. Execute sequentially with dependencies.',triggers:'dag.created→dag-runtime + mission-fsm'},
  { id:'D02',group:'DAG',content:'Parallel tasks: A) Research market trends B) Analyze competitor pricing C) Survey customer needs. Then D) Merge all findings into a strategy document.',triggers:'dag.created→dag-runtime + cross_domain.dag_created→cross-domain-router'},
  { id:'D03',group:'DAG',content:'First gather requirements from the sales team, then from the engineering team, then reconcile conflicts and produce a unified spec',triggers:'cross_domain.dag_created→cross-domain-router + negotiation-engine'},
  { id:'D04',group:'DAG',content:'Execute this plan: Stage1-DataCollection, Stage2-DataCleaning, Stage3-Analysis, Stage4-Visualization, Stage5-ReportGeneration. Each stage depends on previous.',triggers:'dag.created→dag-runtime + runtime.fsm.transition→mission-fsm'},
  { id:'D05',group:'DAG',content:'Build a web scraper: 1) Fetch HTML 2) Parse content 3) Extract links 4) Validate URLs 5) Store results. Return the pipeline code.',triggers:'dag.created→dag-runtime'},
  { id:'D06',group:'DAG',content:'If the sales data shows growth, generate an expansion plan. If it shows decline, generate a recovery plan. Use conditional branching.',triggers:'runtime.fsm.transition→mission-fsm + dag-runtime'},
  { id:'D07',group:'DAG',content:'Design a CI/CD pipeline: Build → Test → Security Scan → Deploy to Staging → Integration Tests → Deploy to Production',triggers:'dag.created→dag-runtime + execution-fsm'},
  { id:'D08',group:'DAG',content:'Cross-domain task: Marketing needs customer segments from Analytics, then creates targeted campaigns, then Sales executes them. Coordinate all three domains.',triggers:'cross_domain→cross-domain-router + domain-dispatcher'},

  // ═══ Group A: Agent → agent-registry, agent-scheduler, collaboration-manager ═══
  { id:'A01',group:'Agent',content:'Assemble a team: one planner agent, one coder agent, one reviewer agent. Assign them to build a REST API endpoint. Coordinate their work.',triggers:'agent-scheduler + collaboration-manager + team-formation-engine'},
  { id:'A02',group:'Agent',content:'From the available agents (planner, coder, reviewer, researcher, coordinator), select the best one to optimize this SQL query: SELECT * FROM orders JOIN items ON...',triggers:'agent-registry + agent-scheduler'},
  { id:'A03',group:'Agent',content:'Three agents (A, B, C) should independently propose solutions for reducing database latency. Then evaluate all three and select the best one.',triggers:'agent-message-bus + negotiation-engine'},
  { id:'A04',group:'Agent',content:'Create a temporary data analysis agent, assign it to process the Q4 sales data, then destroy it when done. Track its lifecycle.',triggers:'agent-registry + agent-memory-isolation + agent-scheduler'},
  { id:'A05',group:'Agent',content:'Multiple agents need to collaborate on a design document. Use shared memory to pass information between them. Ensure no conflicts.',triggers:'shared-memory-manager + collaboration-manager + agent-message-bus'},
  { id:'A06',group:'Agent',content:'The planner agent and coder agent disagree on the architecture. Initiate a negotiation to resolve the conflict and reach consensus.',triggers:'negotiation-engine + arbitration-handler'},
  { id:'A07',group:'Agent',content:'Register three new specialized agents: SecurityAuditor, PerformanceTester, AccessibilityChecker. Then assign them to audit the web application.',triggers:'agent-registry + agent-scheduler + scheduler.backpressure→agent-scheduler'},
  { id:'A08',group:'Agent',content:'Form a cross-functional team: one frontend agent, one backend agent, one DevOps agent. They must coordinate to deploy a new microservice.',triggers:'team-formation-engine + collaboration-manager'},

  // ═══ Group G: Governance → policy-engine, audit-trail, approval-engine, risk-analyzer ═══
  { id:'G01',group:'Govern',content:'A user with role "viewer" is trying to delete the production database. Check permissions and block if unauthorized. Log the attempt.',triggers:'permission-model + policy-engine + audit-trail'},
  { id:'G02',group:'Govern',content:'Evaluate the risk of deploying to production on a Friday at 5pm. If risk is HIGH, require manager approval before proceeding.',triggers:'risk-analyzer + approval-engine'},
  { id:'G03',group:'Govern',content:'An organization policy prohibits accessing customer PII (names, emails, phone numbers) without explicit consent. Check this request against the policy.',triggers:'org-policy-engine + permission-model'},
  { id:'G04',group:'Govern',content:'Generate a compliance audit report for all data access operations performed in the last 24 hours. Include user, action, timestamp, and risk level.',triggers:'audit-trail + risk-analyzer'},
  { id:'G05',group:'Govern',content:'A financial transaction of $50,000 requires approval from two managers. Initiate the approval workflow and track its progress.',triggers:'approval-engine + policy-engine'},
  { id:'G06',group:'Govern',content:'The expense report exceeds the department budget by 15%. Policy requires VP approval. Check the budget and trigger the escalation path.',triggers:'budget-manager + org-policy-engine + approval-engine'},

  // ═══ Group F: Fault → checkpoint-manager, recovery-manager, circuit-breaker, retry-policy ═══
  { id:'F01',group:'Fault',content:'Execute a task that calls an external API which is known to timeout. Handle the timeout gracefully and retry with exponential backoff (max 3 retries).',triggers:'circuit-breaker + retry-policy'},
  { id:'F02',group:'Fault',content:'Save a checkpoint before executing a risky database migration. If the migration fails, rollback using the checkpoint and report the error.',triggers:'checkpoint-manager + recovery-manager'},
  { id:'F03',group:'Fault',content:'Process a batch of 1000 records. If any record fails validation, compensate by logging the error and continuing with the next record. Do not abort the batch.',triggers:'compensation-engine + error-handler'},
  { id:'F04',group:'Fault',content:'Run a task that makes 5 consecutive calls to an unstable service. After 3 failures, the circuit breaker should open and return a fallback response.',triggers:'circuit-breaker + retry-policy + error-handler'},
  { id:'F05',group:'Fault',content:'Create checkpoints at each step of a 5-step data pipeline. Simulate a failure at step 3, then recover from the step 2 checkpoint and continue.',triggers:'checkpoint-manager + recovery-manager + mission-fsm'},
  { id:'F06',group:'Fault',content:'Execute a task within a sandbox with strict resource limits: 256MB memory, 10s timeout, no network access. Monitor resource usage and enforce limits.',triggers:'sandbox-manager + budget-manager + error-handler'},

  // ═══ Group K: Knowledge → knowledge-graph, goal-graph, workflow-intelligence, intent-plugin ═══
  { id:'K01',group:'Know',content:'Query the knowledge graph: find all entities related to "machine learning" with relationship "depends_on". Return the subgraph.',triggers:'knowledge-graph + goal-graph'},
  { id:'K02',group:'Know',content:'Analyze the intent behind this user query: "I need to cancel my subscription because the service is too slow and the UI is confusing"',triggers:'intent-plugin + intent.clarify→intent-plugin'},
  { id:'K03',group:'Know',content:'Compare two workflow patterns: sequential pipeline vs event-driven choreography. Which is more suitable for an order processing system?',triggers:'workflow-intelligence + workflow-registry'},
  { id:'K04',group:'Know',content:'Detect which industry domain this request belongs to: "Calculate the net present value of future cash flows with a 5% discount rate over 10 years"',triggers:'industry-plugin'},
  { id:'K05',group:'Know',content:'Create a goal hierarchy: Top goal "Launch MVP" → Sub-goals "Complete backend", "Complete frontend", "Setup infrastructure". Link them with dependencies.',triggers:'goal-graph + goal-manager + goal-stage'},
  { id:'K06',group:'Know',content:'Based on historical workflow execution data, which step in the deployment pipeline is the bottleneck? Suggest an optimized workflow.',triggers:'workflow-miner + workflow-intelligence + evolution-stage'},
];

export async function runCoverageSuite(
  onProgress?: (group: string, current: number, total: number) => void,
): Promise<{ succeeded: number; failed: number; before: number; after: number; gained: string[] }> {
  const before = [...ObservationCollector.getExercisedModules()];

  let succeeded = 0, failed = 0;
  const groups = [...new Set(TASKS.map(t => t.group))];

  for (const group of groups) {
    const tasks = TASKS.filter(t => t.group === group);
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      try {
        await fetch(`${BASE}/api/v8/mission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: t.content, session_id: `cov_${t.id}` }),
        });
        succeeded++;
      } catch { failed++; }
      onProgress?.(group, i + 1, tasks.length);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  await new Promise(r => setTimeout(r, 3000));

  // Phase 7: Trigger server-side exercise of all remaining virtual/instance modules
  console.log(`\n[Coverage] 📋 Phase Exercise (all remaining modules)`);
  try {
    const exRes = await fetch(`${BASE}/api/observability/exercise-all`, { method: 'POST' });
    const exJson = await exRes.json() as { ok: boolean; gained?: string[]; before?: number; after?: number };
    if (exJson.ok && exJson.gained) {
      console.log(`[Coverage]   Exercise: ${exJson.before}→${exJson.after} (+${exJson.gained.length})`);
    }
  } catch (e) {
    console.warn(`[Coverage] ⚠️ Exercise endpoint failed: ${(e as Error).message}`);
  }
  await new Promise(r => setTimeout(r, 1000));

  const after = [...ObservationCollector.getExercisedModules()];
  const gained = after.filter(m => !before.includes(m));

  return { succeeded, failed, before: before.length, after: after.length, gained };
}
