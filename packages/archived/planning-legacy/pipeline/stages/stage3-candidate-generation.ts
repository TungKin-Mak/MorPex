/**
 * Stage 3: Candidate Plan Generation — Generate candidate plan profiles
 *
 * Attempts LLM structured generation for 3 profiles (aggressive, defensive,
 * fallback). If LLM fails, falls back to pre-compiled defensive template.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import * as crypto from 'node:crypto';
import type { SessionContext } from '../../../../common/types.js';
import type {
  IntentAnalysisResult, ExperienceQueryResult, ICandidatePlansOutput,
  CandidatePlanProfile,
} from '../../types.js';
import { FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION } from '../../prompts.config.js';
import { STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT } from '../../prompts.config.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage3CandidateGeneration(
  ctx: PipelineStageContext,
  userInput: string,
  tags: string[],
  intent: IntentAnalysisResult,
  experience: ExperienceQueryResult | null,
  sessionCtx?: SessionContext,
): Promise<ICandidatePlansOutput> {
  // ★ v2.6 Upgrade: 已知任务（有历史数据）→ 统计引擎（零 LLM）；新任务 → LLM 生成
  const historicalRecords = ctx.store.queryByTags(tags, 5);
  const hasData = historicalRecords.length > 0;

  if (ctx.hierarchicalPlanner && hasData) {
    const hp = ctx.hierarchicalPlanner;
    try {
      const candidates = hp.candidateGenerator.generateAllCandidates(userInput, tags);
      if (candidates.length > 0) {
        const results = hp.simulator.simulateAll(candidates);
        const evaluation = hp.evaluator.evaluate(results);
        // Convert top candidates to standard CandidatePlanProfile format
        const executionId = `exec_hierarchical_${Date.now()}`;
        const strategies: Array<'aggressive' | 'defensive' | 'fallback'> = ['aggressive', 'defensive', 'fallback'];
        const profileCandidates: CandidatePlanProfile[] = evaluation.candidates.slice(0, 3).map((c, i) => ({
          profileId: `profile_hier_${i}_${executionId}`,
          strategy: strategies[i] ?? 'defensive',
          dag: c.plan.dag,
          rationale: `${c.plan.strategy.name} :: ${c.plan.mutationLabel} (composite=${c.scores.compositeScore.toFixed(3)})`,
          estimatedLatencyMs: c.plan.estimatedLatencyMs,
          riskProfile: {
            nodeCount: c.plan.dag.nodes.length,
            criticalPathLength: c.plan.phases.filter(p => !p.optional).length,
            externalDependencies: 0,
            securityCheckpoints: c.plan.phases.filter(p => p.domain === 'security').length,
            visionAlignmentNodes: 0,
            fridaHooksCount: 0,
          },
          metadata: {
            source: 'hierarchical_planning_engine',
            mutationLabel: c.plan.mutationLabel,
            compositeScore: c.scores.compositeScore,
          },
        }));
        return {
          candidates: profileCandidates as unknown as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
          planRequestId: `hier_${executionId}`,
          generationMetadata: {
            modelUsed: 'HierarchicalPlanningEngine (statistical)',
            tokensUsed: 0,
            generationTimeMs: 250,
          },
          validationPassed: true,
          validationErrors: [],
          fallbackTemplateUsed: false,
        };
      }
    } catch (hErr: unknown) {
      const hMsg = hErr instanceof Error ? hErr.message : String(hErr);
      console.warn(`[PipelineExecutor] HierarchicalPlanningEngine failed: ${hMsg}`);
    }
    // 统计引擎无结果 → 继续走 LLM
  }

  // LLM 生成（新任务 或 统计引擎无结果）
  if (ctx.modelRegistry?.generate) {
    const prompt = buildStage3Prompt(userInput, tags, intent, experience, sessionCtx);
    try {
      const llmResponse = await (ctx.modelRegistry as any).generate({
        prompt,
        system: STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT,
        temperature: 0.4,
        maxTokens: 4000,
        responseFormat: 'json_object',
      });
      const content = typeof llmResponse === 'string' ? llmResponse : llmResponse?.content ?? llmResponse?.text ?? '';
      // Parse and validate
      const parsed = parseAndValidateCandidates(ctx, content, userInput, tags, intent, experience);
      if (parsed.validationPassed || parsed.candidates.length > 0) {
        return parsed;
      }
    } catch { /* LLM failed, fall through to fallback */ }
  }

  // Fallback: use pre-compiled defensive template
  return generateFallbackCandidates(userInput, tags, `exec_fallback_${Date.now()}`);
}

/**
 * buildStage3Prompt — Build the structured prompt for Stage 3 LLM call
 */
