import { MemoryWiki, MemoryRetriever } from '../packages/memory/src/wiki/index.js';

async function main(): Promise<void> {
  let passed = 0, failed = 0;
  function assert(cond: boolean, label: string): void {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}`); }
  }

  const wiki = new MemoryWiki({ dbPath: './data/memory.db' });
  await wiki.initialize();
  const ret = new MemoryRetriever(wiki);

  // 1. 命中 docs
  const r1 = ret.retrieveForTask('架构设计');
  assert(r1.found === true, 'retrieveForTask 命中架构文档');
  assert(r1.snippets.length > 0, `返回 ${r1.snippets.length} 个片段`);
  assert(r1.source === 'docs', '来源是 docs');
  assert(r1.context.includes('记忆中'), 'context 包含提示词');

  // 2. 未命中
  const r2 = ret.retrieveForTask('xyz_not_exists_12345');
  assert(r2.found === false, 'retrieveForTask 无匹配返回 false');
  assert(r2.context === '', '无匹配时 context 为空');

  // 3. 带标签检索
  const r3 = ret.retrieveForTask('设计', ['wiki', 'architecture']);
  assert(r3.found === true, '带标签检索命中');

  // 4. 错误检索
  const r4 = ret.retrieveForError('timeout', 'timeout');
  assert(typeof r4.found === 'boolean', '错误检索返回 boolean');
  assert(Array.isArray(r4.similarErrors), 'similarErrors 是数组');
  assert(Array.isArray(r4.suggestions), 'suggestions 是数组');

  // 5. 不确定检索
  const r5 = ret.retrieveForUncertainty('MemoryWiki API');
  assert(typeof r5.found === 'boolean', '不确定检索返回 boolean');

  // 6. 代码检索
  const r6 = ret.retrieveForCode('React Hooks');
  assert(typeof r6.found === 'boolean', '代码检索返回 boolean');

  wiki.close();
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
