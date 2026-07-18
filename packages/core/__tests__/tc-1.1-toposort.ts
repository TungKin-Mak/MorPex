/**
 * TC-1.1 topologicalSort 拓扑排序 — 原子单元测试
 * 测试计划对应: L1 原子单元测试
 */
import { topologicalSort } from '../utils/toposort.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { console.log('  ❌ ' + m + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); fail++; } }

console.log('\n📋 TC-1.1 topologicalSort\n');

// 正常 DAG
const nodes = [
  { id: 'a', deps: [] as string[] },
  { id: 'b', deps: ['a'] },
  { id: 'c', deps: ['a'] }
];
const sorted = topologicalSort(nodes, n => n.deps, n => n.id);
const idx = (id: string) => sorted.findIndex(n => n.id === id);
ok(idx('a') < idx('b'), 'a 在 b 之前');
ok(idx('a') < idx('c'), 'a 在 c 之前');
console.log('  排序结果:', sorted.map(n => n.id).join(' → '));

// 边界：空数组
const empty = topologicalSort([], (n: any) => n.deps, (n: any) => n.id);
eq(empty, [], '空数组 → []');

// 边界：单节点
const single = topologicalSort([{ id: 'x', deps: [] }], n => n.deps, n => n.id);
eq(single.length, 1, '单节点 → 1 个元素');
eq(single[0].id, 'x', '单节点 id = x');

// 边界：环形依赖 → 返回原序（不崩溃）
const cyclic = topologicalSort(
  [{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }],
  n => n.deps, n => n.id
);
ok(cyclic.length === 2, '环形依赖不崩溃');
console.log('  环形返回:', cyclic.map(n => n.id).join(' → '));

// 多层依赖
const multi = topologicalSort(
  [{ id: 'a', deps: [] }, { id: 'b', deps: ['a'] }, { id: 'c', deps: ['b'] }, { id: 'd', deps: ['a', 'b'] }],
  n => n.deps, n => n.id
);
const mi = (id: string) => multi.findIndex(n => n.id === id);
ok(mi('a') < mi('b'), '多层: a < b');
ok(mi('b') < mi('c'), '多层: b < c');
ok(mi('a') < mi('d'), '多层: a < d');
ok(mi('b') < mi('d'), '多层: b < d');
console.log('  多层排序:', multi.map(n => n.id).join(' → '));

// 依赖去重
const dedup = topologicalSort(
  [{ id: 'a', deps: [] }, { id: 'b', deps: ['a', 'a'] }],
  n => n.deps, n => n.id
);
ok(dedup.length === 2, '去重不崩溃');
console.log('  去重排序:', dedup.map(n => n.id).join(' → '));

console.log(`\n📊 TC-1.1: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);
