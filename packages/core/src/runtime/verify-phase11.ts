/**
 * Phase 11 Verification: Harness-mediated resource access
 * Proves tools go through Harness, not direct registry/graph/retriever access
 */
import { AgentHarness } from '../planes/agent-plane/AgentHarness.js';
import { ContextBuilder } from '../planes/agent-plane/ContextBuilder.js';
import { createArtifactRegistrySkill } from '../tools/artifact-registry-skill.js';
import { createKnowledgeGraphSkill } from '../tools/knowledge-graph-skill.js';
import { createMemorySearchTool } from '../tools/memory-search-tool.js';
import { createReadArtifactTool } from '../tools/ReadArtifactTool.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';

const assert = (c: boolean, m: string) => { if (!c) throw Error('FAIL: ' + m); console.log('  OK ' + m); };

async function main() {
  console.log('\n=== Phase 11 Harness Mediation Verification ===\n');

  // 1. Create harness with providers
  console.log('--- 1. Harness + Providers setup ---');
  const registry = new ArtifactRegistry();
  
  // Mock providers
  const mockKG = { searchEntities: (q: any) => [{ type: 'agent', name: 'TestAgent', description: 'A test agent' }] };
  const mockRetriever = { 
    retrieveForTask: (q: string) => ({ found: true, snippets: ['Found: ' + q], source: 'mock' }),
    retrieveForError: (q: string) => ({ found: true, snippets: ['Error: ' + q], source: 'mock' }),
    retrieveForUncertainty: (q: string) => ({ found: true, snippets: ['Doc: ' + q], source: 'mock' }),
  };

  const harness = await AgentHarness.create(b =>
    b.setIntent('Test harness mediation', [])
      .setPlan('plan_h11', { nodes: [] })
      .setExecutionState('running')
      .grantPermissions()
  );

  harness.attachProviders({
    getArtifactRegistry: () => registry,
    getKnowledgeGraph: () => mockKG,
    getMemoryRetriever: () => mockRetriever,
  });

  assert(harness.isInitialized, 'Harness initialized');

  // 2. Test artifact-registry-skill with harness
  console.log('\n--- 2. Artifact skill via Harness ---');
  const artSkill = createArtifactRegistrySkill(registry, harness);
  const artResult = await artSkill.execute('tc1', { name: 'test-artifact', type: 'code', content: 'console.log("hi")', tags: ['test'] });
  assert(artResult.details?.path === 'harness', 'Artifact registered via harness');
  assert(artResult.details?.success === true, 'Artifact registration succeeded');

  // 3. Test artifact-registry-skill WITHOUT harness (fallback)
  console.log('\n--- 3. Artifact skill fallback ---');
  const artSkillNoHarness = createArtifactRegistrySkill(registry, null);
  const artResult2 = await artSkillNoHarness.execute('tc2', { name: 'test2', type: 'doc', content: 'doc content' });
  assert(artResult2.details?.success === true, 'Fallback artifact registration');
  assert(artResult2.details?.path === undefined, 'No harness path in fallback');

  // 4. Test knowledge-graph-skill via harness
  console.log('\n--- 4. Knowledge skill via Harness ---');
  const kgSkill = createKnowledgeGraphSkill(mockKG as any, harness);
  const kgResult = await kgSkill.execute('tc3', { query: 'test agent' });
  assert(kgResult.details?.path === 'harness', 'KG query via harness');
  assert(kgResult.details?.count === 1, 'KG found entity');

  // 5. Test memory-search-tool via harness
  console.log('\n--- 5. Memory search via Harness ---');
  const memTool = createMemorySearchTool(() => mockRetriever as any, harness);
  const memResult = await memTool.execute('tc4', { query: 'test memory', category: 'all' });
  assert(memResult.details?.path === 'harness', 'Memory search via harness');
  assert(memResult.details?.found === true, 'Memory found');

  // 6. Test ReadArtifactTool via harness
  console.log('\n--- 6. ReadArtifact via Harness ---');
  // First register an artifact via harness
  const regResult = await harness.registerArtifact({ name: 'ReadableArt', type: 'code', content: '# Section 1\nContent of section 1\n\n# Section 2\nContent of section 2' });
  const readTool = createReadArtifactTool(registry, harness);
  const readUri = `artifact://default/code/${regResult.id}`;
  const readResult = await readTool.execute('tc5', { uri: readUri });
  assert(readResult.details?.path === 'harness', 'ReadArtifact via harness');
  assert((readResult.content as any)[0]?.text?.includes('ReadableArt'), 'Read content returned');

  // 7. Test permission enforcement via harness
  console.log('\n--- 7. Permission enforcement ---');
  const harnessRestricted = await AgentHarness.create(b =>
    b.setIntent('Test restrictions', [])
      .setPlan('plan_restricted', { nodes: [] })
      .setExecutionState('running')
      .denyPermissions([])
      .addRestriction('write:artifacts')
  );
  harnessRestricted.attachProviders({ getArtifactRegistry: () => registry });
  
  try {
    await harnessRestricted.registerArtifact({ name: 'should-fail', type: 'code', content: 'x' });
    assert(false, 'Should have thrown');
  } catch (e: any) {
    assert(e.message.includes('Permission denied'), 'Permission check works: ' + e.message);
  }

  // 8. Test harness event emission on resource access
  console.log('\n--- 8. Event emission on access ---');
  const events: string[] = [];
  harness.onEvent((event) => events.push(event));
  harness.queryKnowledge('test event query');
  assert(events.includes('harness.knowledge-query'), 'Knowledge query event emitted');
  
  harness.searchMemory('test event memory');
  assert(events.includes('harness.memory-search'), 'Memory search event emitted');

  console.log('\n=== Phase 11 all PASSED ===\n');
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1); });
