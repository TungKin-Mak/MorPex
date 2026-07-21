/**
 * Artifact Tests — ArtifactGraph + Lineage
 */
import { ArtifactGraph } from '../src/planes/knowledge-plane/artifacts/ArtifactGraph.js';
import { ArtifactLineage } from '../src/planes/knowledge-plane/artifacts/ArtifactLineage.js';

const assert = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };

const graph = new ArtifactGraph();
graph.addNode({ id: 'art1', name: 'API Spec', type: 'openapi', capabilities: ['REST'], creator: 'agent-1', version: '1.0', tags: ['api'] });
graph.addNode({ id: 'art2', name: 'Backend', type: 'code', capabilities: ['server'], creator: 'agent-1', version: '1.0', tags: ['backend'] });
graph.addNode({ id: 'art3', name: 'Tests', type: 'test', capabilities: ['validate'], creator: 'agent-2', version: '1.0', tags: ['test'] });
graph.addEdge('art1', 'art2', 'generated_from');
graph.addEdge('art2', 'art3', 'depends_on');

assert(graph.size() === 3, '3 nodes');
assert(graph.edgeCount() === 2, '2 edges');
assert(graph.getNode('art1')!.name === 'API Spec', 'getNode');
assert(graph.getOutgoing('art1').length === 1, 'outgoing');
assert(graph.getIncoming('art2').length === 1, 'incoming');

const chain = graph.getDependencyChain('art1');
assert(chain.length === 3, 'dependency chain');

const deps = graph.getDependents('art3');
assert(deps.length >= 1, 'has dependents');

const lineage = new ArtifactLineage(graph);
const full = lineage.getFullLineage('art3');
assert(full.ancestors.length >= 1, 'has ancestors');

const json = graph.toJSON();
const restored = ArtifactGraph.fromJSON(json);
assert(restored.size() === 3, 'JSON roundtrip');

graph.removeNode('art3');
assert(graph.size() === 2, 'remove node');

console.log('Artifact Tests: ALL PASSED');
