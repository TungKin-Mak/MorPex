import { ArtifactGraph } from '../../packages/core/src/planes/knowledge-plane/artifacts/ArtifactGraph.js';
import { ArtifactLineage } from '../../packages/core/src/planes/knowledge-plane/artifacts/ArtifactLineage.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const graph = new ArtifactGraph();
  graph.addNode({ id: 'a1', name: 'API Spec', type: 'openapi', capabilities: [], creator: 'u1', version: '1.0', tags: ['api'] });
  graph.addNode({ id: 'a2', name: 'Backend Code', type: 'code', capabilities: [], creator: 'u1', version: '1.0', tags: ['backend'] });
  graph.addNode({ id: 'a3', name: 'Tests', type: 'test', capabilities: [], creator: 'u2', version: '1.0', tags: ['test'] });
  graph.addEdge('a1', 'a2', 'generated_from');
  graph.addEdge('a2', 'a3', 'depends_on');

  assert.assert(graph.size() === 3, '3 artifacts in graph');
  assert.assert(graph.hasNode('a1'), 'hasNode works');
  assert.assert(graph.getNode('a2')!.name === 'Backend Code', 'getNode');
  assert.assert(graph.getOutgoing('a1').length === 1, 'outgoing edges');
  assert.assert(graph.getIncoming('a2').length === 1, 'incoming edges');

  const lineage = new ArtifactLineage(graph);
  const chain = graph.getDependencyChain('a1');
  assert.assert(chain.length === 3, 'dependency chain complete');

  const full = lineage.getFullLineage('a3');
  assert.assert(full.ancestors.length >= 1, 'artifacts have ancestors');

  const impact = graph.impactAnalysis('a2');
  assert.assert(impact.direct.length + impact.indirect.length >= 1, 'impact analysis');

  // JSON roundtrip
  const json = graph.toJSON();
  const restored = ArtifactGraph.fromJSON(json);
  assert.assert(restored.size() === 3, 'JSON roundtrip preserves data');

  return {
    name: 'Integration: Artifact→Knowledge', category: 'integration',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
