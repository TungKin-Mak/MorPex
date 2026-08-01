/**
 * Stage 2: Experience Retrieval — Query historical experience for similar plans
 *
 * Queries PlanExperienceStore for structural layout matches and VectorStore
 * for cosine similarity matches. Combines results into a unified experience
 * query result.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import type { IntentAnalysisResult, ExperienceQueryResult, VectorMatch } from '../../types.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage2ExperienceRetrieval(
  ctx: PipelineStageContext,
  userInput: string,
  tags: string[],
  intent?: IntentAnalysisResult,
): Promise<ExperienceQueryResult> {
  const queriedAt = Date.now();
  const positiveSamples: ExperienceQueryResult['positiveSamples'] = [];
  const negativeSamples: ExperienceQueryResult['negativeSamples'] = [];
  const vectorMatches: VectorMatch[] = [];

  // ★ Agent 记忆优先检索：查 docs + past plans + KG
  ctx.memoryContext = '';
  if (ctx.memoryRetriever) {
    try {
      const retrieval = ctx.memoryRetriever.retrieveForTask(userInput, tags);
      if (retrieval.found) {
        ctx.memoryContext = retrieval.context;
        console.log(`[MemoryRetriever] ✅ ${retrieval.source}: ${retrieval.snippets.length} snippets`);
      }
    } catch (err) {
      console.warn(`[MemoryRetriever] ⚠️ ${(err as Error).message}`);
    }
  }

  // ★ P3: 并行查询 PlanExperienceStore + VectorStore
  const [queryResult, vectorIds] = await Promise.all([
    // Query PlanExperienceStore for structural layout matches
    ctx.store
      ? Promise.resolve(ctx.store.queryByTags?.(tags, 20) ?? []).then((allRecords: any[]) => {
          const pos: typeof positiveSamples = [];
          const neg: typeof negativeSamples = [];
          for (const record of allRecords) {
            const dagNodes = (record as any).dagNodes ?? [];
            if (dagNodes.length === 0) continue;
            if (record.success) {
              pos.push({
                executionId: record.executionId,
                templateId: record.inputTags?.join('_') ?? 'unknown',
                dagNodes: dagNodes.map((n: Record<string, unknown>) => ({
                  role: n.role,
                  domain: n.domain,
                  dependsOn: [] as string[],
                })),
                totalDurationMs: record.totalDurationMs ?? 0,
                totalTokensUsed: record.totalTokensUsed ?? 0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any);
            } else {
              neg.push({
                executionId: record.executionId,
                templateId: record.inputTags?.join('_') ?? 'unknown',
                dagNodes: dagNodes.map((n: Record<string, unknown>) => ({
                  role: n.role,
                  domain: n.domain,
                  dependsOn: [] as string[],
                })),
                errorCategory: record.failureDetails?.[0]?.category ?? 'unknown',
                failedAt: Date.now(),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any);
            }
          }
          return { pos, neg };
        }).catch(() => ({ pos: [], neg: [] } as { pos: typeof positiveSamples; neg: typeof negativeSamples }))
      : Promise.resolve({ pos: [], neg: [] } as { pos: typeof positiveSamples; neg: typeof negativeSamples }),

    // Query VectorStore for cosine similarity
    ctx.vectorStore?.search
      ? ctx.vectorStore.search(userInput, 15).then((ids: string[]) => {
          const matches: VectorMatch[] = [];
          if (ids?.length) {
            for (let i = 0; i < ids.length; i++) {
              matches.push({
                recordId: ids[i],
                similarity: Math.max(0, 1 - i / ids.length),
                keyInsight: '',
              });
            }
          }
          return matches;
        }).catch(() => [] as VectorMatch[])
      : Promise.resolve([] as VectorMatch[]),
  ]);

  positiveSamples.push(...queryResult.pos);
  negativeSamples.push(...queryResult.neg);
  vectorMatches.push(...vectorIds);

  // Deduplicate by executionId
  const seenExIds = new Set<string>();
  const dedupedPositive = positiveSamples.filter(s => {
    if (seenExIds.has(s.executionId)) return false;
    seenExIds.add(s.executionId);
    return true;
  });
  const dedupedNegative = negativeSamples.filter(s => {
    if (seenExIds.has(s.executionId)) return false;
    seenExIds.add(s.executionId);
    return true;
  });

  return {
    positiveSamples: dedupedPositive,
    negativeSamples: dedupedNegative,
    vectorMatches,
    totalCandidates: dedupedPositive.length + dedupedNegative.length,
    queriedAt,
  };
}
