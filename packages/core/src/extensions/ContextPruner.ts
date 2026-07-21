/**
 * ContextPruner — STUB (replaced by CompactionPolicy)
 * @deprecated Use SlidingWindowCompaction from compaction/CompactionPolicy.js
 */
export class ContextPruner {
  name = 'ContextPruner';
  version = '1.0.0';
  constructor(_opts?: any) {}
  getStats() { return { totalPruned: 0 }; }
  getStatus() { return { name: 'ContextPruner', phase: 'running' }; }
  async pruneContext(segments: any[], _nodeId: string, _executionId: string) {
    const tokensBefore = JSON.stringify(segments).length;
    const kept = segments.slice(0, Math.max(1, Math.ceil(segments.length * 0.7)));
    const tokensAfter = JSON.stringify(kept).length;
    const decisions = segments.map(s => ({ segmentId: s.id, keep: s.importance >= 5 || !s.prunable, reason: s.importance >= 5 ? 'high_importance' : 'below_threshold' }));
    const offloadedArtifacts = segments.filter(s => s.type === 'artifact_ref' && (s.content || '').length > 1000).map(s => ({ segmentId: s.id, artifactUri: s.artifactUri || 'unknown', originalTokens: s.estimatedTokens || 0 }));
    return { tokensBefore, tokensAfter, pruningRatio: tokensBefore > 0 ? (tokensBefore - tokensAfter) / tokensBefore : 0, keptSegments: kept.length, totalSegments: segments.length, decisions, offloadedArtifacts };
  }
}
