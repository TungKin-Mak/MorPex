/**
 * TC-1.2 extractJson / extractJsonAsync 三级修复 — 原子单元测试
 */
import { extractJson, extractJsonAsync } from '../utils/extractJson.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { console.log('  ❌ ' + m + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); fail++; } }

console.log('\n📋 TC-1.2 extractJson 三级修复\n');

// TC-1.2a: 纯 JSON → 直接返回
const pureJson = '{"name": "test", "value": 42}';
const r1 = extractJson(pureJson);
try { JSON.parse(r1!); ok(true, 'TC-1.2a 纯 JSON → 有效 JSON'); } catch { ok(false, 'TC-1.2a 纯 JSON → 有效 JSON'); }
eq(r1, pureJson, 'TC-1.2a 纯 JSON → 原样返回');

// TC-1.2b: Markdown 代码块 → 提取内部 JSON
const mdBlock = '```json\n{"key": "value"}\n```';
const r2 = extractJson(mdBlock);
eq(r2, '{"key": "value"}', 'TC-1.2b Markdown 代码块 → 提取内部 JSON');

// TC-1.2c: 截断 JSON → Level 2 补齐 }
const truncated = '{"name": "John", "age": 30';
const r3 = extractJson(truncated);
try { JSON.parse(r3!); ok(true, 'TC-1.2c 截断 JSON → 补齐后有效'); } catch { ok(false, 'TC-1.2c 截断 JSON → 补齐后有效'); }
console.log('  TC-1.2c 截断修复:', r3);

// TC-1.2d: 无效 JSON + LLM → extractJsonAsync Level 3 重试
let llmCalled = false;
const r4 = await extractJsonAsync('not json at all', {
  retryWithLLM: true,
  llmCaller: async (prompt) => {
    llmCalled = true;
    return '{"fixed": true}';
  }
});
ok(llmCalled, 'TC-1.2d LLM 被调用');
eq(r4, '{"fixed": true}', 'TC-1.2d Level 3 返回修复 JSON');

// TC-1.2e: 非 JSON 输入 → null
const r5 = extractJson('纯文本没有JSON', { repair: true });
ok(r5 === null, 'TC-1.2e 非 JSON → null');

// 边界：带解释的 JSON
const withText = 'Here is the result: {"status": "ok"}';
const r6 = extractJson(withText);
try { JSON.parse(r6!); ok(true, '带解释 JSON → 有效'); } catch { ok(false, '带解释 JSON → 有效'); }

// 边界：嵌套对象
const nested = '{"a": {"b": {"c": 1}}}';
const r7 = extractJson(nested);
eq(r7, nested, '嵌套对象 → 原样');

console.log(`\n📊 TC-1.2: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);
