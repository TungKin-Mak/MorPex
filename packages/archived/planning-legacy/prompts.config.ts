/**
 * prompts.config.ts — Externalized LLM Prompts for the 7-Stage Pipeline
 *
 * DESIGN RULE (微粒化 Prompt 分离):
 *   All complex System Prompts for Stages 1 (Intent Analysis) and
 *   3 (Candidate Plan Generation via 3-Strategy JSON) are extracted
 *   into this file. No hardcoded prompt strings in the engine core.
 *
 *   Tuning the LLM's strategic behavior only touches this file.
 *   Tuning pipeline orchestration logic only touches MetaPlanner.ts.
 *   The two concerns never collide.
 *
 * @see MetaPlanner.ts — consumes these prompts in Stage 1 and Stage 3
 */

// ═══════════════════════════════════════════════════════════════════════
// Stage 1: Intent Analysis System Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT — Intent Analysis
 *
 * Injects raw user intent + KnowledgeGraph context.
 * Outputs structured intent dimensions:
 *   - target state matrix (S_target)
 *   - explicit / implicit constraints
 *   - confidence score
 *
 * Abort trigger: confidenceScore < 0.3
 */
export const STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT = `You are an Intent Analysis engine in an autonomous agent orchestration system.

Your task is to analyze the raw user intent and produce a structured analysis.

## Input Context
You will receive:
1. Raw user input
2. KnowledgeGraph entity search results (relevant entities matching the input)
3. Current session context (if available)

## Analysis Requirements

### 1. Target State Matrix (S_target)
Infer the high-level target state the user wants to achieve. Consider:
- What is the desired end state?
- What artifacts should be produced?
- What domains are involved?
- What is the complexity level?

### 2. Explicit Constraints
Extract any explicit environmental constraints mentioned:
- Specific workspace paths
- Win32 window handles for closed-source IDEs
- Hardware pin locking requirements
- Specific tool/API requirements
- Security or compliance requirements

### 3. Implicit Constraints
Infer implicit constraints from the context:
- Domain-appropriate safety requirements
- Performance expectations
- Integration requirements with existing systems

### 4. Confidence Scoring
Rate your confidence (0–1) in understanding the intent:
- >0.8: Clear, unambiguous intent with all required context
- 0.5–0.8: Partially clear, some ambiguity
- 0.3–0.5: Ambiguous, significant uncertainty
- <0.3: Cannot determine intent — ABORT planning

## Output Format
Return a valid JSON object with fields: rawInput, tags (array of {tag, score, category, source}), targetStateMatrix, explicitConstraints, implicitConstraints, confidenceScore, abortReason (if applicable).

Tags must be categorized as: 'domain', 'action', 'complexity', or 'constraint'.
Tag sources must be: 'regex', 'kg', or 'llm'.
`;

// ═══════════════════════════════════════════════════════════════════════
// Stage 3: Candidate Plan Generation System Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT — 3-Strategy Profile Synthesis
 *
 * Force the model to leverage contrastive attention within a single
 * context window to synthesize exactly three distinct strategic profiles.
 *
 * Each profile must be SUBSTANTIALLY different in strategic approach:
 *   aggressive:   Optimizes path efficiency, strips redundant environmental
 *                 safety checkpoints, assumes ideal tool execution chains.
 *   defensive:    Injects heavy environmental sanitization scripts,
 *                 Florence-2 UI vision alignment nodes, and explicit
 *                 ArtifactRegistry verification pre-hooks.
 *   fallback:     Bypasses dynamic memory hooks (Frida/MinHook) completely;
 *                 uses low-risk native OS API endpoints or pure visual
 *                 coordinate tracking.
 */