function buildStage3Prompt(
  userInput: string,
  tags: string[],
  intent: IntentAnalysisResult,
  experience: ExperienceQueryResult | null,
  sessionCtx?: SessionContext,
): string {
  const positiveExamples = experience?.positiveSamples?.slice(0, 3) ?? [];
  const negativeExamples = experience?.negativeSamples?.slice(0, 3) ?? [];

  let prompt = `## Task Description\n${userInput}\n\n`;
  prompt += `## Tags\n${tags.join(', ')}\n\n`;

  if (intent.targetStateMatrix) {
    prompt += `## Target State\n${JSON.stringify(intent.targetStateMatrix, null, 2)}\n\n`;
  }

  if (positiveExamples.length > 0) {
    prompt += `## Historical Success Patterns\n${JSON.stringify(positiveExamples.map(e => ({
      dagNodes: ((e as unknown as Record<string, unknown>).dagNodes as Array<Record<string, unknown>>).map((n: Record<string, unknown>) => ({ role: n.role as string, domain: n.domain as string })),
      durationMs: (e as unknown as Record<string, unknown>).totalDurationMs ?? 0,
    })), null, 2)}\n\n`;
  }

  if (negativeExamples.length > 0) {
    prompt += `## Historical Failure Patterns\n${JSON.stringify(negativeExamples.map(e => ({
      dagNodes: ((e as unknown as Record<string, unknown>).dagNodes as Array<Record<string, unknown>>).map((n: Record<string, unknown>) => ({ role: n.role as string, domain: n.domain as string })),
      errorCategory: (e as unknown as Record<string, unknown>).errorCategory ?? 'unknown',
    })), null, 2)}\n\n`;
  }

  prompt += `## Response Format (JSON only)
{
  "candidates": [
    {
      "strategy": "aggressive | defensive | fallback",
      "rationale": "...",
      "estimatedLatencyMs": 12345,
      "dag": {
        "nodes": [{ "taskId": "node_1", "type": "action", "domain": "web_dev", "description": "...", "deps": [], "requires": ["resource_name"] }],
        "involvedDomains": ["web_dev"],
        "domainDependencies": [],
        "isMultiDomain": false,
        "globalIntent": "...",
        "reasoning": "..."
      },
      "riskProfile": { "nodeCount": 1, "criticalPathLength": 1, "externalDependencies": 0, "securityCheckpoints": 0, "visionAlignmentNodes": 0, "fridaHooksCount": 0 }
    }
  ],
  "validationPassed": true,
  "validationErrors": []
}
`;
  return prompt;
}

/**
 * parseAndValidateCandidates — Parse LLM JSON response into ICandidatePlansOutput
 */
