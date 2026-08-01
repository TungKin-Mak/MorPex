/**
 * Stage 1: Intent Analysis — Analyze user intent and produce structured intent
 *
 * Converts simple regex tags to semantic tags, cross-references with
 * KnowledgeGraph if available, infers target state matrix, parses explicit
 * and implicit constraints, and computes a confidence score.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import * as crypto from 'node:crypto';
import type { SessionContext } from '../../../../common/types.js';
import type { Milestone, IntentAnalysisResult, SemanticTag } from '../../types.js';
import { PIPELINE_ABORT_THRESHOLDS } from '../../types.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage1IntentAnalysis(
  ctx: PipelineStageContext,
  userInput: string,
  tags: string[],
  sessionCtx?: SessionContext,
  milestones?: Milestone[],
): Promise<IntentAnalysisResult> {
  const analyzedAt = Date.now();
  const intentId = `int_${analyzedAt}_${crypto.randomBytes(4).toString('hex')}`;

  // Convert simple regex tags to semantic tags
  const semanticTags: SemanticTag[] = tags.map(t => ({
    tag: t,
    score: 0.5,
    category: ctx.categorizeTag(t),
    source: 'regex',
  }));

  // Cross-reference with KnowledgeGraph if available
  if (ctx.knowledgeGraph) {
    try {
      const kgEntities = ctx.knowledgeGraph.searchEntities({ text: userInput, limit: 5 });
      if (kgEntities?.length > 0) {
        for (const entity of kgEntities) {
          const ent = entity as any;
          const tagName = ent.type?.toLowerCase() ?? ent.domain?.toLowerCase() ?? ent.domainId?.toLowerCase();
          if (tagName && !semanticTags.find(st => st.tag === tagName)) {
            semanticTags.push({
              tag: tagName,
              score: ent.relevance ?? 0.7,
              category: 'domain',
              source: 'kg',
            });
          }
        }
      }
    } catch { /* KG query is non-critical */ }
  }

  // Infer target state matrix
  const targetStateMatrix: Record<string, any> = {
    complexity: userInput.length > 200 ? 'high' : userInput.length > 80 ? 'medium' : 'low',
    expectedNodes: Math.min(Math.max(Math.ceil(userInput.length / 100), 3), 12),
  };

  // Parse explicit constraints
  const explicitConstraints: Record<string, any> = {};
  const constraintPatterns: Array<[RegExp, string]> = [
    [/(?:within|in|under|less than)\s+(\d+)\s*(?:min|mins|minute)/i, 'maxDurationMs'],
    [/(?:use|using|with)\s+(python|javascript|typescript|rust|go)\b/i, 'preferredLanguage'],
    [/(?:avoid|no|without)\s+(\w+)/i, 'avoidFeatures'],
  ];
  for (const [re, key] of constraintPatterns) {
    const match = userInput.match(re);
    if (match) {
      if (key === 'maxDurationMs') explicitConstraints[key] = parseInt(match[1], 10) * 60000;
      else explicitConstraints[key] = match[1];
    }
  }

  // Infer implicit constraints
  const implicitConstraints: string[] = [];
  if (userInput.includes('interrupt') || userInput.includes('risk') || milestones?.some(m => m.priority >= 8)) {
    implicitConstraints.push('high_stability_required');
  }
  if (userInput.includes('resource') || userInput.includes('memory') || userInput.includes('limited')) {
    implicitConstraints.push('resource_constrained');
  }
  if (userInput.includes('test') || userInput.includes('qa') || userInput.includes('quality')) {
    implicitConstraints.push('testing_required');
  }

  // Compute confidence score
  let confidenceScore = 0.3;
  if (semanticTags.length >= 2) confidenceScore += 0.15;
  if (semanticTags.length >= 4) confidenceScore += 0.1;
  if (Object.keys(explicitConstraints).length > 0) confidenceScore += 0.1;
  if (userInput.length >= 50) confidenceScore += 0.1;
  if (ctx.knowledgeGraph) confidenceScore += 0.05;
  if (milestones && milestones.length > 0) confidenceScore += 0.1;
  if (userInput.includes('plan') || userInput.includes('strategy')) confidenceScore += 0.05;
  confidenceScore = Math.min(1, Math.max(0.1, confidenceScore));

  // Abort check
  let abortReason: string | undefined;
  if (confidenceScore < PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin) {
    abortReason = `Intent confidence ${confidenceScore.toFixed(3)} < threshold ${PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin}`;
  }

  return {
    intentId,
    rawInput: userInput,
    tags: semanticTags,
    targetStateMatrix,
    explicitConstraints,
    implicitConstraints,
    confidenceScore,
    abortReason,
    analyzedAt,
  };
}