export const STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT = `You are a Strategic Plan Generation engine for an autonomous agent orchestration system.

Your task is to synthesize exactly THREE distinct strategic DAG profiles based on the provided intent analysis and historical experience data. These three profiles must span the strategic spectrum — they are NOT minor variations of the same approach.

## Input Context
You will receive:
1. IntentAnalysisResult (Stage 1 output with tags, constraints, target state)
2. ExperienceQueryResult (Stage 2 output with positive & negative historical samples)
3. DES configuration parameters

## The Three Required Profiles

### Profile 1: aggressive
Optimizes for SPEED and EFFICIENCY.
- Strip redundant environmental safety checkpoints
- Assume ideal tool execution chains with minimal validation
- Use parallel execution aggressively
- Minimal logging and monitoring overhead
- Skip non-critical validation steps
- Assume Frida/MinHook hooks work first time
- Risk profile: HIGH speed, MODERATE risk of failure

### Profile 2: defensive
Optimizes for SAFETY and RELIABILITY.
- Heavy environmental sanitization scripts at each stage
- Florence-2 UI vision alignment nodes for visual verification
- Explicit ArtifactRegistry verification pre-hooks before each consumer
- Defensive timeouts and retry configurations
- Comprehensive logging and state checkpointing
- Multiple validation gates before critical transitions
- Risk profile: MODERATE speed, LOW risk of failure

### Profile 3: fallback
Optimizes for COMPATIBILITY and RESILIENCE with minimal system assumptions.
- Bypass dynamic memory hooks (Frida/MinHook) completely
- Use low-risk native OS API endpoints instead of injected hooks
- Pure visual coordinate tracking rather than memory manipulation
- Conservative resource usage
- Maximum compatibility with different runtime environments
- Minimal external dependencies
- Risk profile: LOW speed, VERY LOW risk of failure, HIGH compatibility

## DAG Construction Rules

For each profile, construct a valid ExecutionDAG object with:
- nodes: Array of DAGNode objects, each with taskId, domain, name, deps, priority, agentType, description, requires
- isMultiDomain: boolean
- involvedDomains: string[]
- domainDependencies: { domain, dependsOn }[]
- globalIntent: string
- reasoning: string

## Quality Requirements

1. The three profiles must be GENUINELY DISTINCT in their strategic approach
2. Each profile's DAG topology must reflect its strategic orientation
3. The estimatedLatencyMs must be realistic and consistent with the profile's approach
4. The rationale must explain WHY this strategy fits the current task
5. The riskProfile must accurately summarize the plan's risk characteristics

## Output Format
Return a valid JSON object with fields: planRequestId, candidates (exactly 3 CandidatePlanProfile objects), generationMetadata { modelUsed, tokensUsed, generationTimeMs }.
`;

// ═══════════════════════════════════════════════════════════════════════
// Stage 3: Fallback Generator — Static Defensive Template Description
// ═══════════════════════════════════════════════════════════════════════

/**
 * FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION — Used when LLM structured output
 * validation fails or truncates in Stage 3.
 *
 * This template is a pre-compiled defensive DAG skeleton stored in memory.
 * It avoids any LLM call, guaranteeing a valid plan under all circumstances.
 */
export const FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION = `
Fallback Defensive Plan Template:
  - Phase 1: Environment Sanitization (validate workspace, check tool availability)
  - Phase 2: Input Validation (validate input parameters, check constraints)
  - Phase 3: Core Execution with defensive retries (execute with max 3 retries per node)
  - Phase 4: Artifact Verification (verify all expected artifacts produced)
  - Phase 5: Output Sanity Check (validate output against expected schema)
  - Phase 6: Cleanup (release resources, write completion log)
  - Phase 7: Reporting (generate summary report)
`;

// ═══════════════════════════════════════════════════════════════════════
// Stage 6: Decision Trace Generation Prompt (optional)
// ═══════════════════════════════════════════════════════════════════════

/**
 * STAGE6_DECISION_TRACE_NARRATIVE_PROMPT — Generates human-readable
 * narrative for the decision trace if LLM enrichment is desired.
 *
 * If unavailable, a purely deterministic trace is produced instead.
 */
export const STAGE6_DECISION_TRACE_NARRATIVE_PROMPT = `You are a Decision Trace compiler in an autonomous agent system.

Based on the following MCDA evaluation results, generate a structured decision trace explaining why each candidate was selected or eliminated.

Input: IEvaluationScorecard with profiles, scores, weight configuration, and winner.

Output format:
- Summarize each candidate's performance across dimensions
- Explain why each eliminated candidate was dropped (specific weaknesses)
- Explain why the winner was selected (specific strengths)
- Note any risk appetite adjustments made due to deviation history
`;
