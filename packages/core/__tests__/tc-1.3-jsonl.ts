/**
 * TC-1.3 readJSONLLines JSONL 解析 — 原子单元测试
 */
import { readJSONLLines } from '../utils/jsonl.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { console.log('  ❌ ' + m + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); fail++; } }

console.log('\n📋 TC-1.3 readJSONLLines\n');

// TC-1.3a: 正常 3 行 JSONL → 3 个对象
const normal = '{"id":1}\n{"id":2}\n{"id":3}';
const r1 = readJSONLLines(normal);
eq(r1.length, 3, 'TC-1.3a 3 行 → 3 个对象');
eq(r1[0], { id: 1 }, 'TC-1.3a 第1行正确');
eq(r1[1], { id: 2 }, 'TC-1.3a 第2行正确');
eq(r1[2], { id: 3 }, 'TC-1.3a 第3行正确');

// TC-1.3b: 含损坏行 → 跳过损坏行，返回有效行
const withBad = '{"ok":true}\nnot json\n{"also": "ok"}';
const r2 = readJSONLLines(withBad);
eq(r2.length, 2, 'TC-1.3b 跳过损坏行 → 2 个有效');
eq(r2[0], { ok: true }, 'TC-1.3b 第1行正确');
eq(r2[1], { also: 'ok' }, 'TC-1.3b 第3行正确');

// TC-1.3c: 空字符串 → []
const r3 = readJSONLLines('');
eq(r3, [], 'TC-1.3c 空字符串 → []');

// 边界：全损坏行
const allBad = 'bad1\nbad2\nbad3';
const r4 = readJSONLLines(allBad);
eq(r4, [], '全损坏行 → []');

// 边界：尾随换行
const trailing = '{"a":1}\n{"b":2}\n';
const r5 = readJSONLLines(trailing);
eq(r5.length, 2, '尾随换行 → 2 个');

console.log(`\n📊 TC-1.3: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);