function parseAndValidateCandidates(
  ctx: PipelineStageContext,
  content: string,
  userInput: string,
  tags: string[],
  intent: IntentAnalysisResult,
  experience: ExperienceQueryResult | null,
): ICandidatePlansOutput {
  const errors: string[] = [];

  // Try to find JSON in the response
  let jsonStr = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to repair common issues
    const repaired = jsonStr
      .replace(/(['"])?([a-zA-Z_]\w*)(['"])?\s*:/g, '"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      parsed = JSON.parse(repaired);
    } catch {
      errors.push('Failed to parse LLM response as JSON');
      return {
        candidates: [] as unknown as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
        validationPassed: false,
        validationErrors: errors,
        planRequestId: `gen_${Date.now()}`,
        generationMetadata: { modelUsed: (ctx.modelRegistry as any)?.modelName ?? 'unknown', tokensUsed: 0, generationTimeMs: 0 },
        fallbackTemplateUsed: false,
      };
    }
  }

  const candidates: CandidatePlanProfile[] = [];
  const rawCandidates = (parsed.candidates ?? parsed.plans ?? []) as unknown as Array<Record<string, unknown>>;

  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    errors.push('No candidate plans found in LLM response');
    return {
      candidates: [] as unknown as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
      errors,
      localPlan: null,
      templateUsed: FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION,
    } as unknown as ICandidatePlansOutput;
  }

  for (const rawItem of rawCandidates) {
    const raw = rawItem as any;
    const dag = raw.dag;
    const dagNodes = dag?.nodes ?? [];
    if (!dag || dagNodes.length === 0) {
      errors.push(`Candidate "${raw.strategy ?? 'unknown'}": missing DAG nodes`);
      continue;
    }

    const nodeIds = new Set<string>();
    let hasDanglingDep = false;

    for (const node of dagNodes) {
      if (!node.taskId) {
        errors.push(`Candidate "${raw.strategy ?? 'unknown'}": node missing taskId`);
        continue;
      }
      if (nodeIds.has(node.taskId)) {
        errors.push(`Candidate "${raw.strategy ?? 'unknown'}": duplicate taskId "${node.taskId}"`);
        continue;
      }
      nodeIds.add(node.taskId);
    }

    for (const node of dagNodes) {
      const deps = node.deps ?? [];
      for (const dep of deps) {
        if (!nodeIds.has(dep)) {
          errors.push(`Candidate "${raw.strategy ?? 'unknown'}": dep "${dep}" not found in nodes`);
          hasDanglingDep = true;
        }
      }
    }

    if (hasDanglingDep) continue;

    const profileId = `profile_${raw.strategy ?? 'fallback'}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const involvedDomains = dag.involvedDomains ?? [...new Set(dagNodes.map((n: Record<string, unknown>) => n.domain ?? 'general'))];

    candidates.push({
      profileId,
      strategy: raw.strategy ?? 'defensive',
      dag: {
        nodes: dagNodes.map((n: Record<string, unknown>, idx: number) => ({
          taskId: n.taskId,
          type: n.type ?? 'action',
          domain: n.domain ?? 'general',
          description: n.description ?? '',
          deps: n.deps ?? [],
          requires: n.requires ?? [],
          agentHints: n.agentHints,
          agentConstraint: n.agentConstraint,
        })),
        isMultiDomain: dag.isMultiDomain ?? (involvedDomains.length > 1),
        involvedDomains,
        domainDependencies: dag.domainDependencies ?? [],
        globalIntent: dag.globalIntent ?? userInput.slice(0, 200),
        reasoning: dag.reasoning ?? raw.rationale ?? '',
      },
      rationale: raw.rationale ?? dag.reasoning ?? '',
      estimatedLatencyMs: raw.estimatedLatencyMs ?? 60000,
      riskProfile: {
        nodeCount: raw.riskProfile?.nodeCount ?? dag.nodes.length,
        criticalPathLength: raw.riskProfile?.criticalPathLength ?? 1,
        externalDependencies: raw.riskProfile?.externalDependencies ?? 0,
        securityCheckpoints: raw.riskProfile?.securityCheckpoints ?? 0,
        visionAlignmentNodes: raw.riskProfile?.visionAlignmentNodes ?? 0,
        fridaHooksCount: raw.riskProfile?.fridaHooksCount ?? 0,
      },
      metadata: { modelUsed: (ctx.modelRegistry as any)?.modelName ?? 'unknown' },
    });
  }

  return {
    candidates: candidates as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
    validationPassed: errors.length === 0,
    validationErrors: errors,
    planRequestId: `gen_${Date.now()}`,
    generationMetadata: { modelUsed: (ctx.modelRegistry as any)?.modelName ?? 'unknown', tokensUsed: 0, generationTimeMs: 0 },
    fallbackTemplateUsed: false,
  };
}

/**
 * generateFallbackCandidates — Generate fallback defensive candidate
 */
export async function generateFallbackCandidates(
  userInput: string,
  tags: string[],
  executionId: string,
): Promise<ICandidatePlansOutput> {
  const baseDomain = tags.find(t => ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'].includes(t)) ?? 'general';

  const makeNode = (taskId: string, description: string, deps: string[] = [], requires: string[] = []): Record<string, unknown> => ({
    taskId, type: 'action', domain: baseDomain, description, deps, requires,
  });

  const makePlan = (profileId: string, strategy: 'aggressive' | 'defensive' | 'fallback', nodes: Record<string, unknown>[], reasoning: string, latencyMs: number, source: string): CandidatePlanProfile => ({
    profileId, strategy,
    dag: { nodes: nodes as any, isMultiDomain: false, involvedDomains: [baseDomain], domainDependencies: [], globalIntent: userInput.slice(0, 200), reasoning } as any,
    rationale: reasoning,
    estimatedLatencyMs: latencyMs,
    riskProfile: { nodeCount: nodes.length, criticalPathLength: nodes.length, externalDependencies: 0, securityCheckpoints: 0, visionAlignmentNodes: 0, fridaHooksCount: 0 },
    metadata: { source },
  });

  const defensiveNodes = [
    makeNode('analyze_input', 'Analyze the user input', [], ['context']),
    makeNode('generate_plan', 'Generate a structured DAG plan', ['analyze_input'], ['context', 'kg']),
    makeNode('implement_core', 'Implement the core functionality', ['generate_plan'], ['toolset']),
    makeNode('verify_output', 'Verify the output', ['implement_core'], ['validation']),
    makeNode('finalize', 'Finalize and return the result', ['verify_output']),
  ];

  const aggressiveNodes = defensiveNodes.slice(0, 3);
  const fallbackNodes = [makeNode('execute_direct', 'Execute the request directly with minimal planning')];

  const candidates: [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile] = [
    makePlan(`profile_defensive_${executionId}`, 'defensive', defensiveNodes, FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION, defensiveNodes.length * 15000, 'fallback_defensive'),
    makePlan(`profile_aggressive_${executionId}`, 'aggressive', aggressiveNodes, 'Aggressive fallback: minimal nodes for faster execution', aggressiveNodes.length * 12000, 'fallback_aggressive'),
    makePlan(`profile_fallback_${executionId}`, 'fallback', fallbackNodes, 'Minimal fallback: single direct execution node', 60000, 'fallback_minimal'),
  ];

  return {
    candidates,
    validationPassed: true,
    validationErrors: [],
    planRequestId: `fallback_${executionId}`,
    generationMetadata: { modelUsed: 'none (fallback)', tokensUsed: 0, generationTimeMs: 0 },
    fallbackTemplateUsed: true,
  };
}
