/**
 * Phase 3 — Knowledge Plane Upgrade Verification
 * Verifies: ArtifactGraph, ArtifactLineage, ArtifactEvaluator, ArtifactDependencyResolver, ArtifactEmbedding
 */
import { ArtifactGraph } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactGraph.js';
import { ArtifactLineage } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactLineage.js';
import { ArtifactEvaluator } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactEvaluator.js';
import { ArtifactDependencyResolver } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactDependencyResolver.js';
import { ArtifactEmbedding } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactEmbedding.js';
import type { ArtifactNode } from '../packages/core/src/planes/knowledge-plane/artifacts/types.js';

function makeNode(id: string, name: string, type: string, deps: string[] = []): ArtifactNode {
  return {
    id, name, type: type as any, status: 'approved', version: '1.0.0', creator: 'test',
    description: `Artifact ${name}`, capabilities: [{ name: 'transform', type: 'transform', description: '', confidence: 0.8 }],
    dependencies: deps.map(d => ({ artifactId: d, type: 'import' })),
    successRate: 0.9, usageHistory: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

async function main() {
  console.log('\n=== Phase 3: Knowledge Plane Upgrade ===\n');
  let passed = 0, failed = 0;

  // 1. ArtifactGraph
  try {
    const g = new ArtifactGraph();
    g.addNode(makeNode('a1', 'API Spec', 'document'));
    g.addNode(makeNode('a2', 'Server Code', 'code', ['a1']));
    g.addNode(makeNode('a3', 'Client Code', 'code', ['a1']));
    g.addEdge('a1', 'a2', 'dependency');
    g.addEdge('a1', 'a3', 'dependency');

    const chain = g.getDependencyChain('a1');
    const deps = g.getDependents('a1');

    console.assert(chain.length === 1, 'Self-chain length');
    console.assert(deps.length === 2, 'Two dependents');
    console.assert(g.size() === 3, '3 nodes');
    console.assert(g.edgeCount() === 2, '2 edges');

    // Impact analysis
    const impact = g.impactAnalysis('a1');
    console.assert(impact.direct.length === 2, 'Both dependents directly affected');

    // JSON round-trip
    const json = g.toJSON();
    const g2 = ArtifactGraph.fromJSON(json);
    console.assert(g2.size() === 3, 'JSON restore');
    passed++;
    console.log('  ✅ ArtifactGraph: nodes, edges, chain, impact, JSON round-trip');
  } catch (e) { failed++; console.error('  ❌ ArtifactGraph:', e); }

  // 2. ArtifactLineage
  try {
    const g = new ArtifactGraph();
    g.addNode(makeNode('root', 'Root', 'plan'));
    g.addNode(makeNode('child1', 'Child1', 'code', ['root']));
    g.addNode(makeNode('child2', 'Child2', 'code', ['root']));
    g.addNode(makeNode('grandchild', 'Grandchild', 'code', ['child1']));
    g.addEdge('root', 'child1', 'dependency');
    g.addEdge('root', 'child2', 'dependency');
    g.addEdge('child1', 'grandchild', 'dependency');

    const lineage = new ArtifactLineage(g);

    // Downstream
    const downPaths = lineage.query({ artifactId: 'root', direction: 'downstream' });
    console.assert(downPaths.length >= 1, 'Has downstream path');

    // Full lineage
    const full = lineage.getFullLineage('child1');
    console.assert(full.ancestors.length >= 1, 'Has ancestor');
    console.assert(full.descendants.length >= 1, 'Has descendant');

    // Siblings
    const areSiblings = lineage.areSiblings('child1', 'child2');
    console.assert(areSiblings === true, 'child1 and child2 are siblings');

    // LCA
    const lca = lineage.findLCA('grandchild', 'child2');
    console.assert(lca !== null && lca.id === 'root', 'LCA is root');

    passed++;
    console.log('  ✅ ArtifactLineage: query, full lineage, siblings, LCA');
  } catch (e) { failed++; console.error('  ❌ ArtifactLineage:', e); }

  // 3. ArtifactEvaluator
  try {
    const evaluator = new ArtifactEvaluator();
    const good = makeNode('g1', 'Good Artifact', 'code');
    const poor: ArtifactNode = {
      id: 'p1', name: '', type: 'code', status: 'draft', version: '0', creator: '',
      description: '', capabilities: [], dependencies: [], successRate: 0.1,
      usageHistory: [], createdAt: Date.now(), updatedAt: 0,
    };

    const evalGood = evaluator.evaluate(good);
    const evalPoor = evaluator.evaluate(poor);

    console.assert(evalGood.score > evalPoor.score, 'Good artifact scores higher');
    console.assert(evalPoor.issues.length > 0, 'Poor artifact has issues');
    console.assert(evalPoor.recommendations.length > 0, 'Poor artifact has recommendations');

    // Compare
    const comparison = evaluator.compare(good, poor);
    console.assert(comparison.winner === 'g1', 'Good artifact wins comparison');

    passed++;
    console.log('  ✅ ArtifactEvaluator: evaluate, compare, recommendations');
  } catch (e) { failed++; console.error('  ❌ ArtifactEvaluator:', e); }

  // 4. ArtifactDependencyResolver
  try {
    const g = new ArtifactGraph();
    g.addNode(makeNode('a', 'A', 'code'));
    g.addNode(makeNode('b', 'B', 'code', ['a']));
    g.addNode(makeNode('c', 'C', 'code', ['b']));
    g.addEdge('a', 'b', 'dependency');
    g.addEdge('b', 'c', 'dependency');

    const resolver = new ArtifactDependencyResolver(g);
    const result = resolver.resolve();

    console.assert(result.cycles.length === 0, 'No cycles');
    console.assert(result.order.length === 3, '3 nodes resolved');
    // Order should be [a, b, c] (a has no deps, b depends on a, c depends on b)
    console.assert(result.order[0].id === 'a', 'a first');

    // Validation
    const validation = resolver.validate();
    console.assert(validation.valid === true, 'Valid graph');

    // Cycle detection
    const cyclicG = new ArtifactGraph();
    cyclicG.addNode(makeNode('x', 'X', 'code', ['y']));
    cyclicG.addNode(makeNode('y', 'Y', 'code', ['z']));
    cyclicG.addNode(makeNode('z', 'Z', 'code', ['x']));
    cyclicG.addEdge('x', 'y', 'dependency');
    cyclicG.addEdge('y', 'z', 'dependency');
    cyclicG.addEdge('z', 'x', 'dependency');

    const cyclicResolver = new ArtifactDependencyResolver(cyclicG);
    const cyclicResult = cyclicResolver.resolve();
    console.assert(cyclicResult.cycles.length > 0, 'Cycles detected');

    passed++;
    console.log('  ✅ ArtifactDependencyResolver: resolve, validate, cycle detection');
  } catch (e) { failed++; console.error('  ❌ ArtifactDependencyResolver:', e); }

  // 5. ArtifactEmbedding
  try {
    const emb = new ArtifactEmbedding('test-model');

    const codeNode = makeNode('e1', 'API Server', 'code');
    const docNode = makeNode('e2', 'API Docs', 'document');
    const configNode = makeNode('e3', 'Deploy Config', 'config');

    emb.setNodeCache([codeNode, docNode, configNode]);

    const emb1 = emb.generate(codeNode);
    const emb2 = emb.generate(docNode);
    const emb3 = emb.generate(configNode);

    emb.register(emb1);
    emb.register(emb2);
    emb.register(emb3);

    console.assert(emb.size() === 3, '3 embeddings registered');

    // Similarity search (e1 should be more similar to e2 than to different types due to similarity of features)
    const similar = emb.findSimilar('e1', 2);
    console.assert(similar.length <= 2, 'Top-K results');

    // Search
    const searchResults = emb.search('API', 5);
    console.assert(searchResults.length > 0, 'Search returns results');

    // JSON round-trip
    const jsonEmb = emb.toJSON();
    const embRestored = ArtifactEmbedding.fromJSON(jsonEmb);
    console.assert(embRestored.size() === 3, 'JSON restore embeddings');

    passed++;
    console.log('  ✅ ArtifactEmbedding: generate, register, similarity, search, JSON');
  } catch (e) { failed++; console.error('  ❌ ArtifactEmbedding:', e); }

  // Summary
  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 3 ALL PASSED\n');
}

main().catch(console.error);
